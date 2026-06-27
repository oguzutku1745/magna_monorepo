import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimId, ConstraintOp, CredentialType, type Policy } from "@magna/core";
import { loadCredentialRefs, saveCredentialRefs, type StoredCredentialRef } from "./storage";

const testState = vi.hoisted(() => {
  const activeAddress = "0x2222222222222222222222222222222222222222";
  const disconnect = vi.fn(async () => undefined);
  const computeInstagramHandleHash = vi.fn(() => 999n);
  const createWebAuthnWalletSession = vi.fn(async () => ({
    wallet: { id: "wallet" },
    activeAccount: { address: activeAddress },
    metadata: { deploymentStatus: "deployed" },
    disconnect,
  }));
  const runMagnaConsumerLogin = vi.fn(async () => ({ verified: true, receipt: "0xlogin" }));

  return {
    activeAddress,
    computeInstagramHandleHash,
    createWebAuthnWalletSession,
    disconnect,
    runMagnaConsumerLogin,
  };
});

vi.mock("@magna/wallet", () => ({
  computeInstagramHandleHash: testState.computeInstagramHandleHash,
  createWebAuthnWalletSession: testState.createWebAuthnWalletSession,
  runMagnaConsumerLogin: testState.runMagnaConsumerLogin,
}));

vi.mock("./env", () => ({
  getManagementEnv: () => ({
    aztecNodeUrl: "http://127.0.0.1:8080",
    enableLocalTestBootstrap: false,
    issuerAddress: "0xissuer",
    localTestAccountIndex: 0,
    orchestratorAddress: "0xorchestrator",
  }),
}));

import { runWalletLoginForRequest } from "./wallet-login";

const policy: Policy = {
  credentialType: CredentialType.Passport,
  constraints: [
    {
      claimId: ClaimId.AgeMinProven,
      op: ConstraintOp.Gte,
      value: 18n,
    },
  ],
};

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

function passportRef(overrides: Partial<StoredCredentialRef> = {}): StoredCredentialRef {
  return {
    id: overrides.id ?? "passport",
    ownerAddress: overrides.ownerAddress ?? testState.activeAddress,
    kind: "passport",
    status: "active",
    claimsHash: overrides.claimsHash ?? "123",
    createdAt: "2026-06-19T00:00:00.000Z",
    issuerAddress: overrides.issuerAddress ?? "0xissuer",
    mode: "rooted",
    rootCommitment: "99",
    normalizedClaims: {
      nationalityAlpha3: "ZKR",
      minAgeProven: 18,
      passportExpiryDate: "2030-01-01",
      expiryTs: "1893456000",
    },
    ...overrides,
  };
}

function instagramRef(overrides: Partial<StoredCredentialRef> = {}): StoredCredentialRef {
  return {
    id: overrides.id ?? "instagram",
    ownerAddress: overrides.ownerAddress ?? testState.activeAddress,
    kind: "instagram",
    status: "active",
    claimsHash: overrides.claimsHash ?? "456",
    createdAt: "2026-06-19T00:00:00.000Z",
    issuerAddress: overrides.issuerAddress ?? "0xissuer",
    instagramHandle: "akinspur",
    handleHash: "999",
    ...overrides,
  };
}

describe("runWalletLoginForRequest", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", {
      location: { hostname: "localhost" },
      localStorage: makeLocalStorage(),
    });
    testState.createWebAuthnWalletSession.mockClear();
    testState.computeInstagramHandleHash.mockClear();
    testState.disconnect.mockClear();
    testState.runMagnaConsumerLogin.mockReset();
    testState.runMagnaConsumerLogin.mockResolvedValue({ verified: true, receipt: "0xlogin" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("surfaces missing credential errors instead of returning a hidden negative assertion", async () => {
    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).rejects.toThrow("No active Magna passport credential is available in this wallet session.");

    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("surfaces consumer verification failures instead of returning a hidden negative assertion", async () => {
    saveCredentialRefs([passportRef()]);
    testState.runMagnaConsumerLogin.mockRejectedValueOnce(new Error("policy constraint failed"));

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).rejects.toThrow("policy constraint failed");

    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("clears stale local credential refs when hinted notes are missing on the current chain", async () => {
    saveCredentialRefs([passportRef()]);
    testState.runMagnaConsumerLogin.mockRejectedValueOnce(
      new Error(
        "Fetch rooted hinted notes failed for root 99 claims hash 123 on owner " +
          `${testState.activeAddress}: Assertion failed: Failed to get a note 'assert(self.is_some(), message)'`,
      ),
    );

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).rejects.toThrow("Stored Magna credential notes were not found on the current Aztec chain.");

    expect(loadCredentialRefs()).toEqual([]);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("runs mixed passport and instagram requirements in one wallet session", async () => {
    saveCredentialRefs([passportRef(), instagramRef()]);
    testState.runMagnaConsumerLogin
      .mockResolvedValueOnce({ verified: true, receipt: "0xpassport" })
      .mockResolvedValueOnce({ verified: true, receipt: "0xinstagram" });

    const outcome = await runWalletLoginForRequest({
      policy,
      requirements: [
        { id: "passport", kind: "policy", policy },
        { id: "instagram", kind: "instagram-handle", handle: "akinspur" },
      ],
      consumerGatewayAddress: "0xconsumer",
    });

    expect(outcome).toEqual({
      verified: true,
      receipt: "0xpassport",
      receipts: [
        { id: "passport", kind: "policy", receipt: "0xpassport" },
        { id: "instagram", kind: "instagram-handle", receipt: "0xinstagram" },
      ],
    });
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledTimes(2);
    const [passportCall, instagramCall] = testState.runMagnaConsumerLogin.mock.calls as unknown as [
      [{ credential: StoredCredentialRef; policy: Policy }],
      [{ credential: StoredCredentialRef; policy: Policy }],
    ];
    expect(passportCall[0].credential.kind).toBe("passport");
    expect(instagramCall[0].policy.credentialType).toBe(CredentialType.Instagram);
    expect(instagramCall[0].credential.kind).toBe("instagram");
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });
});
