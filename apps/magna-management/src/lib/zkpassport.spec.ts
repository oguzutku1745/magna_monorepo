import { describe, expect, it, vi } from "vitest";

type ProofCallback = (proof: { total: number }) => void;
type ResultCallback = (response: {
  verified: boolean;
  uniqueIdentifier?: string;
  proofs: unknown[];
  result: unknown;
  queryResultErrors?: unknown;
}) => void;

const mockState = vi.hoisted(() => ({
  sdk: undefined as
    | {
        request: ReturnType<typeof vi.fn>;
        cancelRequest: ReturnType<typeof vi.fn>;
        handleEncryptedMessage?: (topic: string, message: { method?: string; params?: unknown }) => Promise<void>;
      }
    | undefined,
  callbacks: {} as {
    proofGenerated?: ProofCallback;
    result?: ResultCallback;
  },
}));

vi.mock("@zkpassport/sdk", () => ({
  ZKPassport: vi.fn(() => mockState.sdk),
}));

import { startPassportZkRequest, verifyAndIssuePassportPilotThroughBackend } from "./zkpassport";

function installMockZkPassport() {
  mockState.callbacks = {};
  const built = {
    requestId: "request-1",
    url: "https://zkpassport.test/request-1",
    query: { id: "query-1" },
    onBridgeConnect: vi.fn(),
    onRequestReceived: vi.fn(),
    onGeneratingProof: vi.fn(),
    onProofGenerated: vi.fn((callback: ProofCallback) => {
      mockState.callbacks.proofGenerated = callback;
    }),
    onReject: vi.fn(),
    onError: vi.fn(),
    onResult: vi.fn((callback: ResultCallback) => {
      mockState.callbacks.result = callback;
    }),
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
    handleEncryptedMessage: vi.fn(async () => undefined),
  };
  sdk.request = vi.fn(async () => queryBuilder);
  sdk.cancelRequest = vi.fn();
  sdk.handleEncryptedMessage = vi.fn(async () => undefined);
  mockState.sdk = sdk;
  return { built };
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

  it("waits for zkPassport onResult so recovery receives uniqueIdentifier", async () => {
    installMockZkPassport();
    const events: string[] = [];
    const request = await startPassportZkRequest({
      ageThreshold: 18,
      metadata: {
        name: "Magna",
        logo: "https://magna.test/logo.png",
        purpose: "Recover",
      },
      onEvent: event => events.push(event.type),
    });

    let settled = false;
    void request.completion.then(() => {
      settled = true;
    });

    mockState.callbacks.proofGenerated?.({ total: 1 });
    await mockState.sdk?.handleEncryptedMessage?.("request-1", {
      method: "done",
      params: { id: "raw-query-result" },
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(events).toContain("query_result_received");

    mockState.callbacks.result?.({
      verified: true,
      uniqueIdentifier: "12345",
      proofs: [{ id: "sdk-proof" }],
      result: { id: "verified-query-result" },
    });

    await expect(request.completion).resolves.toMatchObject({
      status: "verified",
      uniqueIdentifier: "12345",
      queryResult: { id: "verified-query-result" },
    });
  });
});

describe("verifyAndIssuePassportPilotThroughBackend", () => {
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
