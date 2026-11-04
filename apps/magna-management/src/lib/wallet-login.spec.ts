import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimId, ConstraintOp, CredentialType, type Policy } from "@magna-protocol/core";
import { loadCredentialRefs, saveCredentialRefs, savePassportA2Witness, type StoredCredentialRef } from "./storage";

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
  const checkMagnaConsumerLoginAllowance = vi.fn(async (_input: unknown) => undefined);
  const runMagnaConsumerLogin = vi.fn(async () => ({ verified: true, receipt: "0xlogin", authorizationContract: "0xsponsor" }));
  const discoverCredentialRefs = vi.fn<() => Promise<unknown[]>>(async () => []);

  const fetchPassportHintsByClaimsHash = vi.fn(async (_owner: string, claimsHash: string) => ({
    claimsHash, hintedCredentialNote: { claimsHash }, hintedStatusNote: { claimsHash },
  }));
  const fetchLinkedInstagramHints = vi.fn(async (rootCommitment: string, claimsHash: string) => ({
    claimsHash, rootCommitment, hintedCredentialNote: { claimsHash }, hintedStatusNote: { claimsHash },
    hintedRootStatusNote: { rootCommitment },
  }));
  const fetchRootedPassportHintsByClaimsHash = vi.fn(async (_owner: string, rootCommitment: string, claimsHash: string) => ({
    claimsHash, rootCommitment, hintedCredentialNote: { claimsHash }, hintedStatusNote: { claimsHash },
    hintedRootStatusNote: { rootCommitment }, hintedRootAuthorityNote: { rootCommitment, claimsHash },
  }));
  const readRootedPassportChainState = vi.fn(async (_hints: unknown) => ({ status: "active", reason: "chain-valid" }));
  const readInstagramChainState = vi.fn(async (_hints: unknown) => ({ status: "active", reason: "chain-valid" }));

  return {
    fetchPassportHintsByClaimsHash,
    fetchRootedPassportHintsByClaimsHash,
    readRootedPassportChainState,
    fetchLinkedInstagramHints,
    readInstagramChainState,
    activeAddress,
    computeInstagramHandleHash,
    createWebAuthnWalletSession,
    discoverCredentialRefs,
    disconnect,
    runMagnaConsumerLogin,
    checkMagnaConsumerLoginAllowance,
  };
});

vi.mock("@magna/wallet", () => ({
  computeInstagramHandleHash: testState.computeInstagramHandleHash,
  createWebAuthnWalletSession: testState.createWebAuthnWalletSession,
  MagnaBrowserClient: class {
    discoverCredentialRefs = testState.discoverCredentialRefs;
    fetchPassportHintsByClaimsHash = testState.fetchPassportHintsByClaimsHash;
    fetchLinkedInstagramHints = testState.fetchLinkedInstagramHints;
    fetchRootedPassportHintsByClaimsHash = testState.fetchRootedPassportHintsByClaimsHash;
    readRootedPassportChainState = testState.readRootedPassportChainState;
    readInstagramChainState = testState.readInstagramChainState;
  },
  isRootedPassportHints: (hints: object) => "hintedRootAuthorityNote" in hints,
  runMagnaConsumerLogin: testState.runMagnaConsumerLogin,
  checkMagnaConsumerLoginAllowance: testState.checkMagnaConsumerLoginAllowance,
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

import { runWalletLoginForRequest, runWalletLoginForRequestWithSession } from "./wallet-login";

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
    issuanceKind: "a2",
    passportCommittedClaimsV2Witness: {
      schema: "passport-committed-claims-v2",
      credentialAuthenticity: "passport-a2",
      minAgeProven: 18,
      nationalityAlpha3Packed: "5921618",
      nationalityBlind: "111",
      expiryTs: "1893456000",
      expiryBlind: "222",
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
    handleBlind: "777",
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
    testState.discoverCredentialRefs.mockImplementation(async () =>
      loadCredentialRefs().map(ref => ({
        ownerAddress: ref.ownerAddress,
        kind: ref.kind,
        mode: ref.mode ?? "passport",
        claimsHash: ref.claimsHash,
        rootCommitment: ref.rootCommitment,
        issuanceTxHash: ref.issuanceTxHash,
      })),
    );
    testState.fetchPassportHintsByClaimsHash.mockClear();
    testState.fetchLinkedInstagramHints.mockClear();
    testState.fetchRootedPassportHintsByClaimsHash.mockClear();
    testState.readRootedPassportChainState.mockReset();
    testState.readRootedPassportChainState.mockResolvedValue({ status: "active", reason: "chain-valid" });
    testState.readInstagramChainState.mockReset();
    testState.readInstagramChainState.mockResolvedValue({ status: "active", reason: "chain-valid" });
    testState.disconnect.mockClear();
    testState.checkMagnaConsumerLoginAllowance.mockReset();
    testState.checkMagnaConsumerLoginAllowance.mockResolvedValue(undefined);
    testState.runMagnaConsumerLogin.mockReset();
    testState.runMagnaConsumerLogin.mockResolvedValue({ verified: true, receipt: "0xlogin", authorizationContract: "0xsponsor" });
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
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow("No active Magna passport credential is available in this wallet session.");

    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("does not authorize a browser-only credential that PXE does not discover", async () => {
    saveCredentialRefs([passportRef()]);
    testState.discoverCredentialRefs.mockResolvedValueOnce([]);

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow("No active Magna passport credential is available in this wallet session.");

    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
    expect(loadCredentialRefs()).toEqual([]);
  });

  it("reuses an already-open wallet session without opening or disconnecting PXE", async () => {
    saveCredentialRefs([passportRef()]);
    const existingWallet = { id: "existing-wallet" };
    const existingSession = {
      wallet: existingWallet,
      activeAccount: { address: testState.activeAddress },
      metadata: { deploymentStatus: "deployed" },
      disconnect: testState.disconnect,
    } as never;

    await expect(
      runWalletLoginForRequestWithSession(
        {
          policy,
          consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
        },
        existingSession,
      ),
    ).resolves.toMatchObject({ verified: true, receipt: "0xlogin", authorizationContract: "0xsponsor" });

    expect(testState.createWebAuthnWalletSession).not.toHaveBeenCalled();
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: existingWallet }),
    );
    expect(testState.disconnect).not.toHaveBeenCalled();
  });

  it("opens the explicitly selected stored passkey for standalone authorization", async () => {
    saveCredentialRefs([passportRef()]);

    await runWalletLoginForRequest({
      policy,
      consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      storedCredentialId: "selected-passkey-id",
    });

    expect(testState.createWebAuthnWalletSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        storedCredentialId: "selected-passkey-id",
      }),
    );
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("surfaces consumer verification failures instead of returning a hidden negative assertion", async () => {
    saveCredentialRefs([passportRef()]);
    testState.runMagnaConsumerLogin.mockRejectedValueOnce(new Error("policy constraint failed"));

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow("policy constraint failed");

    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("uses locally stored A2 committed-claims witnesses for passport login", async () => {
    const a2Witness = {
      schema: "passport-committed-claims-v2" as const,
      credentialAuthenticity: "passport-a2" as const,
      minAgeProven: 18,
      nationalityAlpha3Packed: "5929810",
      nationalityBlind: "111",
      expiryTs: "1893456000",
      expiryBlind: "222",
    };
    saveCredentialRefs([
      passportRef({
        issuanceKind: "a2",
        normalizedClaims: undefined,
        passportCommittedClaimsV2Witness: a2Witness,
      }),
    ]);

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).resolves.toMatchObject({ verified: true, receipt: "0xlogin", authorizationContract: "0xsponsor" });

    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    const calls = testState.runMagnaConsumerLogin.mock.calls as unknown as [
      [{ credential: { committedClaimsWitness?: unknown; passportCommittedClaimsV2Witness?: unknown } }],
    ];
    const call = calls[0][0];
    expect(call.credential.committedClaimsWitness).toEqual(a2Witness);
    expect(call.credential.passportCommittedClaimsV2Witness).toEqual(a2Witness);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("fails clearly when an A2 passport credential is missing its local witness", async () => {
    saveCredentialRefs([
      passportRef({
        issuanceKind: "a2",
        normalizedClaims: undefined,
        passportCommittedClaimsV2Witness: undefined,
      }),
    ]);

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow("Passport A2 credential is missing its local committed-claims witness");
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
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow("resolved to the local fee payer/orchestrator account");

    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("asks for PXE resync without retaining credential refs when hinted notes are missing", async () => {
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
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow("PXE could not read the matching private notes");

    expect(testState.discoverCredentialRefs).toHaveBeenCalledWith(testState.activeAddress);
    expect(loadCredentialRefs()).toEqual([]);
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
    testState.runMagnaConsumerLogin.mockResolvedValueOnce({ verified: true, receipt: "0xlogin", authorizationContract: "0xsponsor" });

    await expect(
      runWalletLoginForRequest({
        policy,
        consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).resolves.toMatchObject({ verified: true, receipt: "0xlogin", authorizationContract: "0xsponsor" });

    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    const loginCalls = testState.runMagnaConsumerLogin.mock.calls as unknown as Array<[
      { credential: Partial<StoredCredentialRef> },
    ]>;
    expect(loginCalls[0]?.[0].credential).toMatchObject({
      claimsHash: "123",
      rootCommitment: "99",
    });
    expect(loadCredentialRefs()).toEqual([]);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("hydrates a rediscovered passport ref from the witness cache before login", async () => {
    const a2Witness = {
      schema: "passport-committed-claims-v2" as const,
      credentialAuthenticity: "passport-a2" as const,
      minAgeProven: 18,
      nationalityAlpha3Packed: "5929810",
      nationalityBlind: "111",
      expiryTs: "1893456000",
      expiryBlind: "222",
    };
    savePassportA2Witness(
      passportRef({
        issuanceKind: "a2",
        normalizedClaims: undefined,
        passportCommittedClaimsV2Witness: a2Witness,
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
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).resolves.toMatchObject({ verified: true, receipt: "0xlogin", authorizationContract: "0xsponsor" });

    expect(testState.discoverCredentialRefs).toHaveBeenCalledWith(testState.activeAddress);
    const calls = testState.runMagnaConsumerLogin.mock.calls as unknown as [
      [{ credential: { committedClaimsWitness?: unknown; passportCommittedClaimsV2Witness?: unknown } }],
    ];
    expect(calls[0][0].credential.committedClaimsWitness).toEqual(a2Witness);
    expect(calls[0][0].credential.passportCommittedClaimsV2Witness).toEqual(a2Witness);
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("routes rediscovered linked Instagram with its root while retaining the independent witness cache", async () => {
    saveCredentialRefs([instagramRef({ mode: "passport" })]);
    testState.discoverCredentialRefs.mockResolvedValueOnce([{
      ownerAddress: testState.activeAddress, kind: "instagram", mode: "rooted", rootCommitment: "99", claimsHash: "456",
    }]);
    await runWalletLoginForRequest({
      policy, requirements: [{ id: "instagram", kind: "instagram-handle", handle: "akinspur" }],
      consumerGatewayAddress: "0xconsumer", sessionRequestId: "11".repeat(16),
      sessionChallenge: `00${"22".repeat(31)}`, sessionExpiresAt: 1_800_000_000,
    });
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ kind: "instagram", mode: "rooted", rootCommitment: "99", claimsHash: "456", handleBlind: "777" }),
    }));
  });

  it("preflights all credential allowances before spending any sponsored verification", async () => {
    saveCredentialRefs([passportRef(), instagramRef()]);
    const exhausted = new Error("Today's sponsored verification allowance for your Instagram credential has been used. Try again after tomorrow.");
    testState.checkMagnaConsumerLoginAllowance.mockResolvedValueOnce(undefined).mockRejectedValueOnce(exhausted);
    await expect(runWalletLoginForRequest({
      policy,
      requirements: [{ id: "passport", kind: "policy", policy }, { id: "instagram", kind: "instagram-handle", handle: "akinspur" }],
      consumerGatewayAddress: "0xconsumer", sessionRequestId: "11".repeat(16),
      sessionChallenge: `00${"22".repeat(31)}`, sessionExpiresAt: 1_800_000_000,
    })).rejects.toBe(exhausted);
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("counts multiple requirements against the same credential during preflight", async () => {
    saveCredentialRefs([passportRef()]);
    const exhausted = new Error("Not enough sponsored verification allowance to complete this login.");
    testState.checkMagnaConsumerLoginAllowance.mockImplementation(async (input: unknown) => {
      if ((input as { requiredSlots: number }).requiredSlots === 2) throw exhausted;
    });
    await expect(runWalletLoginForRequest({
      policy, requirements: [{ id: "age", kind: "policy", policy }, { id: "other", kind: "policy", policy }],
      consumerGatewayAddress: "0xconsumer", sessionRequestId: "11".repeat(16),
      sessionChallenge: `00${"22".repeat(31)}`, sessionExpiresAt: 1_800_000_000,
    })).rejects.toBe(exhausted);
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });

  it("runs mixed passport and instagram requirements in one wallet session", async () => {
    saveCredentialRefs([passportRef(), instagramRef()]);
    testState.runMagnaConsumerLogin
      .mockResolvedValueOnce({ verified: true, receipt: "0xpassport", authorizationContract: "0xsponsor" })
      .mockResolvedValueOnce({ verified: true, receipt: "0xinstagram", authorizationContract: "0xsponsor" });

    const outcome = await runWalletLoginForRequest({
      policy,
      requirements: [
        { id: "passport", kind: "policy", policy },
        { id: "instagram", kind: "instagram-handle", handle: "akinspur" },
      ],
      consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
    });

    expect(outcome).toEqual({
      verified: true,
      authorizationContract: "0xsponsor",
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
      .mockResolvedValueOnce({ verified: true, receipt: "0xpassport", authorizationContract: "0xsponsor" })
      .mockRejectedValueOnce(new Error("status note not found"));

    await expect(
      runWalletLoginForRequest({
        policy,
        requirements: [
          { id: "passport", kind: "policy", policy },
          { id: "instagram", kind: "instagram-handle", handle: "akinspur" },
        ],
        consumerGatewayAddress: "0xconsumer",
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
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
        mode: "passport",
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
        sessionRequestId: "11".repeat(16),
        sessionChallenge: `00${"22".repeat(31)}`,
        sessionExpiresAt: 1_800_000_000,
      }),
    ).rejects.toThrow("requirement passport, policy, passport claims hash 123, root 99");

    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    expect(testState.discoverCredentialRefs).toHaveBeenCalledOnce();
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  const instagramLogin = () => runWalletLoginForRequest({
    policy, requirements: [{ id: "instagram", kind: "instagram-handle", handle: "akinspur" }],
    consumerGatewayAddress: "0xconsumer", sessionRequestId: "11".repeat(16),
    sessionChallenge: `00${"22".repeat(31)}`, sessionExpiresAt: 1_800_000_000,
  });

  it("selects fresh independent B when oldest discovered A is owner-revoked", async () => {
    saveCredentialRefs([
      instagramRef({ id: "A", mode: "passport", claimsHash: "456" }),
      instagramRef({ id: "B", mode: "passport", claimsHash: "789", handleBlind: "888" }),
    ]);
    testState.readInstagramChainState.mockImplementation(async hints => ({
      status: (hints as { claimsHash: string }).claimsHash === "456" ? "inactive" : "active",
      reason: (hints as { claimsHash: string }).claimsHash === "456" ? "credential-revoked" : "chain-valid",
    }));
    await instagramLogin();
    expect(testState.fetchPassportHintsByClaimsHash.mock.calls).toEqual([
      [testState.activeAddress, "456"], [testState.activeAddress, "789"],
    ]);
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ claimsHash: "789", handleBlind: "888", mode: "passport" }),
    }));
    expect(testState.readInstagramChainState.mock.calls[0][0]).toMatchObject({ claimsHash: "456", hintedStatusNote: { claimsHash: "456" } });
  });

  it("skips root-revoked linked A and selects a usable witnessed linked sibling", async () => {
    saveCredentialRefs([
      instagramRef({ id: "A", mode: "rooted", claimsHash: "456", rootCommitment: "99" }),
      instagramRef({ id: "B", mode: "rooted", claimsHash: "789", rootCommitment: "100", handleBlind: "888" }),
    ]);
    testState.readInstagramChainState.mockImplementation(async hints => ({
      status: (hints as { rootCommitment: string }).rootCommitment === "99" ? "inactive" : "active",
      reason: (hints as { rootCommitment: string }).rootCommitment === "99" ? "root-owner-revoked" : "chain-valid",
    }));
    await instagramLogin();
    expect(testState.fetchLinkedInstagramHints.mock.calls).toEqual([["99", "456"], ["100", "789"]]);
    expect(testState.fetchPassportHintsByClaimsHash).not.toHaveBeenCalled();
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ claimsHash: "789", rootCommitment: "100", handleBlind: "888", mode: "rooted" }),
    }));
    expect(testState.readInstagramChainState.mock.calls[0][0]).toMatchObject({ rootCommitment: "99", hintedRootStatusNote: { rootCommitment: "99" } });
  });

  it("permits a distinct fresh-blind independent sibling after linked root revocation", async () => {
    saveCredentialRefs([
      instagramRef({ id: "A", mode: "rooted", claimsHash: "456", rootCommitment: "99" }),
      instagramRef({ id: "B", mode: "passport", claimsHash: "789", handleBlind: "888" }),
    ]);
    testState.readInstagramChainState.mockImplementation(async hints => ({
      status: (hints as { claimsHash: string }).claimsHash === "456" ? "inactive" : "active", reason: "root-owner-revoked",
    }));
    await instagramLogin();
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ claimsHash: "789", mode: "passport", handleBlind: "888" }),
    }));
  });

  it("fails closed when every discovered instance is inactive", async () => {
    saveCredentialRefs([
      instagramRef({ mode: "rooted", rootCommitment: "99" }),
      instagramRef({ id: "B", mode: "passport", claimsHash: "789" }),
    ]);
    testState.readInstagramChainState.mockResolvedValue({ status: "inactive", reason: "credential-revoked" });
    await expect(instagramLogin()).rejects.toThrow("No active Magna Instagram credential");
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
    expect(testState.fetchPassportHintsByClaimsHash.mock.calls).toEqual([[testState.activeAddress, "789"]]);
  });

  it("never downgrades a revoked linked instance to a same-claims standalone copy", async () => {
    saveCredentialRefs([
      instagramRef({ id: "A", mode: "rooted", rootCommitment: "99" }),
      instagramRef({ id: "stale-copy", mode: "passport" }),
    ]);
    testState.readInstagramChainState.mockImplementation(async hints => ({
      status: "rootCommitment" in (hints as object) ? "inactive" : "active", reason: "root-owner-revoked",
    }));
    await expect(instagramLogin()).rejects.toThrow("No active Magna Instagram credential");
    expect(testState.fetchPassportHintsByClaimsHash).not.toHaveBeenCalled();
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });

  it("chooses a witnessed sibling when the first active instance has no local handle blind", async () => {
    saveCredentialRefs([
      instagramRef({ handleBlind: undefined }),
      instagramRef({ id: "B", mode: "passport", claimsHash: "789", handleBlind: "888" }),
    ]);
    await instagramLogin();
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ claimsHash: "789", handleBlind: "888" }),
    }));
  });

  it("propagates lifecycle discovery failure without using cached or standalone authorization", async () => {
    saveCredentialRefs([
      instagramRef({ mode: "rooted", rootCommitment: "99" }),
      instagramRef({ id: "B", mode: "passport", claimsHash: "789" }),
    ]);
    testState.fetchLinkedInstagramHints.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(instagramLogin()).rejects.toThrow("network unavailable");
    expect(testState.fetchPassportHintsByClaimsHash).not.toHaveBeenCalled();
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });


  it("uses chain validity when Instagram is requested by policy rather than handle requirement", async () => {
    saveCredentialRefs([
      instagramRef({ claimsHash: "456" }),
      instagramRef({ id: "B", claimsHash: "789", handleBlind: "888" }),
    ]);
    testState.readInstagramChainState.mockImplementation(async hints => ({
      status: (hints as { claimsHash: string }).claimsHash === "456" ? "inactive" : "active", reason: "credential-revoked",
    }));
    await runWalletLoginForRequest({
      policy: { credentialType: CredentialType.Instagram, constraints: [
        { claimId: ClaimId.InstagramHandleHash, op: ConstraintOp.Eq, value: 999n },
      ] },
      consumerGatewayAddress: "0xconsumer", sessionRequestId: "11".repeat(16),
      sessionChallenge: `00${"22".repeat(31)}`, sessionExpiresAt: 1_800_000_000,
    });
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ claimsHash: "789", handleBlind: "888" }),
    }));
  });

  it("propagates chain-state reader failure before authorizing a discovered Instagram instance", async () => {
    saveCredentialRefs([instagramRef()]);
    testState.readInstagramChainState.mockRejectedValueOnce(new Error("node unavailable"));
    await expect(instagramLogin()).rejects.toThrow("node unavailable");
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });

  it("fails closed for linked Instagram without a root instead of trying standalone hints", async () => {
    saveCredentialRefs([instagramRef({ mode: "rooted", rootCommitment: undefined })]);
    await expect(instagramLogin()).rejects.toThrow("Linked credential is missing its root commitment");
    expect(testState.fetchPassportHintsByClaimsHash).not.toHaveBeenCalled();
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });

  it("preserves rootless Passport login with its local A2 witness", async () => {
    saveCredentialRefs([passportRef({ mode: "passport", rootCommitment: undefined })]);
    await expect(runWalletLoginForRequest({
      policy, consumerGatewayAddress: "0xconsumer", sessionRequestId: "11".repeat(16),
      sessionChallenge: `00${"22".repeat(31)}`, sessionExpiresAt: 1_800_000_000,
    })).resolves.toMatchObject({ verified: true, receipt: "0xlogin" });
    expect(testState.readInstagramChainState).not.toHaveBeenCalled();
  });


  const passportLogin = () => runWalletLoginForRequest({
    policy, consumerGatewayAddress: "0xconsumer", sessionRequestId: "11".repeat(16),
    sessionChallenge: `00${"22".repeat(31)}`, sessionExpiresAt: 1_800_000_000,
  });

  it.each([
    ["inactive", "root-lineage-revoked-or-recovered"],
    ["expired", "root-authority-expired"],
  ])("skips old %s rooted Passport and authorizes its usable restored sibling", async (status, reason) => {
    saveCredentialRefs([
      passportRef({ id: "old", claimsHash: "123", rootCommitment: "99" }),
      passportRef({ id: "restored", claimsHash: "321", rootCommitment: "99" }),
    ]);
    testState.readRootedPassportChainState.mockImplementation(async hints => ({
      status: (hints as { claimsHash: string }).claimsHash === "123" ? status : "active",
      reason: (hints as { claimsHash: string }).claimsHash === "123" ? reason : "chain-valid",
    }));
    await passportLogin();
    expect(testState.fetchRootedPassportHintsByClaimsHash.mock.calls).toEqual([
      [testState.activeAddress, "99", "123"], [testState.activeAddress, "99", "321"],
    ]);
    expect(testState.readRootedPassportChainState.mock.calls[0][0]).toMatchObject({
      claimsHash: "123", rootCommitment: "99", hintedRootAuthorityNote: { rootCommitment: "99", claimsHash: "123" },
    });
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledOnce();
    expect(testState.runMagnaConsumerLogin).toHaveBeenCalledWith(expect.objectContaining({
      credential: expect.objectContaining({ kind: "passport", mode: "rooted", claimsHash: "321", rootCommitment: "99" }),
    }));
  });

  it("fails closed when all discovered rooted Passports are chain-invalid", async () => {
    saveCredentialRefs([
      passportRef({ claimsHash: "123" }), passportRef({ id: "B", claimsHash: "321" }),
    ]);
    testState.readRootedPassportChainState.mockResolvedValue({ status: "inactive", reason: "root-owner-revoked" });
    await expect(passportLogin()).rejects.toThrow("No active Magna passport credential");
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });

  it("propagates rooted Passport chain-reader failure without authorizing cached state", async () => {
    saveCredentialRefs([passportRef()]);
    testState.readRootedPassportChainState.mockRejectedValueOnce(new Error("node unavailable"));
    await expect(passportLogin()).rejects.toThrow("node unavailable");
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });


  it("does not downgrade a rooted Passport with missing root metadata to rootless login", async () => {
    saveCredentialRefs([passportRef({ rootCommitment: undefined })]);
    await expect(passportLogin()).rejects.toThrow("Linked credential is missing its root commitment");
    expect(testState.fetchPassportHintsByClaimsHash).not.toHaveBeenCalled();
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });

  it("does not treat a rooted Passport with unavailable lifecycle state as active", async () => {
    saveCredentialRefs([passportRef()]);
    testState.fetchRootedPassportHintsByClaimsHash.mockResolvedValueOnce({
      claimsHash: "123", hintedCredentialNote: {}, hintedStatusNote: {},
    } as never);
    await expect(passportLogin()).rejects.toThrow("No active Magna passport credential");
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });


  it("never downgrades an invalid rooted Passport to a same-claims rootless copy", async () => {
    saveCredentialRefs([
      passportRef({ id: "rooted" }),
      passportRef({ id: "rootless-copy", mode: "passport", rootCommitment: undefined }),
    ]);
    testState.readRootedPassportChainState.mockResolvedValue({ status: "inactive", reason: "root-owner-revoked" });
    await expect(passportLogin()).rejects.toThrow("No active Magna passport credential");
    expect(testState.runMagnaConsumerLogin).not.toHaveBeenCalled();
  });

});
