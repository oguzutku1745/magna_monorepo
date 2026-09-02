import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingRecoveryV3Finalization,
  loadCredentialRefs,
  loadPendingRecoveryV3Finalization,
  loadRecoveryTargetProfile,
  loadWalletProfile,
  readPassportA2Witness,
  reconcileStoredChainFingerprint,
  refsForOwner,
  saveCredentialRefs,
  savePassportA2Witness,
  savePendingRecoveryV3Finalization,
  saveRecoveryTargetProfile,
  saveWalletProfile,
  upsertCredentialRef,
  type PassportCommittedClaimsV2LocalWitness,
  type StoredCredentialRef,
} from "./storage";

const ownerAddress = "0xowner";
const witness: PassportCommittedClaimsV2LocalWitness = {
  schema: "passport-committed-claims-v2",
  credentialAuthenticity: "passport-a2",
  minAgeProven: 21,
  nationalityAlpha3Packed: "5526610",
  nationalityBlind: "111",
  expiryTs: "1942358399",
  expiryBlind: "222",
};

function passportRef(overrides: Partial<StoredCredentialRef> = {}): StoredCredentialRef {
  return {
    id: overrides.id ?? "ref",
    ownerAddress: overrides.ownerAddress ?? ownerAddress,
    kind: "passport",
    status: "active",
    claimsHash: overrides.claimsHash ?? "123",
    createdAt: overrides.createdAt ?? "2026-06-19T00:00:00.000Z",
    issuerAddress: overrides.issuerAddress,
    mode: overrides.mode ?? "rooted",
    rootCommitment: overrides.rootCommitment ?? "99",
    issuanceKind: overrides.issuanceKind,
    passportCommittedClaimsV2Witness: overrides.passportCommittedClaimsV2Witness,
  };
}

describe("credential ref storage", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => store.set(key, value)),
        removeItem: vi.fn((key: string) => store.delete(key)),
      },
    });
  });

  it("filters refs to the configured issuer", () => {
    saveCredentialRefs([
      passportRef({ id: "old", issuerAddress: "0xold" }),
      passportRef({ id: "current", issuerAddress: "0xcurrent" }),
    ]);
    expect(refsForOwner(ownerAddress, { issuerAddress: "0xcurrent" }).map(ref => ref.id)).toEqual(["current"]);
  });

  it("keeps refs from separate issuer deployments distinct", () => {
    upsertCredentialRef(passportRef({ issuerAddress: "0xold" }));
    const refs = upsertCredentialRef(passportRef({ issuerAddress: "0xnew" }));
    expect(refs.map(ref => ref.issuerAddress).sort()).toEqual(["0xnew", "0xold"]);
  });

  it("stores and hydrates the A2 local witness from its separate cache", () => {
    const issued = passportRef({
      id: "a2",
      issuerAddress: "0xissuer",
      issuanceKind: "a2",
      passportCommittedClaimsV2Witness: witness,
    });
    savePassportA2Witness(issued);
    saveCredentialRefs([
      passportRef({ id: "rediscovered", issuerAddress: "0xissuer", passportCommittedClaimsV2Witness: undefined }),
    ]);
    expect(loadCredentialRefs()[0]).toMatchObject({
      issuanceKind: "a2",
      passportCommittedClaimsV2Witness: witness,
    });
  });

  it("clears chain-specific refs but retains the separate A2 witness cache", () => {
    const ref = passportRef({ issuerAddress: "0xissuer", issuanceKind: "a2", passportCommittedClaimsV2Witness: witness });
    saveCredentialRefs([ref]);
    saveWalletProfile({ address: ownerAddress, walletKind: "webauthn", createdAt: "2026-06-19T00:00:00.000Z" });
    expect(reconcileStoredChainFingerprint("chain-a")).toBe(false);
    expect(reconcileStoredChainFingerprint("chain-b")).toBe(true);
    expect(loadCredentialRefs()).toEqual([]);
    expect(loadWalletProfile()).toBeNull();
    expect(readPassportA2Witness(ref)).toEqual(witness);
  });

  it("persists and clears non-secret Recovery V3 finalization state", () => {
    const recoveredCredential = passportRef({
      id: "recovered",
      ownerAddress: "0xtarget",
      claimsHash: "456",
      issuanceKind: "a2",
      passportCommittedClaimsV2Witness: witness,
    });
    savePendingRecoveryV3Finalization({
      version: 1,
      phase: "submitted",
      sourceCredentialId: "source",
      target: {
        address: "0xtarget",
        walletKind: "passkey",
        publicKey: `04${"01".repeat(32)}${"02".repeat(32)}`,
        createdAt: "2026-08-27T00:00:00.000Z",
      },
      recoveredCredential,
      recoveryTxHash: "0xtx",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:01:00.000Z",
    });

    expect(loadPendingRecoveryV3Finalization()).toMatchObject({
      phase: "submitted",
      sourceCredentialId: "source",
      recoveryTxHash: "0xtx",
      recoveredCredential: { id: "recovered", ownerAddress: "0xtarget" },
    });

    clearPendingRecoveryV3Finalization();
    expect(loadPendingRecoveryV3Finalization()).toBeNull();
  });

  it("persists the non-secret recovery target across frontend restarts", () => {
    const target = {
      address: "0xtarget",
      label: "Magna recovery · Alice",
      walletKind: "passkey",
      createdAt: "2026-08-27T00:00:00.000Z",
      publicKey: `04${"01".repeat(64)}`,
      deploymentStatus: "deployed",
    };

    saveRecoveryTargetProfile(target);
    expect(loadRecoveryTargetProfile()).toEqual(target);
  });
});
