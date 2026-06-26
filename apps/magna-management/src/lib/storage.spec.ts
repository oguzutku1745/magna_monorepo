import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCredentialRefs, refsForOwner, saveCredentialRefs, upsertCredentialRef, type StoredCredentialRef } from "./storage";

const ownerAddress = "0xowner";

function passportRef(overrides: Partial<StoredCredentialRef>): StoredCredentialRef {
  const normalizedClaims = {
    nationalityAlpha3: "ZKR",
    minAgeProven: 18,
    passportExpiryDate: "2030-01-01",
    expiryTs: "1893456000",
  };
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
    normalizedClaims: "normalizedClaims" in overrides ? overrides.normalizedClaims : normalizedClaims,
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
        setItem: vi.fn((key: string, value: string) => {
          store.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          store.delete(key);
        }),
      },
    });
  });

  it("filters owner refs to the current issuer deployment when configured", () => {
    saveCredentialRefs([
      passportRef({ id: "old", issuerAddress: "0xoldissuer" }),
      passportRef({ id: "current", issuerAddress: "0xcurrentissuer" }),
      passportRef({ id: "other-owner", ownerAddress: "0xother", issuerAddress: "0xcurrentissuer" }),
    ]);

    expect(refsForOwner(ownerAddress, { issuerAddress: "0xcurrentissuer" }).map(ref => ref.id)).toEqual([
      "current",
    ]);
  });

  it("keys upserts by issuer so re-issuing after redeploy does not overwrite old local refs", () => {
    upsertCredentialRef(passportRef({ id: "same-local-id", issuerAddress: "0xoldissuer" }));
    const refs = upsertCredentialRef(passportRef({ id: "same-local-id", issuerAddress: "0xnewissuer" }));

    expect(refs.map(ref => ref.issuerAddress).sort()).toEqual(["0xnewissuer", "0xoldissuer"]);
  });

  it("stores and reloads schema-tagged A1 witness metadata locally", () => {
    const witness = {
      schema: "passport-committed-claims-v2" as const,
      credentialAuthenticity: "passport-a1" as const,
      minAgeProven: 21,
      nationalityAlpha3Packed: "5526610",
      nationalityBlind: "111",
      expiryTs: "1942358399",
      expiryBlind: "222",
    };

    upsertCredentialRef(
      passportRef({
        id: "a1",
        issuanceKind: "a1",
        normalizedClaims: undefined,
        passportCommittedClaimsV2Witness: witness,
      }),
    );

    const stored = loadCredentialRefs()[0];
    expect(stored).toMatchObject({
      id: "a1",
      issuanceKind: "a1",
      passportCommittedClaimsV2Witness: witness,
    });
    expect(stored.normalizedClaims).toBeUndefined();
  });

  it("preserves existing legacy refs with normalized claims", () => {
    const legacy = passportRef({ id: "legacy", issuanceKind: "legacy" });

    saveCredentialRefs([legacy]);

    expect(loadCredentialRefs()).toEqual([legacy]);
    expect(refsForOwner(ownerAddress)[0].normalizedClaims).toEqual({
      nationalityAlpha3: "ZKR",
      minAgeProven: 18,
      passportExpiryDate: "2030-01-01",
      expiryTs: "1893456000",
    });
  });
});
