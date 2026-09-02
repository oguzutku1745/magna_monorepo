import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AztecNode } from "@aztec/aztec.js/node";
import { readRootedCredentialChainState } from "./credential-chain-state.js";
import type { RootedPassportHints } from "./client.js";

const ROOT = 101n;
const CLAIMS = 202n;
const FUTURE = 2_000n;
const ISSUER = `0x${"12".repeat(32)}`;

function hints(overrides: { credentialExpiry?: bigint; authorityExpiry?: bigint } = {}): RootedPassportHints {
  return {
    rootCommitment: ROOT.toString(),
    claimsHash: CLAIMS.toString(),
    hintedCredentialNote: {
      note: {
        root_commitment: ROOT,
        claims_hash: CLAIMS,
        credential_type: 1n,
        expiry_ts: overrides.credentialExpiry ?? FUTURE,
      },
    },
    hintedStatusNote: {
      note: {
        root_commitment: ROOT,
        revocation_secret: 303n,
        claims_hash: CLAIMS,
        credential_type: 1n,
      },
    },
    hintedRootStatusNote: {
      note: {
        root_commitment: ROOT,
        revocation_secret: 404n,
      },
    },
    hintedRootAuthorityNote: {
      note: {
        root_commitment: ROOT,
        claims_hash: CLAIMS,
        authority_expiry_ts: overrides.authorityExpiry ?? FUTURE,
        revocation_secret: 505n,
      },
    },
  };
}

function nodeWithMembership(memberIndexes: number[], timestamp = 1_000n) {
  const references: unknown[] = [];
  let membershipCall = 0;
  const node = {
    getBlockNumber: async () => 77,
    getBlockData: async (reference: unknown) => {
      references.push(reference);
      return { header: { globalVariables: { timestamp } } };
    },
    getNullifierMembershipWitness: async (reference: unknown) => {
      references.push(reference);
      const present = memberIndexes.includes(membershipCall);
      membershipCall += 1;
      return present ? ({ index: 1n } as never) : undefined;
    },
  } as unknown as Pick<AztecNode, "getBlockNumber" | "getBlockData" | "getNullifierMembershipWitness">;
  return { node, references };
}

describe("readRootedCredentialChainState", () => {
  it("reports active only after all three chain nullifiers are absent at one pinned block", async () => {
    const { node, references } = nodeWithMembership([]);
    const state = await readRootedCredentialChainState({
      node,
      issuerAddress: ISSUER,
      hints: hints(),
    });

    assert.deepEqual(state, {
      status: "active",
      reason: "chain-valid",
      checkedAtBlock: 77,
      checkedAtTimestamp: "1000",
    });
    assert.deepEqual(references, [77, 77, 77, 77]);
  });

  it("treats a root kill-switch nullifier as inactive even while old notes remain readable", async () => {
    // Membership calls are linked, root, authority. Recovery emits the second.
    const { node } = nodeWithMembership([1]);
    const state = await readRootedCredentialChainState({
      node,
      issuerAddress: ISSUER,
      hints: hints(),
    });

    assert.equal(state.status, "inactive");
    assert.equal(state.reason, "root-lineage-revoked-or-recovered");
  });

  it("uses the pinned chain timestamp for expiry", async () => {
    const { node } = nodeWithMembership([], 1_500n);
    const state = await readRootedCredentialChainState({
      node,
      issuerAddress: ISSUER,
      hints: hints({ credentialExpiry: 1_500n }),
    });

    assert.equal(state.status, "expired");
    assert.equal(state.reason, "credential-expired");
  });

  it("rejects hinted notes that do not belong to the selected stored credential", async () => {
    const { node } = nodeWithMembership([]);
    const badHints = hints();
    (badHints.hintedRootStatusNote as { note: { root_commitment: bigint } }).note.root_commitment = 999n;

    await assert.rejects(
      () =>
        readRootedCredentialChainState({
          node,
          issuerAddress: ISSUER,
          hints: badHints,
        }),
      /Root status does not match/,
    );
  });
});
