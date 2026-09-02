import type { AztecNode } from "@aztec/aztec.js/node";
import { DomainSeparator } from "@aztec/constants";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync";
import type { RootedPassportHints } from "./client.js";
import { toAddress } from "./aztec.js";

// Must remain byte-for-byte aligned with contracts/magna-issuer/src/internal/constants.nr.
const MAGNA_REVOCATION_DS = 0x4d415247;
const MAGNA_ROOT_REVOCATION_DS = 0x4d41524f;
const MAGNA_ROOT_AUTHORITY_REVOCATION_DS = 0x4d415241;

export type RootedCredentialChainState = {
  status: "active" | "inactive" | "expired";
  reason:
    | "chain-valid"
    | "linked-credential-revoked"
    | "root-lineage-revoked-or-recovered"
    | "root-authority-superseded"
    | "credential-expired"
    | "root-authority-expired";
  checkedAtBlock: number;
  checkedAtTimestamp: string;
};

type HintedNoteRecord = {
  note?: Record<string, unknown>;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an authenticated hinted-note object.`);
  }
  return value as Record<string, unknown>;
}

function noteRecord(value: unknown, label: string): Record<string, unknown> {
  const hinted = asRecord(value, label) as HintedNoteRecord;
  return asRecord(hinted.note, `${label}.note`);
}

function fieldValue(note: Record<string, unknown>, key: string, label: string): bigint {
  const value = note[key];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object" && "toBigInt" in value) {
    const toBigInt = (value as { toBigInt?: unknown }).toBigInt;
    if (typeof toBigInt === "function") return toBigInt.call(value) as bigint;
  }
  if (value && typeof value === "object" && "value" in value) {
    return fieldValue({ [key]: (value as { value: unknown }).value }, key, label);
  }
  throw new Error(`${label}.${key} is not field-compatible.`);
}

function assertSame(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} does not match the selected rooted credential.`);
  }
}

/**
 * Reads the rooted credential's status from Aztec's canonical nullifier tree.
 *
 * A rooted note can remain present in the owner's PXE after a lineage kill-switch
 * has been emitted. Therefore note presence is only input material; the latest
 * chain nullifier state at `checkedAtBlock` is the authority for the result.
 */
export async function readRootedCredentialChainState(input: {
  node: Pick<AztecNode, "getBlockNumber" | "getBlockData" | "getNullifierMembershipWitness">;
  issuerAddress: string;
  hints: RootedPassportHints;
}): Promise<RootedCredentialChainState> {
  const rootStatus = noteRecord(input.hints.hintedRootStatusNote, "hintedRootStatusNote");
  const authority = noteRecord(input.hints.hintedRootAuthorityNote, "hintedRootAuthorityNote");
  const linkedStatus = noteRecord(input.hints.hintedStatusNote, "hintedStatusNote");
  const linkedCredential = noteRecord(input.hints.hintedCredentialNote, "hintedCredentialNote");

  const expectedRoot = BigInt(input.hints.rootCommitment);
  const expectedClaims = BigInt(input.hints.claimsHash);
  assertSame(fieldValue(rootStatus, "root_commitment", "hintedRootStatusNote.note"), expectedRoot, "Root status");
  assertSame(fieldValue(authority, "root_commitment", "hintedRootAuthorityNote.note"), expectedRoot, "Root authority");
  assertSame(fieldValue(authority, "claims_hash", "hintedRootAuthorityNote.note"), expectedClaims, "Root authority claims");
  assertSame(fieldValue(linkedStatus, "root_commitment", "hintedStatusNote.note"), expectedRoot, "Linked status root");
  assertSame(fieldValue(linkedStatus, "claims_hash", "hintedStatusNote.note"), expectedClaims, "Linked status claims");
  assertSame(fieldValue(linkedCredential, "root_commitment", "hintedCredentialNote.note"), expectedRoot, "Linked credential root");
  assertSame(fieldValue(linkedCredential, "claims_hash", "hintedCredentialNote.note"), expectedClaims, "Linked credential claims");

  const credentialType = fieldValue(linkedStatus, "credential_type", "hintedStatusNote.note");
  assertSame(
    fieldValue(linkedCredential, "credential_type", "hintedCredentialNote.note"),
    credentialType,
    "Linked credential type",
  );

  const linkedInner = poseidon2HashWithSeparator(
    [fieldValue(linkedStatus, "revocation_secret", "hintedStatusNote.note"), credentialType, expectedClaims],
    MAGNA_REVOCATION_DS,
  );
  const rootInner = poseidon2HashWithSeparator(
    [fieldValue(rootStatus, "revocation_secret", "hintedRootStatusNote.note"), expectedRoot],
    MAGNA_ROOT_REVOCATION_DS,
  );
  const authorityInner = poseidon2HashWithSeparator(
    [fieldValue(authority, "revocation_secret", "hintedRootAuthorityNote.note"), expectedRoot, expectedClaims],
    MAGNA_ROOT_AUTHORITY_REVOCATION_DS,
  );
  const issuer = toAddress(input.issuerAddress);
  // This is the exact implementation of @aztec/stdlib/hash.siloNullifier,
  // kept on the synchronous browser-safe Poseidon backend.
  const linkedNullifier = poseidon2HashWithSeparator(
    [issuer.toField(), linkedInner],
    DomainSeparator.SILOED_NULLIFIER,
  );
  const rootNullifier = poseidon2HashWithSeparator(
    [issuer.toField(), rootInner],
    DomainSeparator.SILOED_NULLIFIER,
  );
  const authorityNullifier = poseidon2HashWithSeparator(
    [issuer.toField(), authorityInner],
    DomainSeparator.SILOED_NULLIFIER,
  );

  // Pin every query and the timestamp to one block so the displayed state is a
  // coherent source-of-truth snapshot rather than a mixture of moving `latest`s.
  const checkedAtBlock = await input.node.getBlockNumber();
  const [block, linkedWitness, rootWitness, authorityWitness] = await Promise.all([
    input.node.getBlockData(checkedAtBlock),
    input.node.getNullifierMembershipWitness(checkedAtBlock, linkedNullifier),
    input.node.getNullifierMembershipWitness(checkedAtBlock, rootNullifier),
    input.node.getNullifierMembershipWitness(checkedAtBlock, authorityNullifier),
  ]);
  if (!block) {
    throw new Error(`Aztec block ${checkedAtBlock} was unavailable during credential status validation.`);
  }
  const checkedAtTimestamp = block.header.globalVariables.timestamp;

  if (rootWitness) {
    return {
      status: "inactive",
      reason: "root-lineage-revoked-or-recovered",
      checkedAtBlock: Number(checkedAtBlock),
      checkedAtTimestamp: checkedAtTimestamp.toString(),
    };
  }
  if (authorityWitness) {
    return {
      status: "inactive",
      reason: "root-authority-superseded",
      checkedAtBlock: Number(checkedAtBlock),
      checkedAtTimestamp: checkedAtTimestamp.toString(),
    };
  }
  if (linkedWitness) {
    return {
      status: "inactive",
      reason: "linked-credential-revoked",
      checkedAtBlock: Number(checkedAtBlock),
      checkedAtTimestamp: checkedAtTimestamp.toString(),
    };
  }

  const credentialExpiry = fieldValue(linkedCredential, "expiry_ts", "hintedCredentialNote.note");
  if (credentialExpiry <= checkedAtTimestamp) {
    return {
      status: "expired",
      reason: "credential-expired",
      checkedAtBlock: Number(checkedAtBlock),
      checkedAtTimestamp: checkedAtTimestamp.toString(),
    };
  }
  const authorityExpiry = fieldValue(authority, "authority_expiry_ts", "hintedRootAuthorityNote.note");
  if (authorityExpiry <= checkedAtTimestamp) {
    return {
      status: "expired",
      reason: "root-authority-expired",
      checkedAtBlock: Number(checkedAtBlock),
      checkedAtTimestamp: checkedAtTimestamp.toString(),
    };
  }

  return {
    status: "active",
    reason: "chain-valid",
    checkedAtBlock: Number(checkedAtBlock),
    checkedAtTimestamp: checkedAtTimestamp.toString(),
  };
}
