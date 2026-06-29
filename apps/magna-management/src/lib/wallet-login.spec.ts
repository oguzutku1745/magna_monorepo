import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimId, ConstraintOp, CredentialType, type Policy } from "@magna/core";
import { loadCredentialRefs, saveCredentialRefs, savePassportA1Witness, type StoredCredentialRef } from "./storage";

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
  const discoverCredentialRefs = vi.fn<() => Promise<unknown[]>>(async () => []);

  return {
    activeAddress,
    computeInstagramHandleHash,
    createWebAuthnWalletSession,
    discoverCredentialRefs,
    disconnect,
    runMagnaConsumerLogin,
  };
});

vi.mock("@magna/wallet", () => ({
  computeInstagramHandleHash: testState.computeInstagramHandleHash,
  createWebAuthnWalletSession: testState.createWebAuthnWalletSession,
  MagnaBrowserClient: class {
    discoverCredentialRefs = testState.discoverCredentialRefs;
  },
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
    testState.discoverCredentialRefs.mockReset();
    testState.discoverCredentialRefs.mockResolvedValue([]);
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

  it("uses locally stored A1 committed-claims witnesses for passport login", async () => {
    const a1Witness = {
      schema: "passport-committed-claims-v2" as const,
      credentialAuthenticity: "passport-a1" as const,
      minAgeProven: 18,
      nationalityAlpha3Packed: "5929810",
      nationalityBlind: "111",
      expiryTs: "1893456000",
      expiryBlind: "222",
    };
    saveCredentialRefs([
      passportRef({
        issuanceKind: "a1",
        normalizedClaims: undefined,
        passportCommittedClaimsV2Witness: a1Witness,
      }),
    ]);

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).resolves.toMatchObject({ verified: true, receipt: "0xlogin" });

    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    const calls = testState.runMagnaConsumerLogin.mock.calls as unknown as [
      [{ credential: { committedClaimsWitness?: unknown; passportCommittedClaimsV2Witness?: unknown } }],
    ];
    const call = calls[0][0];
    expect(call.credential.committedClaimsWitness).toEqual(a1Witness);
    expect(call.credential.passportCommittedClaimsV2Witness).toEqual(a1Witness);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("fails clearly when an A1 passport credential is missing its local witness", async () => {
    saveCredentialRefs([
      passportRef({
        issuanceKind: "a1",
        normalizedClaims: undefined,
        passportCommittedClaimsV2Witness: undefined,
      }),
    ]);

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).rejects.toThrow("Passport A1 credential is missing its local v2 witness");
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("does not attempt login when the session resolves to the fee payer account", async () => {
    testState.createWebAuthnWalletSession.mockResolvedValueOnce({
      wallet: { id: "wallet" },
      activeAccount: { address: "0xorchestrator" },
      metadata: { deploymentStatus: "deployed", feePayer: "0xorchestrator" },
      disconnect: testState.disconnect,
    } as never);
    saveCredentialRefs([passportRef({ ownerAddress: "0xorchestrator" })]);

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).rejects.toThrow("resolved to the local fee payer/orchestrator account");

    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps local refs and asks for PXE resync when hinted notes are still missing after rediscovery", async () => {
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
    ).rejects.toThrow("PXE could not read the matching private notes");

    expect(testState.discoverCredentialRefs).toHaveBeenCalledWith(testState.activeAddress);
    expect(loadCredentialRefs()).toHaveLength(1);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("reconciles refs from PXE note discovery before verification", async () => {
    saveCredentialRefs([passportRef({ id: "stale", mode: "passport", rootCommitment: undefined })]);
    testState.discoverCredentialRefs.mockResolvedValueOnce([
      {
        ownerAddress: testState.activeAddress,
        kind: "passport",
        mode: "rooted",
        claimsHash: "123",
        rootCommitment: "99",
        issuanceTxHash: "0xissue",
      },
    ]);
    testState.runMagnaConsumerLogin.mockResolvedValueOnce({ verified: true, receipt: "0xlogin" });

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).resolves.toMatchObject({ verified: true, receipt: "0xlogin" });

    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    const loginCalls = testState.runMagnaConsumerLogin.mock.calls as unknown as Array<[
      { credential: Partial<StoredCredentialRef> },
    ]>;
    expect(loginCalls[0]?.[0].credential).toMatchObject({
      claimsHash: "123",
      rootCommitment: "99",
    });
    expect(loadCredentialRefs().some(ref => ref.claimsHash === "123" && ref.issuanceTxHash === "0xissue")).toBe(true);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("hydrates a rediscovered passport ref from the witness cache before login", async () => {
    const a1Witness = {
      schema: "passport-committed-claims-v2" as const,
      credentialAuthenticity: "passport-a1" as const,
      minAgeProven: 18,
      nationalityAlpha3Packed: "5929810",
      nationalityBlind: "111",
      expiryTs: "1893456000",
      expiryBlind: "222",
    };
    savePassportA1Witness(
      passportRef({
        issuanceKind: "a1",
        normalizedClaims: undefined,
        passportCommittedClaimsV2Witness: a1Witness,
      }),
    );
    testState.discoverCredentialRefs.mockResolvedValueOnce([
      {
        ownerAddress: testState.activeAddress,
        kind: "passport",
        mode: "rooted",
        claimsHash: "123",
        rootCommitment: "99",
        issuanceTxHash: "0xissue",
      },
    ]);

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
      }),
    ).resolves.toMatchObject({ verified: true, receipt: "0xlogin" });

    expect(testState.discoverCredentialRefs).toHaveBeenCalledWith(testState.activeAddress);
    const calls = testState.runMagnaConsumerLogin.mock.calls as unknown as [
      [{ credential: { committedClaimsWitness?: unknown; passportCommittedClaimsV2Witness?: unknown } }],
    ];
    expect(calls[0][0].credential.committedClaimsWitness).toEqual(a1Witness);
    expect(calls[0][0].credential.passportCommittedClaimsV2Witness).toEqual(a1Witness);
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

  it("identifies the failing requirement when a mixed login cannot read hinted notes", async () => {
    saveCredentialRefs([passportRef(), instagramRef()]);
    testState.runMagnaConsumerLogin
      .mockResolvedValueOnce({ verified: true, receipt: "0xpassport" })
      .mockRejectedValueOnce(new Error("status note not found"));

    await expect(
      runWalletLoginForRequest({
        policy,
        requirements: [
          { id: "passport", kind: "policy", policy },
          { id: "instagram", kind: "instagram-handle", handle: "akinspur" },
        ],
        consumerGatewayAddress: "0xconsumer",
      }),
    ).rejects.toThrow("requirement instagram, instagram-handle, instagram claims hash 456, @akinspur");

    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledTimes(2);
    expect(testState.discoverCredentialRefs).toHaveBeenCalledWith(testState.activeAddress);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("does not retry a mixed-login requirement after successful PXE preflight discovery", async () => {
    saveCredentialRefs([passportRef(), instagramRef()]);
    testState.discoverCredentialRefs.mockResolvedValue([
      {
        ownerAddress: testState.activeAddress,
        kind: "passport",
        mode: "rooted",
        claimsHash: "123",
        rootCommitment: "99",
      },
      {
        ownerAddress: testState.activeAddress,
        kind: "instagram",
        mode: undefined,
        claimsHash: "456",
      },
    ]);
    testState.runMagnaConsumerLogin.mockRejectedValueOnce(new Error("linked status note not found"));

    await expect(
      runWalletLoginForRequest({
        policy,
        requirements: [
          { id: "passport", kind: "policy", policy },
          { id: "instagram", kind: "instagram-handle", handle: "akinspur" },
        ],
        consumerGatewayAddress: "0xconsumer",
      }),
    ).rejects.toThrow("requirement passport, policy, passport claims hash 123, root 99");

    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    expect(testState.discoverCredentialRefs).toHaveBeenCalledOnce();
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });
});
