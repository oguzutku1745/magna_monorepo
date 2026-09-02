import { describe, expect, it, vi } from "vitest";

type ProofCallback = (proof: { total: number }) => void;
type ResultCallback = (response: {
  verified: boolean;
  uniqueIdentifier?: string;
  proofs: unknown[];
  result: unknown;
}) => void;

const mockState = vi.hoisted(() => ({
  sdk: undefined as
    | {
        request: ReturnType<typeof vi.fn>;
        cancelRequest: ReturnType<typeof vi.fn>;
        handleEncryptedMessage?: (topic: string, message: { method?: string; params?: unknown }) => Promise<void>;
      }
    | undefined,
  callbacks: {} as { proofGenerated?: ProofCallback; result?: ResultCallback },
  normalizeSharedBrowserG1Cache: vi.fn(async () => undefined),
}));

vi.mock("@zkpassport/sdk", () => ({
  NullifierType: { NON_SALTED: 0, SALTED: 1, NON_SALTED_MOCK: 2, SALTED_MOCK: 3 },
  ZKPassport: vi.fn(() => mockState.sdk),
}));

vi.mock("@magna/passport-wrapper-proof/browser-bb", () => ({
  normalizeSharedBrowserG1Cache: mockState.normalizeSharedBrowserG1Cache,
}));

import {
  startPassportZkRequest,
  verifyAndIssueInstagramThroughBackend,
  verifyAndIssuePassportA2ThroughBackend,
  verifyAndRefreshRootAuthorityThroughBackend,
} from "./zkpassport";

const wrapperPublicInputs = ["1", "2", "3", "21", "1893456000", "4", "5", "6"];

function installFetchResponse(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function serializedRequestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[0][1].body)) as Record<string, unknown>;
}

function expectNoPrivatePassportMaterial(body: Record<string, unknown>) {
  for (const forbidden of [
    "queryResult",
    "committedInputs",
    "originalQuery",
    "proofs",
    "zkPassportOuterProof",
    "zkPassportOuterPublicInputs",
    "uniqueIdentifier",
    "scopedNullifier",
    "expiryTs",
    "nationalityAlpha3",
    "hintedRootStatusNote",
    "hintedRootAuthorityNote",
    "hintedRootRecoveryNote",
    "revocation_secret",
  ]) {
    expect(body[forbidden]).toBeUndefined();
  }
}

function installMockZkPassport() {
  mockState.callbacks = {};
  mockState.normalizeSharedBrowserG1Cache.mockClear();
  const built = {
    requestId: "request-1",
    url: "https://zkpassport.test/request-1",
    query: { id: "query-1" },
    onBridgeConnect: vi.fn(),
    onRequestReceived: vi.fn(),
    onGeneratingProof: vi.fn(),
    onProofGenerated: vi.fn((callback: ProofCallback) => { mockState.callbacks.proofGenerated = callback; }),
    onReject: vi.fn(),
    onError: vi.fn(),
    onResult: vi.fn((callback: ResultCallback) => { mockState.callbacks.result = callback; }),
  };
  const queryBuilder = {
    gte: vi.fn(() => queryBuilder),
    disclose: vi.fn(() => queryBuilder),
    facematch: vi.fn(() => queryBuilder),
    bind: vi.fn(() => queryBuilder),
    done: vi.fn(() => built),
  };
  const sdk = mockState.sdk ?? { request: vi.fn(), cancelRequest: vi.fn(), handleEncryptedMessage: vi.fn() };
  sdk.request = vi.fn(async () => queryBuilder);
  sdk.cancelRequest = vi.fn();
  sdk.handleEncryptedMessage = vi.fn(async () => undefined);
  mockState.sdk = sdk;
  return queryBuilder;
}

describe("startPassportZkRequest", () => {
  it("requests standard compressed mode and A2 bind data", async () => {
    const queryBuilder = installMockZkPassport();
    await startPassportZkRequest({
      ageThreshold: 18,
      proofMode: "compressed",
      a2BindCustomData: "magna-passport-a2:issue:scope:0xactive",
      metadata: { name: "Magna", logo: "https://magna.test/logo.png", purpose: "Issue" },
    });
    expect(mockState.sdk?.request).toHaveBeenCalledWith(expect.objectContaining({
      mode: "compressed",
      uniqueIdentifierType: 1,
      oprfKeyId: "1",
    }));
    expect(queryBuilder.disclose).toHaveBeenNthCalledWith(1, "document_type");
    expect(queryBuilder.disclose).toHaveBeenNthCalledWith(2, "nationality");
    expect(queryBuilder.disclose).toHaveBeenNthCalledWith(3, "expiry_date");
    expect(queryBuilder.bind).toHaveBeenCalledWith("custom_data", "magna-passport-a2:issue:scope:0xactive");
    expect(queryBuilder.facematch).toHaveBeenCalledWith("strict");
  });

  it("uses official regular facematch for the zkPassport developer profile", async () => {
    const queryBuilder = installMockZkPassport();
    const request = await startPassportZkRequest({
      ageThreshold: 18,
      devMode: true,
      metadata: { name: "Magna", logo: "https://magna.test/logo.png", purpose: "Develop" },
    });
    expect(mockState.sdk?.request).toHaveBeenCalledWith(expect.objectContaining({
      devMode: true,
      uniqueIdentifierType: 0,
    }));
    expect(mockState.sdk?.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ oprfKeyId: expect.anything() }),
    );
    expect(queryBuilder.facematch).toHaveBeenCalledWith("regular");
    mockState.callbacks.result?.({
      verified: true,
      uniqueIdentifier: "12345",
      proofs: [],
      result: {},
    });
    await expect(request.completion).resolves.toMatchObject({
      status: "verified",
      proofProfile: "development",
    });
  });

  it("waits for onResult so local recovery receives the unique identifier", async () => {
    installMockZkPassport();
    const request = await startPassportZkRequest({
      ageThreshold: 18,
      metadata: { name: "Magna", logo: "https://magna.test/logo.png", purpose: "Recover" },
    });
    let settled = false;
    void request.completion.then(() => { settled = true; });
    mockState.callbacks.proofGenerated?.({ total: 1 });
    await mockState.sdk?.handleEncryptedMessage?.("request-1", { method: "done", params: {} });
    expect(mockState.normalizeSharedBrowserG1Cache).toHaveBeenCalledWith(2 ** 19);
    expect(mockState.normalizeSharedBrowserG1Cache).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(settled).toBe(false);
    mockState.callbacks.result?.({
      verified: true,
      uniqueIdentifier: "12345",
      proofs: [{ id: "proof" }],
      result: { id: "result" },
    });
    await expect(request.completion).resolves.toMatchObject({
      status: "verified",
      uniqueIdentifier: "12345",
      proofProfile: "production",
    });
  });
});

describe("verifyAndIssuePassportA2ThroughBackend", () => {
  it("serializes only the recursive wrapper payload", async () => {
    const fetchMock = installFetchResponse({
        ghostOwner: "0xghost",
        rootCommitment: "12345",
        claimsHash: "67890",
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
        issuerAddress: "0xissuer",
        orchestratorAddress: "0xorchestrator",
        verificationSummary: { verified: true, passportA2: true, piiBlind: true },
    });
    await verifyAndIssuePassportA2ThroughBackend("http://localhost:4310", {
      schema: "passport-a2-v1",
      activeOwner: "0xactive",
      ghostOwner: "0xghost",
      credentialValidUntil: "1893456000",
      wrapperProof: { proof: new Uint8Array([0, 1, 2, 255]), publicInputs: ["1"] },
      wrapperPublicInputs,
      registryContext: {
        certificateRegistryRoot: "11",
        circuitRegistryRoot: "22",
        nullifierType: 1,
        oprfPublicKeyHash: "33",
      },
      mode: "rooted",
      ghostDerivationVersion: "v2_scoped",
    });
    const body = serializedRequestBody(fetchMock);
    expect(body.schema).toBe("passport-a2-v1");
    expect(body.registryContext).toEqual({
      certificateRegistryRoot: "11",
      circuitRegistryRoot: "22",
      nullifierType: 1,
      oprfPublicKeyHash: "33",
    });
    expect((body.wrapperProof as { proof: string }).proof).toBe("0x000102ff");
    expectNoPrivatePassportMaterial(body);
  });

  it("keeps renewal notes and revocation secrets local", async () => {
    const fetchMock = installFetchResponse({
      renewalAuthorizationTxHash: "0xauthorize",
      ghostOwner: "0xghost",
      rootCommitment: "4",
      claimsHash: "1",
      issuerAddress: "0xissuer",
      orchestratorAddress: "0xorchestrator",
      verificationSummary: { verified: true, passportA2: true, piiBlind: true },
    });
    await verifyAndRefreshRootAuthorityThroughBackend("http://localhost:4310", {
      schema: "passport-a2-v1",
      activeOwner: "0xactive",
      ghostOwner: "0xghost",
      credentialValidUntil: "1893456000",
      wrapperProof: { proof: new Uint8Array([1]), publicInputs: wrapperPublicInputs },
      wrapperPublicInputs,
      registryContext: {
        certificateRegistryRoot: "11",
        circuitRegistryRoot: "22",
        nullifierType: 1,
        oprfPublicKeyHash: "33",
      },
    });
    const body = serializedRequestBody(fetchMock);
    expect(body).toMatchObject({ activeOwner: "0xactive", ghostOwner: "0xghost" });
    expectNoPrivatePassportMaterial(body);
  });

});

describe("verifyAndIssueInstagramThroughBackend", () => {
  it("posts only the browser proof and destination owner to the Instagram endpoint", async () => {
    const fetchMock = installFetchResponse({
      issuanceTxHash: "0xinstagram",
      ghostOwner: "0xghost",
      claimsHash: "123",
      ghostDerivationVersion: "v2_scoped",
      issuerAddress: "0xissuer",
      orchestratorAddress: "0xorchestrator",
      verificationSummary: {
        verified: true,
        piiBlind: true,
        dkimPubkeyHash: "0xkey",
        emailNullifier: "0xnullifier",
      },
      expiryTs: "1893456000",
    });

    await verifyAndIssueInstagramThroughBackend("http://localhost:4310/", {
      schema: "instagram-v2",
      proof: { proof: [1, 2, 3], publicInputs: ["1", "2", "3", "4", "5", "6", "7"] },
      activeOwner: "0xactive",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4310/instagram/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(serializedRequestBody(fetchMock)).toEqual({
      schema: "instagram-v2",
      proof: { proof: [1, 2, 3], publicInputs: ["1", "2", "3", "4", "5", "6", "7"] },
      activeOwner: "0xactive",
    });
  });
});
