import { describe, expect, it, vi } from "vitest";
import type { PassportWrapperLocalWitness } from "@magna/passport-wrapper-proof/safe";
import {
  PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE,
  REDISCOVERED_PASSPORT_WITNESS_MISSING_MESSAGE,
  assertNoPassportA2PrivateArtifacts,
  issuePassportThroughConfiguredBackend,
  passportA2BindCustomData,
  passportCredentialUsageBlock,
  proofModeForPassportIssuanceKind,
  type VerifiedPassportCompletion,
} from "./passport-issuance";

const completion: VerifiedPassportCompletion = {
  status: "verified",
  proofProfile: "production",
  uniqueIdentifier: "12345",
  proofs: [
    {
      proof: "0x1234",
      name: "outer_count_7",
      version: "0.20.0",
      vkeyHash: "0x19d93a8a69386b80903a8559d884bea729dc1ecc1db48afc6d3bb73d4ed3abbe",
      index: 1,
      total: 1,
      committedInputs: {
        facematch: {
          rootKeyLeaf: "0x2532418a107c5306fa8308c22255792cf77e4a290cbce8a840a642a3e591340b",
          environment: "production",
          appIdHash: "0x1fa73686cf510f8f85757b0602de0dd72a13e68ae2092462be8b72662e7f179b",
          integrityPubkeyHash: "0",
          mode: "strict",
        },
      },
    },
  ] as never,
  originalQuery: { id: "query-1" } as never,
  queryResult: {
    age: { gte: { result: true, expected: 21 } },
    nationality: { disclose: { result: "TUR" } },
    expiry_date: { disclose: { result: "2031-07-20" } },
  } as never,
};

const wrapperPublicInputs = [
  "111",
  "222",
  "333",
  "21",
  "1769817600",
  "789",
  "444",
  "1767225600",
];

function wrapperArtifact() {
  return {
    proof: { proof: new Uint8Array([1, 2, 3]), publicInputs: wrapperPublicInputs },
    publicInputs: wrapperPublicInputs,
    outputs: {
      claimsHash: "111",
      nationalityCommitment: "222",
      expiryCommitment: "333",
      minAgeProven: 21,
      credentialValidUntil: "1769817600",
      rootCommitment: "789",
      requestContextHash: "444",
      proofCurrentDate: "1767225600",
    },
    metadata: {
      registryContext: {
        certificateRegistryRoot: "11",
        circuitRegistryRoot: "22",
        nullifierType: 1,
        oprfPublicKeyHash: "1178201404428554206520802247552222388413553631367032661928167491793274360628",
      },
    },
  } as never;
}

describe("passport A2 management flow", () => {
  it("requests the standard compressed proof and binds every action distinctly", () => {
    expect(proofModeForPassportIssuanceKind("a2")).toBe("compressed");
    expect(
      passportA2BindCustomData({
        action: "issue",
        activeOwner: "0xABC",
        requestScope: "scope",
      }),
    ).toBe("magna-passport-a2:issue:scope:0xabc");
    expect(
      passportA2BindCustomData({ action: "renew", activeOwner: "0xABC", requestScope: "scope" }),
    ).not.toBe(
      passportA2BindCustomData({ action: "recover", activeOwner: "0xABC", requestScope: "scope" }),
    );
  });

  it("submits only the A2 proof and safe public operation fields", async () => {
    const verifyAndIssuePassportA2ThroughBackend = vi.fn().mockResolvedValue({
      issuanceTxHash: "0xa2",
      ghostOwner: "0xghost",
      rootCommitment: "789",
      claimsHash: "111",
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
      issuerAddress: "0xissuer",
      orchestratorAddress: "0xorchestrator",
      verificationSummary: { verified: true, passportA2: true, piiBlind: true },
    });
    const provePassportWrapper = vi.fn(async (_witness: PassportWrapperLocalWitness) => wrapperArtifact());
    const bind = passportA2BindCustomData({
      action: "issue",
      activeOwner: "0xactive",
      requestScope: "magna-passport-onboarding",
    });

    const result = await issuePassportThroughConfiguredBackend(
      {
        issuanceKind: "a2",
        verificationApiUrl: "http://localhost:4310",
        completion,
        activeOwner: "0xactive",
        issuerAddress: "0xissuer",
        ageThreshold: 21,
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
        requestScope: "magna-passport-onboarding",
        a2BindCustomData: bind,
      },
      {
        verifyAndIssuePassportA2ThroughBackend,
        provePassportWrapper,
        deriveGhostAccountPreview: vi.fn(async () => ({
          address: "0xghost",
        })),
        nowMs: () => Date.UTC(2026, 0, 1),
        randomField: vi.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n),
      },
    );

    expect(result.issuanceKind).toBe("a2");
    expect(provePassportWrapper).toHaveBeenCalledTimes(1);
    const witness = provePassportWrapper.mock.calls[0][0];
    expect(witness.profile).toBe("production");
    expect(witness.zkPassportOuterProof.name).toBe("outer_count_7");
    expect(witness.facematch).toMatchObject({ environment: "production", mode: "strict" });
    expect(witness.requestContext).toEqual({
      action: "issue",
      issuer: "0xissuer",
      owner: "0xactive",
      ghostOwner: "0xghost",
      credentialMode: "rooted",
    });

    const payload = verifyAndIssuePassportA2ThroughBackend.mock.calls[0][1];
    expect(payload).toMatchObject({
      schema: "passport-a2-v1",
      activeOwner: "0xactive",
      ghostOwner: "0xghost",
      credentialValidUntil: "1769817600",
      wrapperPublicInputs,
      registryContext: {
        certificateRegistryRoot: "11",
        circuitRegistryRoot: "22",
        nullifierType: 1,
        oprfPublicKeyHash: "1178201404428554206520802247552222388413553631367032661928167491793274360628",
      },
      mode: "rooted",
    });
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "queryResult",
      "originalQuery",
      "proofs",
      "zkPassportOuterProof",
      "zkPassportOuterPublicInputs",
      "uniqueIdentifier",
      "scopedNullifier",
      "nationalityAlpha3",
      "expiryTs",
      "nationalityBlind",
      "expiryBlind",
      "localWitness",
      "hintedRootStatusNote",
      "hintedRootAuthorityNote",
    ]) {
      expect(serialized).not.toContain(`"${forbidden}"`);
    }
    expect(serialized).not.toContain("TUR");
    expect(serialized).not.toContain("2031-07-20");
    expect(result.localWitness.witness.nationalityBlind).toBe(111n);
    expect(result.localWitness.witness.expiryBlind).toBe(222n);
  });

  it("builds a developer witness only from regular official facematch inputs", async () => {
    const developerCompletion: VerifiedPassportCompletion = {
      ...completion,
      proofProfile: "development",
      proofs: completion.proofs.map(proof =>
        proof.committedInputs?.facematch
          ? {
              ...proof,
              committedInputs: {
                facematch: {
                  ...(proof.committedInputs?.facematch as object),
                  mode: "regular",
                },
              },
            }
          : proof,
      ) as never,
    };
    const provePassportWrapper = vi.fn(async (_witness: PassportWrapperLocalWitness) => wrapperArtifact());
    await issuePassportThroughConfiguredBackend(
      {
        issuanceKind: "a2",
        verificationApiUrl: "http://localhost:4310",
        completion: developerCompletion,
        activeOwner: "0xactive",
        issuerAddress: "0xissuer",
        ageThreshold: 21,
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
        a2BindCustomData: passportA2BindCustomData({ action: "issue", activeOwner: "0xactive" }),
      },
      {
        verifyAndIssuePassportA2ThroughBackend: vi.fn().mockResolvedValue({}),
        provePassportWrapper,
        deriveGhostAccountPreview: vi.fn(async () => ({ address: "0xghost" })),
        nowMs: () => Date.UTC(2026, 0, 1),
        randomField: vi.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n),
      },
    );
    expect(provePassportWrapper.mock.calls[0][0]).toMatchObject({
      profile: "development",
      facematch: { environment: "production", mode: "regular" },
    });
  });

  it("rejects secret-bearing note and inner-proof keys recursively", () => {
    expect(() => assertNoPassportA2PrivateArtifacts({ nested: { hintedRootAuthorityNote: {} } })).toThrow(
      /hintedRootAuthorityNote/,
    );
    expect(() => assertNoPassportA2PrivateArtifacts({ nested: { zkPassportOuterProof: {} } })).toThrow(
      /zkPassportOuterProof/,
    );
  });

  it("blocks A2 credentials whose local committed-claims witness is missing", () => {
    expect(passportCredentialUsageBlock({ issuanceKind: "a2" })).toBe(
      PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE,
    );
    expect(passportCredentialUsageBlock({ issuanceKind: "a2", passportCommittedClaimsV2Witness: {} })).toBeUndefined();
    expect(passportCredentialUsageBlock({})).toBe(REDISCOVERED_PASSPORT_WITNESS_MISSING_MESSAGE);
  });
});
