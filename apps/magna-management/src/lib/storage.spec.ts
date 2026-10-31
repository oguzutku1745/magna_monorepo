import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingRecoveryV3Finalization,
  clearStoredWalletState,
  commitStoredChainFingerprint,
  loadCredentialRefs,
  loadPendingRecoveryV3Finalization,
  loadRecoveryTargetProfile,
  loadWalletProfile,
  readPassportA2Witness,
  storedChainFingerprintChanged,
  replaceCredentialRefsForOwnerFromChain,
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
    ghostOwner: overrides.ghostOwner,
    recoveryTxHash: overrides.recoveryTxHash,
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

  it("isolates V6 wallet, recovery and private witnesses while preserving V5 browser data", () => {
    const ref = passportRef({ issuerAddress: "0xissuer", passportCommittedClaimsV2Witness: witness });
    const profile = { address: ownerAddress, walletKind: "passkey", createdAt: ref.createdAt, publicKey: "04public" };
    const pending = { version: 1 as const, phase: "prepared" as const, target: profile,
      recoveredCredential: ref, createdAt: ref.createdAt, updatedAt: ref.createdAt };
    const legacy: Record<string, string> = {
      "magna-management:credential-refs:v1": JSON.stringify([ref]),
      "magna-management:wallet-profile:v1": JSON.stringify(profile),
      "magna-management:chain-fingerprint:v1": "v5-chain",
      "magna-management:passport-a2-witnesses:v1": JSON.stringify({
        "0xissuer:0xowner:rooted:99:123": { ...ref, witness },
      }),
      "magna-management:instagram-v2-witnesses:v1": JSON.stringify({
        "0xissuer:0xowner:456": { ownerAddress, claimsHash: "456", instagramHandle: "v5", handleHash: "1", handleBlind: "2" },
      }),
      "magna-management:recovery-v3-finalization:v1": JSON.stringify(pending),
      "magna-management:recovery-target-profile:v1": JSON.stringify(profile),
    };
    for (const [key, value] of Object.entries(legacy)) window.localStorage.setItem(key, value);

    expect(loadCredentialRefs()).toEqual([]);
    expect(loadWalletProfile()).toBeNull();
    expect(loadPendingRecoveryV3Finalization()).toBeNull();
    expect(loadRecoveryTargetProfile()).toBeNull();
    expect(storedChainFingerprintChanged("v6-chain")).toBe(false);
    expect(readPassportA2Witness(ref)).toBeUndefined();
    const instagram = { ...ref, kind: "instagram" as const, claimsHash: "456" };
    expect(replaceCredentialRefsForOwnerFromChain(ownerAddress, "0xissuer", [instagram])[0].instagramHandle).toBeUndefined();

    saveCredentialRefs([ref]);
    saveWalletProfile(profile);
    saveRecoveryTargetProfile(profile);
    savePendingRecoveryV3Finalization(pending);
    commitStoredChainFingerprint("v6-chain", false);
    expect(loadCredentialRefs()).toEqual([ref]);
    expect(loadWalletProfile()).toEqual(profile);
    expect(loadPendingRecoveryV3Finalization()).toEqual(pending);
    clearStoredWalletState();
    expect(loadCredentialRefs()).toEqual([]);
    for (const [key, value] of Object.entries(legacy)) expect(window.localStorage.getItem(key)).toBe(value);
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

  it("replaces local duplicates with the single PXE-discovered credential identity", () => {
    const instagramBase: StoredCredentialRef = {
      id: "local-instagram",
      ownerAddress,
      kind: "instagram",
      status: "active",
      claimsHash: "456",
      createdAt: "2026-09-04T10:46:27.000Z",
      issuerAddress: "0xissuer",
      instagramHandle: "akinspur",
      handleHash: "999",
      handleBlind: "777",
    };
    saveCredentialRefs([
      instagramBase,
      { ...instagramBase, id: "pxe-copy", mode: "passport" },
    ]);

    const refs = replaceCredentialRefsForOwnerFromChain(ownerAddress, "0xissuer", [
      {
        id: "canonical-chain-ref",
        ownerAddress,
        kind: "instagram",
        mode: "passport",
        status: "active",
        claimsHash: "456",
        createdAt: "2026-09-04T11:00:00.000Z",
        issuerAddress: "0xissuer",
        issuanceTxHash: "0xissue",
      },
    ]);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: "canonical-chain-ref",
      mode: "passport",
      claimsHash: "456",
      instagramHandle: "akinspur",
      handleHash: "999",
      handleBlind: "777",
      issuanceTxHash: "0xissue",
    });
    expect(loadCredentialRefs()).toEqual([]);
  });

  it("does not retain a locally cached credential absent from the PXE snapshot", () => {
    saveCredentialRefs([passportRef({ issuerAddress: "0xissuer" })]);

    expect(replaceCredentialRefsForOwnerFromChain(ownerAddress, "0xissuer", [])).toEqual([]);
    expect(loadCredentialRefs()).toEqual([]);
  });

  it("stores and hydrates the A2 local witness from its separate cache", () => {
    const issued = passportRef({
      id: "a2",
      issuerAddress: "0xissuer",
      issuanceKind: "a2",
      ghostOwner: "0xghost",
      recoveryTxHash: "0xrecovery",
      passportCommittedClaimsV2Witness: witness,
    });
    savePassportA2Witness(issued);
    saveCredentialRefs([
      passportRef({ id: "rediscovered", issuerAddress: "0xissuer", passportCommittedClaimsV2Witness: undefined }),
    ]);
    expect(loadCredentialRefs()[0]).toMatchObject({
      issuanceKind: "a2",
      ghostOwner: "0xghost",
      recoveryTxHash: "0xrecovery",
      passportCommittedClaimsV2Witness: witness,
    });
  });

  it("clears chain-specific refs but retains the separate A2 witness cache", () => {
    const ref = passportRef({ issuerAddress: "0xissuer", issuanceKind: "a2", passportCommittedClaimsV2Witness: witness });
    saveCredentialRefs([ref]);
    saveWalletProfile({ address: ownerAddress, walletKind: "webauthn", createdAt: "2026-06-19T00:00:00.000Z" });
    expect(storedChainFingerprintChanged("chain-a")).toBe(false);
    commitStoredChainFingerprint("chain-a", false);
    expect(storedChainFingerprintChanged("chain-b")).toBe(true);
    commitStoredChainFingerprint("chain-b", true);
    expect(loadCredentialRefs()).toEqual([]);
    expect(loadWalletProfile()).toBeNull();
    expect(readPassportA2Witness(ref)).toEqual(witness);
  });

  it("does not accept a replacement chain fingerprint before cache cleanup commits", () => {
    commitStoredChainFingerprint("chain-a", false);
    expect(storedChainFingerprintChanged("chain-b")).toBe(true);
    // Simulate OPFS cleanup failing: no commit occurs, so the next reload must retry.
    expect(storedChainFingerprintChanged("chain-b")).toBe(true);
    commitStoredChainFingerprint("chain-b", true);
    expect(storedChainFingerprintChanged("chain-b")).toBe(false);
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

  it("loads destination-only pending recovery without a source credential", () => {
    const pending = {
      version: 1, phase: "submitted",
      target: { address: "0xtarget", publicKey: "04abcd", walletKind: "passkey", createdAt: "2026-10-28" },
      recoveredCredential: passportRef({ id: "new", ownerAddress: "0xtarget" }),
      createdAt: "2026-10-28", updatedAt: "2026-10-28",
    } as const;
    window.localStorage.setItem("magna-management:aztec6:recovery-v3-finalization:v1", JSON.stringify(pending));
    expect(loadPendingRecoveryV3Finalization()).toEqual(pending);
    window.localStorage.setItem("magna-management:aztec6:recovery-v3-finalization:v1", JSON.stringify({ ...pending, sourceCredentialId: 123 }));
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
