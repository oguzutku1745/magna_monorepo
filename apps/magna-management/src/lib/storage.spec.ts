import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCredentialRefs,
  loadWalletProfile,
  readPassportA2Witness,
  reconcileStoredChainFingerprint,
  refsForOwner,
  saveCredentialRefs,
  savePassportA2Witness,
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
});
