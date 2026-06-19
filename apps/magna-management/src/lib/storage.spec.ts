import { beforeEach, describe, expect, it, vi } from "vitest";
import { refsForOwner, saveCredentialRefs, upsertCredentialRef, type StoredCredentialRef } from "./storage";

const ownerAddress = "0xowner";

function passportRef(overrides: Partial<StoredCredentialRef>): StoredCredentialRef {
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
    normalizedClaims: {
      nationalityAlpha3: "ZKR",
      minAgeProven: 18,
      passportExpiryDate: "2030-01-01",
      expiryTs: "1893456000",
    },
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
});
