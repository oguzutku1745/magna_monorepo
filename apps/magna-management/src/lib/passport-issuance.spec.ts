import { describe, expect, it, vi } from "vitest";
import {
  A1_LOCAL_WITNESS_MISSING_MESSAGE,
  A1_UNAVAILABLE_MESSAGE,
  issuePassportThroughConfiguredBackend,
  passportPilotCredentialUsageBlock,
  PILOT_CREDENTIAL_UNUSABLE_MESSAGE,
  REDISCOVERED_PASSPORT_WITNESS_MISSING_MESSAGE,
  proofModeForPassportIssuanceKind,
  type VerifiedPassportCompletion,
} from "./passport-issuance";
import {
  buildMinimalZkPassportWitnessFromDisclosures,
  computeZkPassportParameterCommitmentManifestCandidates,
} from "../../../../packages/magna-wallet/src/engine/zkpassport-safe-witness";

const completion: VerifiedPassportCompletion = {
  status: "verified",
  uniqueIdentifier: "12345",
  proofs: [{ id: "proof-1" }] as never[],
  originalQuery: { id: "query-1" } as never,
  queryResult: {
    age: {
      gte: {
        result: true,
        expected: 21,
      },
    },
    nationality: {
      disclose: {
        result: "TUR",
      },
    },
    expiry_date: {
      disclose: {
        result: "2031-07-20",
      },
    },
  } as never,
};

const validOuterPublicInputs = await (async () => {
  const candidates = await computeZkPassportParameterCommitmentManifestCandidates(
    buildMinimalZkPassportWitnessFromDisclosures({
      nationalityAlpha3: "TUR",
      expiryTs: 1942358399n,
      agePredicate: { minAge: 21, maxAge: 0 },
      bind: { customData: "magna-passport-a1:magna-passport-onboarding:0xactive" },
    }),
  );
  const manifest = candidates[0].manifest;
  return [
    "0",
    "1",
    "2",
    "33",
    "44",
    manifest.nationalityDisclosureCommitment,
    manifest.expiryDisclosureCommitment,
    manifest.agePredicateCommitment,
    manifest.bindCommitment,
    "1",
    "999",
    "1000",
  ];
})();
const a1Completion: VerifiedPassportCompletion = {
  ...completion,
  proofs: [
    {
      proof: "compressed-zkpassport-proof",
      publicInputs: validOuterPublicInputs,
    },
  ] as never[],
};

const legacyResponse = {
  issuanceTxHash: "0xlegacy",
  ghostOwner: "0xghost",
  rootCommitment: "123",
  claimsHash: "456",
  mode: "rooted" as const,
  ghostDerivationVersion: "v2_scoped" as const,
  issuerAddress: "0xissuer",
  orchestratorAddress: "0xorchestrator",
  normalizedClaims: {
    nationalityAlpha3: "TUR",
    minAgeProven: 21,
    passportExpiryDate: "2031-07-20",
    expiryTs: "1942358399",
  },
};

describe("passport issuance routing", () => {
  it("keeps legacy mode on the legacy verify-and-issue backend", async () => {
    const verifyAndIssueThroughBackend = vi.fn().mockResolvedValue(legacyResponse);
    const verifyAndIssuePassportPilotThroughBackend = vi.fn();

    const result = await issuePassportThroughConfiguredBackend(
      {
        issuanceKind: "legacy",
        verificationApiUrl: "http://localhost:4310",
        completion,
        activeOwner: "0xactive",
        ageThreshold: 21,
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
      },
      {
        verifyAndIssueThroughBackend,
        verifyAndIssuePassportPilotThroughBackend,
      },
    );

    expect(result.issuanceKind).toBe("legacy");
    expect(verifyAndIssueThroughBackend).toHaveBeenCalledWith("http://localhost:4310", {
      proofs: completion.proofs,
      originalQuery: completion.originalQuery,
      queryResult: completion.queryResult,
      activeOwner: "0xactive",
      ageThreshold: 21,
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
    });
    expect(verifyAndIssuePassportPilotThroughBackend).not.toHaveBeenCalled();
  });

  it("routes pilot mode through the no-PII pilot backend payload", async () => {
    const verifyAndIssueThroughBackend = vi.fn();
    const verifyAndIssuePassportPilotThroughBackend = vi.fn().mockResolvedValue({
      issuanceTxHash: "0xpilot",
      ghostOwner: "0xghost",
      rootCommitment: "789",
      claimsHash: "987",
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
      orchestratorAddress: "0xorchestrator",
      verificationSummary: {
        verified: true,
        pilot: true,
        piiBlind: true,
      },
    });

    const result = await issuePassportThroughConfiguredBackend(
      {
        issuanceKind: "pilot",
        verificationApiUrl: "http://localhost:4310",
        completion,
        activeOwner: "0xactive",
        ageThreshold: 21,
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
        preparedGhostOwner: "0xghost",
      },
      {
        verifyAndIssueThroughBackend,
        verifyAndIssuePassportPilotThroughBackend,
        deriveGhostAccountPreview: vi.fn(async () => ({
          address: "0xghost",
          material: {} as never,
          uniqueIdentifier: "12345",
          rootCommitment: 789n,
        })),
        nowMs: () => Date.UTC(2026, 0, 1, 0, 0, 0),
        randomField: vi.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n),
      },
    );

    expect(result.issuanceKind).toBe("pilot");
    expect(verifyAndIssueThroughBackend).not.toHaveBeenCalled();
    expect(verifyAndIssuePassportPilotThroughBackend).toHaveBeenCalledTimes(1);

    const payload = verifyAndIssuePassportPilotThroughBackend.mock.calls[0][1];
    expect(payload).toMatchObject({
      pilotSchema: "passport-pii-blind-v0",
      activeOwner: "0xactive",
      ghostOwner: "0xghost",
      rootCommitment: "789",
      credentialValidUntil: "1769817600",
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
    });
    expect(payload.claimsHash).toMatch(/^[0-9]+$/);
    for (const forbidden of [
      "queryResult",
      "originalQuery",
      "proofs",
      "committedInputs",
      "outerProof",
      "expiryTs",
      "uniqueIdentifier",
      "nationality",
      "nationalityBlind",
      "expiryBlind",
      "localWitness",
      "passportCommittedClaimsV2Witness",
    ]) {
      expect(JSON.stringify(payload)).not.toContain(`"${forbidden}"`);
    }
    expect(JSON.stringify(payload)).not.toContain("TUR");
    expect(JSON.stringify(payload)).not.toContain("2031-07-20");
  });

  it("routes a1 mode through the wrapper-proof payload without raw zkPassport artifacts", async () => {
    const verifyAndIssueThroughBackend = vi.fn();
    const verifyAndIssuePassportPilotThroughBackend = vi.fn();
    const verifyAndIssuePassportA1ThroughBackend = vi.fn().mockResolvedValue({
      issuanceTxHash: "0xa1",
      ghostOwner: "0xghost",
      rootCommitment: "789",
      claimsHash: "111",
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
      issuerAddress: "0xissuer",
      orchestratorAddress: "0xorchestrator",
      verificationSummary: {
        verified: true,
        passportA1: true,
        piiBlind: true,
      },
    });
    const provePassportWrapper = vi.fn(async () => ({
      proof: {
        proof: "wrapper-proof",
        publicInputs: ["111", "222", "333", "21", "1769817600", "999", "555", "666", "777", "888"],
      },
      publicInputs: ["111", "222", "333", "21", "1769817600", "999", "555", "666", "777", "888"],
      outputs: {
        claimsHash: "111",
        credentialValidUntil: "1769817600",
      },
    }));

    const result = await issuePassportThroughConfiguredBackend(
      {
        issuanceKind: "a1",
        verificationApiUrl: "http://localhost:4310",
        completion: a1Completion,
        activeOwner: "0xactive",
        ageThreshold: 21,
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
        requestScope: "magna-passport-onboarding",
      },
      {
        verifyAndIssueThroughBackend,
        verifyAndIssuePassportPilotThroughBackend,
        verifyAndIssuePassportA1ThroughBackend,
        provePassportWrapper,
        deriveGhostAccountPreview: vi.fn(async () => ({
          address: "0xghost",
          material: {} as never,
          uniqueIdentifier: "12345",
          rootCommitment: 789n,
        })),
        nowMs: () => Date.UTC(2026, 0, 1, 0, 0, 0),
        randomField: vi.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n),
      },
    );

    expect(result.issuanceKind).toBe("a1");
    expect(provePassportWrapper).toHaveBeenCalledTimes(1);
    expect(verifyAndIssueThroughBackend).not.toHaveBeenCalled();
    expect(verifyAndIssuePassportPilotThroughBackend).not.toHaveBeenCalled();
    expect(verifyAndIssuePassportA1ThroughBackend).toHaveBeenCalledTimes(1);

    const payload = verifyAndIssuePassportA1ThroughBackend.mock.calls[0][1];
    expect(payload).toMatchObject({
      schema: "passport-a1-v1",
      activeOwner: "0xactive",
      ghostOwner: "0xghost",
      rootCommitment: "789",
      credentialValidUntil: "1769817600",
      wrapperPublicInputs: ["111", "222", "333", "21", "1769817600", "999", "555", "666", "777", "888"],
      zkPassportOuterProof: {
        proof: "compressed-zkpassport-proof",
      },
      zkPassportOuterPublicInputs: validOuterPublicInputs,
      claimsHash: "111",
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
    });
    for (const forbidden of [
      "queryResult",
      "originalQuery",
      "proofs",
      "committedInputs",
      "expiryTs",
      "nationality",
      "uniqueIdentifier",
      "nationalityBlind",
      "expiryBlind",
      "localWitness",
      "passportCommittedClaimsV2Witness",
    ]) {
      expect(JSON.stringify(payload)).not.toContain(`"${forbidden}"`);
    }
    expect(JSON.stringify(payload)).not.toContain("TUR");
    expect(JSON.stringify(payload)).not.toContain("2031-07-20");
    if (result.issuanceKind !== "a1") {
      throw new Error("expected a1 issuance result");
    }
    expect(result.localWitness.nationalityBlind).toBe("111");
    expect(result.localWitness.expiryBlind).toBe("222");
  });

  it("fails clearly when a1 wrapper proof generation is unavailable", async () => {
    await expect(
      issuePassportThroughConfiguredBackend(
        {
          issuanceKind: "a1",
          verificationApiUrl: "http://localhost:4310",
          completion: a1Completion,
          activeOwner: "0xactive",
          ageThreshold: 21,
          mode: "rooted",
          ghostDerivationVersion: "v2_scoped",
          requestScope: "magna-passport-onboarding",
        },
        {
          verifyAndIssueThroughBackend: vi.fn(),
          verifyAndIssuePassportPilotThroughBackend: vi.fn(),
          verifyAndIssuePassportA1ThroughBackend: vi.fn(),
          deriveGhostAccountPreview: vi.fn(async () => ({
            address: "0xghost",
            material: {} as never,
            uniqueIdentifier: "12345",
            rootCommitment: 789n,
          })),
          randomField: vi.fn().mockReturnValueOnce(111n).mockReturnValueOnce(222n),
          nowMs: () => Date.UTC(2026, 0, 1, 0, 0, 0),
        },
      ),
    ).rejects.toThrow(A1_UNAVAILABLE_MESSAGE);
  });

  it("requests compressed-evm proofs for pilot and a1 issuance", () => {
    expect(proofModeForPassportIssuanceKind("legacy")).toBeUndefined();
    expect(proofModeForPassportIssuanceKind("pilot")).toBe("compressed-evm");
    expect(proofModeForPassportIssuanceKind("a1")).toBe("compressed-evm");
  });

  it("blocks pilot credentials from relying-party verification, renewal, and recovery paths", () => {
    expect(passportPilotCredentialUsageBlock({ issuanceKind: "pilot" })).toBe(PILOT_CREDENTIAL_UNUSABLE_MESSAGE);
    expect(passportPilotCredentialUsageBlock({ issuanceKind: "a1" })).toBe(A1_LOCAL_WITNESS_MISSING_MESSAGE);
    expect(
      passportPilotCredentialUsageBlock({
        issuanceKind: "a1",
        passportCommittedClaimsV2Witness: {
          schema: "passport-committed-claims-v2",
          credentialAuthenticity: "passport-a1",
          minAgeProven: 21,
          nationalityAlpha3Packed: "5526610",
          nationalityBlind: "111",
          expiryTs: "1942358399",
          expiryBlind: "222",
        },
      }),
    ).toBeUndefined();
    expect(passportPilotCredentialUsageBlock({ issuanceKind: "legacy" })).toBeUndefined();
    expect(passportPilotCredentialUsageBlock(null)).toBeUndefined();
  });

  it("blocks rediscovered passport refs that lack legacy evidence", () => {
    expect(passportPilotCredentialUsageBlock({})).toBe(REDISCOVERED_PASSPORT_WITNESS_MISSING_MESSAGE);
  });

  it("allows refs with a local A1 witness even when issuance kind metadata is missing", () => {
    expect(
      passportPilotCredentialUsageBlock({
        passportCommittedClaimsV2Witness: {
          schema: "passport-committed-claims-v2",
          credentialAuthenticity: "passport-a1",
          minAgeProven: 21,
          nationalityAlpha3Packed: "5526610",
          nationalityBlind: "111",
          expiryTs: "1942358399",
          expiryBlind: "222",
        },
      }),
    ).toBeUndefined();
  });

  it("allows older local legacy refs when normalized claims prove legacy issuance", () => {
    expect(
      passportPilotCredentialUsageBlock({
        normalizedClaims: {
          nationalityAlpha3: "TUR",
          minAgeProven: 21,
          passportExpiryDate: "2031-07-20",
          expiryTs: "1942358399",
        },
      }),
    ).toBeUndefined();
  });
});
