import type { AztecNode } from "@aztec-labs/aztec.js/node";
import { DomainSeparator } from "@aztec-labs/constants";
import { poseidon2HashWithSeparator } from "@aztec-labs/foundation/crypto/sync";
import { CredentialType } from "@magna-protocol/core";
import { toAddress } from "./aztec.js";

// Must match contracts/magna-issuer/src/internal/constants.nr and rate_limit.nr.
const RATE_LIMIT_DS = 0x4d414752;
const WINDOW_SECONDS = 86_400n;
const SLOT_COUNT = 5;

type AllowanceNode = Pick<AztecNode, "getBlockNumber" | "getBlockData" | "getNullifierMembershipWitness">;
export type SponsorAllowanceInput = {
  node: AllowanceNode;
  issuerAddress: string;
  credentialType: number;
  claimsHash: string;
  hintedStatusNote: unknown;
  requiredSlots?: number;
  /** Synchronize and read the wallet's proving anchor, which may lag the proposed tip. */
  getAnchorTimestamp?: () => Promise<bigint>;
};

export class SponsorAllowanceExhaustedError extends Error {
  constructor(readonly credentialType: number, readonly resetsAt: bigint, hasRemainingAllowance = false) {
    const name = credentialType === CredentialType.Instagram ? "Instagram" : "Passport";
    const reset = new Date(Number(resetsAt) * 1_000).toLocaleString(undefined, { timeZoneName: "short" });
    super(hasRemainingAllowance
      ? `There is not enough sponsored verification allowance for your ${name} credential to complete this login. Try again after ${reset}.`
      : `Today's sponsored verification allowance for your ${name} credential has been used. Try again after ${reset}.`);
    this.name = "SponsorAllowanceExhaustedError";
  }
}

function field(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (value && typeof value === "object") {
    if ("toBigInt" in value && typeof value.toBigInt === "function") return value.toBigInt();
    if ("value" in value) return field(value.value);
  }
  throw new Error("Credential status note contains an invalid field.");
}

function statusFields(input: SponsorAllowanceInput) {
  const status = (input.hintedStatusNote as { note?: Record<string, unknown> } | null)?.note;
  if (!status) throw new Error("An authenticated credential status note is required to check the sponsored allowance.");
  const secret = field(status.revocation_secret);
  const type = field(status.credential_type);
  const claims = field(status.claims_hash);
  if (type !== BigInt(input.credentialType) || claims !== BigInt(input.claimsHash)) {
    throw new Error("Credential status note does not match the selected credential.");
  }
  return { secret, type, claims };
}

function slotNullifier(input: SponsorAllowanceInput, windowId: bigint, slot: number) {
  const { secret, type, claims } = statusFields(input);
  const inner = poseidon2HashWithSeparator([secret, type, claims, windowId, BigInt(slot)], RATE_LIMIT_DS);
  return poseidon2HashWithSeparator([toAddress(input.issuerAddress).toField(), inner], DomainSeparator.SILOED_NULLIFIER);
}

/** Derive/query only hashes: the status-note secret never leaves the wallet. */
export async function selectUnusedSponsorSlot(input: SponsorAllowanceInput) {
  const requiredSlots = input.requiredSlots ?? 1;
  if (!Number.isInteger(requiredSlots) || requiredSlots < 1 || requiredSlots > SLOT_COUNT) {
    throw new Error("This login must request between one and five sponsored checks per credential.");
  }
  statusFields(input);
  // Sync before reading chain state so the membership snapshot cannot precede the anchor.
  const anchorTimestamp = await input.getAnchorTimestamp?.();
  const blockNumber = await input.node.getBlockNumber();
  const block = await input.node.getBlockData(blockNumber);
  if (!block) throw new Error("Aztec block is unavailable while checking the sponsored verification allowance.");
  const windowId = (anchorTimestamp ?? block.header.globalVariables.timestamp) / WINDOW_SECONDS;
  const resetsAt = (windowId + 1n) * WINDOW_SECONDS;
  const nullifiers = Array.from({ length: SLOT_COUNT }, (_, slot) => slotNullifier(input, windowId, slot));
  const witnesses = await Promise.all(nullifiers.map(hash => input.node.getNullifierMembershipWitness(blockNumber, hash)));
  const slot = witnesses.findIndex(witness => witness === undefined);
  const available = witnesses.filter(witness => witness === undefined).length;
  if (available < requiredSlots) throw new SponsorAllowanceExhaustedError(input.credentialType, resetsAt, available > 0);
  return { slot, nullifier: nullifiers[slot], resetsAt };
}

/**
 * Only retry an exact slot collision during AVM simulation, before broadcast.
 * Receipt timeouts and node submission errors have uncertain outcomes and must
 * be returned to the caller rather than risk spending another allowance slot.
 */
export async function sendWithAvailableSponsorSlot<T>(
  input: SponsorAllowanceInput,
  send: (slot: number) => Promise<T>,
): Promise<T> {
  let lastCollision: unknown;
  for (let attempt = 0; attempt <= SLOT_COUNT; attempt++) {
    // Recheck even after multi-credential preflight: earlier sends may advance the day/state.
    const selected = await selectUnusedSponsorSlot(input);
    if (attempt === SLOT_COUNT) throw lastCollision;
    try {
      return await send(selected.slot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const duplicate = /duplicate siloed nullifier\s+(0x[0-9a-f]+)/i.exec(message);
      if (!message.includes("AVM simulation failed:") || !duplicate) throw error;
      let collidedNullifier = selected.nullifier;
      if (BigInt(duplicate[1]) !== collidedNullifier.toBigInt()) {
        // send() synchronizes PXE again. If it crossed midnight, authenticate
        // the collision against this same credential/slot under the new anchor.
        const timestamp = input.getAnchorTimestamp
          ? await input.getAnchorTimestamp()
          : (await input.node.getBlockData("latest"))?.header.globalVariables.timestamp;
        if (timestamp === undefined) throw error;
        collidedNullifier = slotNullifier(input, timestamp / WINDOW_SECONDS, selected.slot);
        if (BigInt(duplicate[1]) !== collidedNullifier.toBigInt()) throw error;
      }
      // A matching string alone is insufficient evidence of an on-chain race.
      if (!await input.node.getNullifierMembershipWitness("latest", collidedNullifier)) throw error;
      lastCollision = error;
    }
  }
  throw lastCollision;
}
