import type { AztecNode } from "@aztec-labs/aztec.js/node";
import { DomainSeparator } from "@aztec-labs/constants";
import { poseidon2HashWithSeparator } from "@aztec-labs/foundation/crypto/sync";
import type { RootedPassportHints, LinkedInstagramHints, PassportHints } from "./client.js";
import { toAddress } from "./aztec.js";

// Must remain byte-for-byte aligned with contracts/magna-issuer/src/internal/constants.nr.
const MAGNA_REVOCATION_DS = 0x4d415247;
const MAGNA_ROOT_OWNER_REVOCATION_DS = 0x4d415257;
const MAGNA_LINKED_STATUS_SECRET_DS = 0x4d414c53;
const MAGNA_ROOT_REVOCATION_DS = 0x4d41524f;
const MAGNA_ROOT_AUTHORITY_REVOCATION_DS = 0x4d415241;

export type RootedCredentialChainState = {
  status: "active" | "inactive" | "expired";
  reason:
    | "chain-valid"
    | "linked-credential-revoked"
    | "credential-revoked"
    | "root-owner-revoked"
    | "root-version-mismatch"
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
  // This is the exact implementation of @aztec-labs/stdlib/hash.siloNullifier,
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
  const ownerRootNullifier = silo(input.issuerAddress, poseidon2HashWithSeparator(
    [fieldValue(rootStatus, "revocation_secret", "rootStatus"), expectedRoot], MAGNA_ROOT_OWNER_REVOCATION_DS));
  const [block, linkedWitness, rootWitness, authorityWitness, ownerRootWitness] = await Promise.all([
    input.node.getBlockData(checkedAtBlock),
    input.node.getNullifierMembershipWitness(checkedAtBlock, linkedNullifier),
    input.node.getNullifierMembershipWitness(checkedAtBlock, rootNullifier),
    input.node.getNullifierMembershipWitness(checkedAtBlock, authorityNullifier),
    input.node.getNullifierMembershipWitness(checkedAtBlock, ownerRootNullifier),
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
  if (ownerRootWitness) {
    return { status: "inactive", reason: "root-owner-revoked", checkedAtBlock: Number(checkedAtBlock), checkedAtTimestamp: checkedAtTimestamp.toString() };
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

export type InstagramCredentialChainState = RootedCredentialChainState;
type ChainNode = Pick<AztecNode, "getBlockNumber" | "getBlockData" | "getNullifierMembershipWitness">;

function silo(issuer: string, inner: ReturnType<typeof poseidon2HashWithSeparator>) {
  return poseidon2HashWithSeparator([toAddress(issuer).toField(), inner], DomainSeparator.SILOED_NULLIFIER);
}

export function deriveLinkedInstagramStatusSecret(rootSecret: bigint, claimsHash: bigint): bigint {
  return poseidon2HashWithSeparator([rootSecret, 3n, claimsHash], MAGNA_LINKED_STATUS_SECRET_DS).toBigInt();
}

/** Reads only root kill switches. Passport authority and credential expiry do not affect the root. */
export async function readRootStatusChainState(input: {
  node: ChainNode; issuerAddress: string; rootCommitment: string | bigint; hintedRootStatusNote: unknown;
}): Promise<RootedCredentialChainState> {
  const root = BigInt(input.rootCommitment);
  const note = noteRecord(input.hintedRootStatusNote, "rootStatus");
  assertSame(fieldValue(note, "root_commitment", "rootStatus"), root, "Root status");
  const secret = fieldValue(note, "revocation_secret", "rootStatus");
  const blockNumber = await input.node.getBlockNumber();
  const [block, recovery, owner] = await Promise.all([
    input.node.getBlockData(blockNumber),
    input.node.getNullifierMembershipWitness(blockNumber, silo(input.issuerAddress, poseidon2HashWithSeparator([secret, root], MAGNA_ROOT_REVOCATION_DS))),
    input.node.getNullifierMembershipWitness(blockNumber, silo(input.issuerAddress, poseidon2HashWithSeparator([secret, root], MAGNA_ROOT_OWNER_REVOCATION_DS))),
  ]);
  if (!block) throw new Error(`Aztec block ${blockNumber} was unavailable during root status validation.`);
  return {
    status: recovery || owner ? "inactive" : "active",
    reason: recovery ? "root-lineage-revoked-or-recovered" : owner ? "root-owner-revoked" : "chain-valid",
    checkedAtBlock: Number(blockNumber), checkedAtTimestamp: block.header.globalVariables.timestamp.toString(),
  };
}

/** Instagram validity uses its own notes and, for linked instances, the exact root version. */
export async function readInstagramCredentialChainState(input: {
  node: ChainNode; issuerAddress: string; hints: PassportHints | LinkedInstagramHints;
}): Promise<InstagramCredentialChainState> {
  const credential = noteRecord(input.hints.hintedCredentialNote, "credential");
  const status = noteRecord(input.hints.hintedStatusNote, "status");
  const claims = BigInt(input.hints.claimsHash);
  for (const [label, note] of [["Credential", credential], ["Status", status]] as const) {
    assertSame(fieldValue(note, "claims_hash", label), claims, `${label} claims`);
    assertSame(fieldValue(note, "credential_type", label), 3n, `${label} type`);
  }
  const secret = fieldValue(status, "revocation_secret", "status");
  const nullifiers = [silo(input.issuerAddress, poseidon2HashWithSeparator([secret, 3n, claims], MAGNA_REVOCATION_DS))];
  let versionMismatch = false;
  if ("rootCommitment" in input.hints) {
    const root = BigInt(input.hints.rootCommitment);
    const rootStatus = noteRecord(input.hints.hintedRootStatusNote, "rootStatus");
    for (const [label, note] of [["Credential root", credential], ["Status root", status], ["Root status", rootStatus]] as const) {
      assertSame(fieldValue(note, "root_commitment", label), root, label);
    }
    const rootSecret = fieldValue(rootStatus, "revocation_secret", "rootStatus");
    versionMismatch = deriveLinkedInstagramStatusSecret(rootSecret, claims) !== secret;
    nullifiers.push(
      silo(input.issuerAddress, poseidon2HashWithSeparator([rootSecret, root], MAGNA_ROOT_REVOCATION_DS)),
      silo(input.issuerAddress, poseidon2HashWithSeparator([rootSecret, root], MAGNA_ROOT_OWNER_REVOCATION_DS)),
    );
  } else if ("root_commitment" in credential || "root_commitment" in status) {
    throw new Error("Linked Instagram hints are missing their root metadata.");
  }
  const blockNumber = await input.node.getBlockNumber();
  const [block, witnesses] = await Promise.all([
    input.node.getBlockData(blockNumber),
    Promise.all(nullifiers.map(nullifier => input.node.getNullifierMembershipWitness(blockNumber, nullifier))),
  ]);
  if (!block) throw new Error(`Aztec block ${blockNumber} was unavailable during Instagram status validation.`);
  const timestamp = block.header.globalVariables.timestamp;
  const snapshot = { checkedAtBlock: Number(blockNumber), checkedAtTimestamp: timestamp.toString() };
  const reason = witnesses[1] ? "root-lineage-revoked-or-recovered" : witnesses[2] ? "root-owner-revoked" :
    versionMismatch ? "root-version-mismatch" : witnesses[0] ? ("rootCommitment" in input.hints ? "linked-credential-revoked" : "credential-revoked") : undefined;
  if (reason) return { ...snapshot, status: "inactive", reason };
  if (fieldValue(credential, "expiry_ts", "credential") <= timestamp) return { ...snapshot, status: "expired", reason: "credential-expired" };
  return { ...snapshot, status: "active", reason: "chain-valid" };
}
