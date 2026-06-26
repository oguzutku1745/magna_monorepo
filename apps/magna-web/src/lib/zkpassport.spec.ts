import { afterEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  sdk: undefined as
    | {
        request: ReturnType<typeof vi.fn>;
        cancelRequest: ReturnType<typeof vi.fn>;
      }
    | undefined,
}));

vi.mock("@zkpassport/sdk", () => ({
  ZKPassport: vi.fn(() => mockState.sdk),
}));

import {
  startPassportZkRequest,
  verifyAndIssuePassportA1ThroughBackend,
  verifyAndIssuePassportPilotThroughBackend,
  verifyRootRecoveryPreflightThroughBackend,
} from "./zkpassport";

function installMockZkPassport() {
  const built = {
    requestId: "request-1",
    url: "https://zkpassport.test/request-1",
    query: { id: "query-1" },
    onBridgeConnect: vi.fn(),
    onRequestReceived: vi.fn(),
    onGeneratingProof: vi.fn(),
    onProofGenerated: vi.fn(),
    onReject: vi.fn(),
    onError: vi.fn(),
    onResult: vi.fn(),
  };
  const queryBuilder = {
    gte: vi.fn(() => queryBuilder),
    disclose: vi.fn(() => queryBuilder),
    bind: vi.fn(() => queryBuilder),
    done: vi.fn(() => built),
  };
  const sdk = mockState.sdk ?? {
    request: vi.fn(),
    cancelRequest: vi.fn(),
  };
  sdk.request = vi.fn(async () => queryBuilder);
  sdk.cancelRequest = vi.fn();
  mockState.sdk = sdk;
}

describe("startPassportZkRequest", () => {
  it("requests compressed-evm mode when proofMode is provided", async () => {
    installMockZkPassport();
    await startPassportZkRequest({
      ageThreshold: 18,
      proofMode: "compressed-evm",
      metadata: {
        name: "Magna",
        logo: "https://magna.test/logo.png",
        purpose: "Issue",
      },
    });

    expect(mockState.sdk?.request).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "compressed-evm",
      }),
    );
  });

  it("binds A1 custom data when provided", async () => {
    installMockZkPassport();
    await startPassportZkRequest({
      ageThreshold: 18,
      a1BindCustomData: "magna-passport-a1:scope:0xactive",
      metadata: {
        name: "Magna",
        logo: "https://magna.test/logo.png",
        purpose: "Issue",
      },
    });

    const queryBuilder = await mockState.sdk?.request.mock.results[0].value;
    expect(queryBuilder.bind).toHaveBeenCalledWith("custom_data", "magna-passport-a1:scope:0xactive");
  });
});

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

  it("posts A1 issuance payload without raw zkPassport artifacts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuanceTxHash: "0xtx",
        ghostOwner: "0xghost",
        rootCommitment: "12345",
        claimsHash: "67890",
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
        issuerAddress: "0xissuer",
        orchestratorAddress: "0xorchestrator",
        verificationSummary: {
          verified: true,
          passportA1: true,
          piiBlind: true,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await verifyAndIssuePassportA1ThroughBackend("http://localhost:4310", {
      schema: "passport-a1-v1",
      activeOwner: "0xactive",
      ghostOwner: "0xghost",
      rootCommitment: "12345",
      credentialValidUntil: "1893456000",
      wrapperProof: { proof: "wrapper-proof", publicInputs: ["67890", "2", "3", "21", "1893456000", "0"] },
      wrapperPublicInputs: ["67890", "2", "3", "21", "1893456000", "0"],
      claimsHash: "67890",
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.schema).toBe("passport-a1-v1");
    expect(body.queryResult).toBeUndefined();
    expect(body.committedInputs).toBeUndefined();
    expect(body.originalQuery).toBeUndefined();
    expect(body.proofs).toBeUndefined();
    expect(body.outerPublicInputs).toBeUndefined();
    expect(body.expiryTs).toBeUndefined();
    expect(body.nationality).toBeUndefined();
    expect(body.uniqueIdentifier).toBeUndefined();
  });
});
