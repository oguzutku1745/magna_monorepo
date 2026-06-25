import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@zkpassport/sdk", () => ({
  ZKPassport: class MockZKPassport {},
}));

import { verifyAndIssuePassportPilotThroughBackend, verifyRootRecoveryPreflightThroughBackend } from "./zkpassport";

describe("verifyRootRecoveryPreflightThroughBackend", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts rooted recovery proofs to the dedicated preflight endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        expectedGhostOwner: "0xghost",
        derivedGhostOwner: "0xghost",
        expectedRootCommitment: "12345",
        derivedRootCommitment: "12345",
        ghostDerivationVersion: "v2_scoped",
        matchesExpectedGhostOwner: true,
        matchesExpectedRootCommitment: true,
        verificationSummary: {
          verified: true,
          uniqueIdentifierPresent: true,
        },
        normalizedClaims: {
          nationalityAlpha3: "DEU",
          minAgeProven: 21,
          passportExpiryDate: "2031-07-20",
          expiryTs: "1932249600",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyRootRecoveryPreflightThroughBackend("http://localhost:4310", {
      proofs: [{ id: "proof-1" }] as never[],
      originalQuery: { id: "query-1" } as never,
      queryResult: { id: "result-1" } as never,
      expectedGhostOwner: "0xghost",
      expectedRootCommitment: "12345",
      ghostDerivationVersion: "v2_scoped",
      ageThreshold: 21,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4310/zkpassport/verify-for-root-recovery",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result.matchesExpectedGhostOwner).toBe(true);
    expect(result.ghostDerivationVersion).toBe("v2_scoped");
  });

  it("surfaces backend errors for rooted recovery preflight", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "Fresh zkPassport proof does not match the configured ghost owner.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyRootRecoveryPreflightThroughBackend("http://localhost:4310", {
        proofs: [{ id: "proof-1" }] as never[],
        originalQuery: { id: "query-1" } as never,
        queryResult: { id: "result-1" } as never,
        expectedGhostOwner: "0xghost",
        expectedRootCommitment: "12345",
        ghostDerivationVersion: "v2_scoped",
        ageThreshold: 21,
      }),
    ).rejects.toThrow("Verification API request failed");
  });

  it("posts no-PII pilot issuance payload without zkPassport artifacts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuanceTxHash: "0xtx",
        ghostOwner: "0xghost",
        rootCommitment: "12345",
        claimsHash: "67890",
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
        orchestratorAddress: "0xorchestrator",
        verificationSummary: {
          verified: true,
          pilot: true,
          piiBlind: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await verifyAndIssuePassportPilotThroughBackend("http://localhost:4310", {
      pilotSchema: "passport-pii-blind-v0",
      activeOwner: "0xactive",
      claimsHash: "67890",
      ghostOwner: "0xghost",
      rootCommitment: "12345",
      credentialValidUntil: "1893456000",
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.queryResult).toBeUndefined();
    expect(body.committedInputs).toBeUndefined();
    expect(body.outerProof).toBeUndefined();
    expect(body.expiryTs).toBeUndefined();
    expect(body.pilotSchema).toBe("passport-pii-blind-v0");
  });
});
