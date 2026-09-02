import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computePassportA2RequestContextHash,
  PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH,
  PASSPORT_A2_OPRF_PUBLIC_KEY_HASH,
  type PassportA2Action,
  type PassportA2RegistryContext,
  type PassportWrapperPublicOutputs,
} from "@magna/passport-wrapper-proof";
import {
  formatBoundData,
  getBindParameterCommitment,
  getServiceScopeHash,
  getServiceSubscopeHash,
} from "@zkpassport/utils";
import {
  applyHydratedEnvEntries,
  buildStaleIssuerDeploymentMessage,
  deploymentManifestEnvEntries,
  dispatchVerifyAndIssuePassportRequest,
  isPassportA2Request,
  loadVerificationApiConfigFromEnv,
  normalizeInstagramDkimPubkeyHash,
  parseInstagramDkimPubkeyHashes,
  PASSPORT_A2_SCHEMA,
  resolveGhostDerivationVersion,
  resolveVerificationMode,
  selectVerifyAndIssuePassportHandler,
  validatePassportA2Request,
  verifyAndIssuePassportA2,
  verifyAndIssueInstagram,
  verifyAndRefreshRootAuthorityA2,
  type VerificationApiConfig,
} from "./service.js";
import { clearSessionCodesForTest, createSessionCode, exchangeSessionCode } from "./session-code-store.js";

const ACTIVE = "0x1111111111111111111111111111111111111111111111111111111111111111";
const GHOST = "0x2222222222222222222222222222222222222222222222222222222222222222";
const TARGET = "0x0303030303030303030303030303030303030303030303030303030303030303";
const ISSUER = "0x0404040404040404040404040404040404040404040404040404040404040404";
const NOW_SECONDS = 1_767_225_600n;
const VALID_UNTIL = NOW_SECONDS + 30n * 24n * 60n * 60n;
const REGISTRY_CONTEXT = {
  certificateRegistryRoot: "11",
  circuitRegistryRoot: "22",
  nullifierType: 1 as const,
  oprfPublicKeyHash: PASSPORT_A2_OPRF_PUBLIC_KEY_HASH,
};
const TRUSTED_INSTAGRAM_DKIM_HASH =
  "0x2f98bb0fd5d8e691af9dd90027c769678ac017a689173593d6edc98faa01c952";

const config: VerificationApiConfig = {
  port: 4310,
  allowedOrigin: "*",
  zkPassportDomain: "localhost",
  zkPassportScope: "magna-passport-onboarding",
  zkPassportDevMode: false,
  zkPassportValiditySeconds: 3600,
  aztecNodeUrl: "http://localhost:8080",
  issuerAddress: ISSUER,
  localTestAccountIndex: 0,
  instagramDkimPubkeyHashes: [TRUSTED_INSTAGRAM_DKIM_HASH],
};

async function publicOutputs(input: {
  action: PassportA2Action;
  owner: string;
  ghostOwner?: string;
  mode?: "rooted" | "passport";
  rootCommitment?: string;
}, targetConfig: VerificationApiConfig = config, registryContext: PassportA2RegistryContext = REGISTRY_CONTEXT): Promise<PassportWrapperPublicOutputs> {
  const ghostOwner = input.ghostOwner ?? GHOST;
  const mode = input.mode ?? "rooted";
  const rootCommitment = input.rootCommitment ?? "456";
  const bindCommitment = await getBindParameterCommitment(
    formatBoundData({
      custom_data: `magna-passport-a2:${input.action}:${targetConfig.zkPassportScope}:${input.owner.toLowerCase()}`,
    }),
  );
  const requestContextHash = computePassportA2RequestContextHash({
    action: input.action,
    issuer: targetConfig.issuerAddress,
    owner: input.owner,
    ghostOwner,
    credentialMode: mode,
    rootCommitment,
    credentialValidUntil: VALID_UNTIL,
    serviceScope: getServiceScopeHash(targetConfig.zkPassportDomain),
    serviceSubscope: getServiceSubscopeHash(targetConfig.zkPassportScope),
    bindCommitment,
    ...registryContext,
  });
  return {
    claimsHash: "123",
    nationalityCommitment: "789",
    expiryCommitment: "101112",
    minAgeProven: 18,
    credentialValidUntil: VALID_UNTIL.toString(),
    rootCommitment,
    requestContextHash: requestContextHash.toString(),
    proofCurrentDate: NOW_SECONDS.toString(),
  };
}

function toPublicInputs(outputs: PassportWrapperPublicOutputs): string[] {
  return [
    outputs.claimsHash,
    outputs.nationalityCommitment,
    outputs.expiryCommitment,
    String(outputs.minAgeProven),
    outputs.credentialValidUntil,
    outputs.rootCommitment,
    outputs.requestContextHash,
    outputs.proofCurrentDate,
  ];
}

async function issuePayload(
  targetConfig: VerificationApiConfig = config,
  registryContext: PassportA2RegistryContext = REGISTRY_CONTEXT,
) {
  const outputs = await publicOutputs({ action: "issue", owner: ACTIVE }, targetConfig, registryContext);
  const wrapperPublicInputs = toPublicInputs(outputs);
  return {
    schema: PASSPORT_A2_SCHEMA,
    activeOwner: ACTIVE,
    ghostOwner: GHOST,
    credentialValidUntil: outputs.credentialValidUntil,
    wrapperProof: { proof: "recursive-proof", publicInputs: wrapperPublicInputs },
    wrapperPublicInputs,
    registryContext: { ...registryContext },
    mode: "rooted" as const,
    ghostDerivationVersion: "v2_scoped" as const,
  };
}

function contextMock() {
  const issueSend = vi.fn(async () => ({ receipt: { txHash: "0xissue" } }));
  const authorizeSend = vi.fn(async () => ({ receipt: { txHash: "0xauthorize" } }));
  const registerRooted = vi.fn(() => ({ send: issueSend }));
  const registerPassport = vi.fn(() => ({ send: issueSend }));
  const authorizeRenewal = vi.fn(() => ({ send: authorizeSend }));
  const registerInstagram = vi.fn(() => ({ send: issueSend }));
  return {
    context: {
      orchestratorAddress: { toString: () => "0xorchestrator" },
      issuer: {
        methods: {
          register_rooted_passport_v2: registerRooted,
          register_credential_v2: registerPassport,
          authorize_root_authority_refresh: authorizeRenewal,
          register_credential: registerInstagram,
        },
      },
    },
    registerRooted,
    registerPassport,
    authorizeRenewal,
    registerInstagram,
  };
}

const verifierDependencies = {
  verifyWrapperProof: vi.fn(async () => true),
  nowMs: () => Number(NOW_SECONDS * 1000n),
  networkTimestamp: vi.fn(async () => NOW_SECONDS),
  registryClient: {
    isCertificateRootValid: vi.fn(async () => true),
    isCircuitRootValid: vi.fn(async () => true),
  },
};

describe("Passport A2 request boundary", () => {
  it("accepts and dispatches only passport-a2-v1", async () => {
    const payload = await issuePayload();
    expect(isPassportA2Request(payload)).toBe(true);
    expect(validatePassportA2Request(payload)).toBe(payload);
    expect(selectVerifyAndIssuePassportHandler(payload)).toBe("passport-a2");
    expect(() => selectVerifyAndIssuePassportHandler({ schema: "passport-a1-v1" })).toThrow(
      "must use schema passport-a2-v1",
    );
  });

  it("strictly rejects inner proofs, notes, raw claims, and unknown fields", async () => {
    const payload = await issuePayload();
    for (const injected of [
      { zkPassportOuterProof: {} },
      { queryResult: {} },
      { nationalityAlpha3: "TUR" },
      { hintedRootAuthorityNote: { note: { revocation_secret: "1" } } },
      { unexpected: true },
    ]) {
      expect(() => validatePassportA2Request({ ...payload, ...injected } as never)).toThrow();
    }
  });
});

describe("verifyAndIssuePassportA2", () => {
  it("verifies the recursive proof and registers proof-bound rooted values", async () => {
    const payload = await issuePayload();
    const { context, registerRooted, registerPassport } = contextMock();
    const result = await verifyAndIssuePassportA2(config, payload, async () => context as never, verifierDependencies);
    expect(registerRooted).toHaveBeenCalledOnce();
    expect(registerPassport).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      issuanceTxHash: "0xissue",
      claimsHash: "123",
      rootCommitment: "456",
      verificationSummary: { verified: true, passportA2: true, piiBlind: true },
    });
    expect("normalizedClaims" in result).toBe(false);
  });

  it("rejects owner/action context substitution before loading the contract", async () => {
    const payload = await issuePayload();
    const contextLoader = vi.fn();
    await expect(
      verifyAndIssuePassportA2(
        config,
        { ...payload, activeOwner: TARGET },
        contextLoader,
        verifierDependencies,
      ),
    ).rejects.toThrow("request context");
    expect(contextLoader).not.toHaveBeenCalled();
  });

  it("fails closed when public inputs are request-only rather than proof-bound", async () => {
    const payload = await issuePayload();
    await expect(
      verifyAndIssuePassportA2(
        config,
        { ...payload, wrapperProof: { proof: "unbound" } },
        vi.fn(),
        verifierDependencies,
      ),
    ).rejects.toThrow("proof-bound or verifier-attested");
  });

  it("rejects stale proof dates", async () => {
    const payload = await issuePayload();
    payload.wrapperPublicInputs[7] = (NOW_SECONDS - 7200n).toString();
    payload.wrapperProof = { proof: "recursive-proof", publicInputs: payload.wrapperPublicInputs };
    await expect(
      verifyAndIssuePassportA2(config, payload, vi.fn(), verifierDependencies),
    ).rejects.toThrow("stale");
  });

  it("rejects untrusted registry roots and the developer nullifier in production", async () => {
    const payload = await issuePayload();
    await expect(
      verifyAndIssuePassportA2(config, payload, vi.fn(), {
        ...verifierDependencies,
        registryClient: {
          isCertificateRootValid: vi.fn(async () => false),
          isCircuitRootValid: vi.fn(async () => true),
        },
      }),
    ).rejects.toThrow("certificate registry root is not trusted");

    const mockNullifierPayload = {
      ...payload,
      registryContext: { ...payload.registryContext, nullifierType: 3 as const },
    };
    await expect(
      verifyAndIssuePassportA2(config, mockNullifierPayload, vi.fn(), verifierDependencies),
    ).rejects.toThrow("production salted");
  });

  it("accepts only the official non-salted-mock nullifier without OPRF in the developer profile", async () => {
    const developerConfig = { ...config, zkPassportDevMode: true };
    const developerRegistryContext = {
      ...REGISTRY_CONTEXT,
      nullifierType: 2 as const,
      oprfPublicKeyHash: PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH,
    };
    const payload = await issuePayload(developerConfig, developerRegistryContext);
    const { context, registerRooted } = contextMock();
    await expect(
      verifyAndIssuePassportA2(
        developerConfig,
        payload,
        async () => context as never,
        verifierDependencies,
      ),
    ).resolves.toMatchObject({ verificationSummary: { verified: true, passportA2: true } });
    expect(registerRooted).toHaveBeenCalledOnce();

    await expect(
      verifyAndIssuePassportA2(
        developerConfig,
        { ...payload, registryContext: { ...payload.registryContext, nullifierType: 1 as const } },
        vi.fn(),
        verifierDependencies,
      ),
    ).rejects.toThrow("official non-salted-mock");

    await expect(
      verifyAndIssuePassportA2(
        developerConfig,
        {
          ...payload,
          registryContext: {
            ...payload.registryContext,
            oprfPublicKeyHash: PASSPORT_A2_OPRF_PUBLIC_KEY_HASH,
          },
        },
        vi.fn(),
        verifierDependencies,
      ),
    ).rejects.toThrow("zero OPRF public-key hash");
  });

  it("rejects substitution of otherwise trusted registry context", async () => {
    const payload = await issuePayload();
    await expect(
      verifyAndIssuePassportA2(
        config,
        {
          ...payload,
          registryContext: { ...payload.registryContext, certificateRegistryRoot: "12" },
        },
        vi.fn(),
        verifierDependencies,
      ),
    ).rejects.toThrow("request context");
  });

  it("routes the active endpoint to A2", async () => {
    const payload = await issuePayload();
    const { context } = contextMock();
    await expect(
      dispatchVerifyAndIssuePassportRequest(config, payload, async () => context as never),
    ).rejects.toThrow(/verification|proof/i);
  });
});

describe("verifyAndIssueInstagram", () => {
  const expiryTs = NOW_SECONDS + 365n * 24n * 60n * 60n;
  const proof = {
    proof: [1, 2, 3],
    publicInputs: [
      TRUSTED_INSTAGRAM_DKIM_HASH,
      "0x1234",
      "987654",
      expiryTs.toString(),
      BigInt(ACTIVE).toString(),
      BigInt(ISSUER).toString(),
      "31337",
    ],
  };
  const payload = { schema: "instagram-v2" as const, proof, activeOwner: ACTIVE };
  const dependencies = {
    verifyProof: vi.fn(async () => true),
    deriveGhostOwner: vi.fn(async () => GHOST),
    networkChainId: vi.fn(async () => 31_337n),
    nowMs: () => Number(NOW_SECONDS * 1000n),
  };

  it("issues from proof-bound public inputs without receiving the email or handle", async () => {
    const { context, registerInstagram } = contextMock();
    const result = await verifyAndIssueInstagram(
      config,
      payload,
      async () => context as never,
      dependencies,
    );

    expect(registerInstagram).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      issuanceTxHash: "0xissue",
      ghostOwner: GHOST,
      verificationSummary: {
        verified: true,
        piiBlind: true,
        dkimPubkeyHash: TRUSTED_INSTAGRAM_DKIM_HASH,
      },
      claimsHash: "987654",
      expiryTs: expiryTs.toString(),
    });
  });

  it("rejects missing and untrusted DKIM governance before touching the issuer", async () => {
    const contextLoader = vi.fn();
    await expect(
      verifyAndIssueInstagram({ ...config, instagramDkimPubkeyHashes: [] }, payload, contextLoader, dependencies),
    ).rejects.toThrow("issuance is disabled");
    await expect(
      verifyAndIssueInstagram(
        { ...config, instagramDkimPubkeyHashes: [normalizeInstagramDkimPubkeyHash("1")] },
        payload,
        contextLoader,
        dependencies,
      ),
    ).rejects.toThrow("untrusted DKIM public key");
    expect(contextLoader).not.toHaveBeenCalled();
  });

  it("rejects legacy plaintext email and handle fields", async () => {
    await expect(
      verifyAndIssueInstagram(
        config,
        { ...payload, emlBase64: "forbidden", claimedHandle: "akinspur" } as never,
        vi.fn(),
        dependencies,
      ),
    ).rejects.toThrow("Unexpected Instagram V2 request field");
  });

  it.each([
    ["active owner", 4, BigInt(GHOST).toString(), "different active owner"],
    ["issuer", 5, BigInt(GHOST).toString(), "different issuer deployment"],
    ["chain", 6, "11155111", "different L1 chain id"],
    ["expired timestamp", 3, (NOW_SECONDS - 1n).toString(), "expiry is not in the future"],
  ])("rejects a proof bound to a substituted %s", async (_label, index, value, expected) => {
    const mutatedProof = { ...proof, publicInputs: [...proof.publicInputs] };
    mutatedProof.publicInputs[index] = value;
    await expect(
      verifyAndIssueInstagram(
        config,
        { ...payload, proof: mutatedProof },
        vi.fn(),
        dependencies,
      ),
    ).rejects.toThrow(expected);
  });

  it("rejects a cryptographically invalid proof before loading the issuer", async () => {
    const contextLoader = vi.fn();
    await expect(
      verifyAndIssueInstagram(config, payload, contextLoader, {
        ...dependencies,
        verifyProof: vi.fn(async () => false),
      }),
    ).rejects.toThrow("proof verification failed");
    expect(contextLoader).not.toHaveBeenCalled();
  });

  it("normalizes comma-separated decimal and hexadecimal governed keys", () => {
    expect(parseInstagramDkimPubkeyHashes(`1, 0x01 ${TRUSTED_INSTAGRAM_DKIM_HASH}`)).toEqual([
      normalizeInstagramDkimPubkeyHash("1"),
      TRUSTED_INSTAGRAM_DKIM_HASH,
    ]);
    expect(() => parseInstagramDkimPubkeyHashes("not-a-field")).toThrow("hexadecimal or decimal");
  });
});

describe("A2 renewal and recovery", () => {
  it("creates a public renewal authorization without receiving private notes", async () => {
    const outputs = await publicOutputs({ action: "renew", owner: ACTIVE });
    const wrapperPublicInputs = toPublicInputs(outputs);
    const payload = {
      schema: PASSPORT_A2_SCHEMA,
      activeOwner: ACTIVE,
      ghostOwner: GHOST,
      credentialValidUntil: outputs.credentialValidUntil,
      wrapperProof: { proof: "recursive-proof", publicInputs: wrapperPublicInputs },
      wrapperPublicInputs,
      registryContext: { ...REGISTRY_CONTEXT },
    };
    const { context, authorizeRenewal } = contextMock();
    const result = await verifyAndRefreshRootAuthorityA2(
      config,
      payload,
      async () => context as never,
      verifierDependencies,
    );
    expect(authorizeRenewal).toHaveBeenCalledOnce();
    expect(result.renewalAuthorizationTxHash).toBe("0xauthorize");
    expect(JSON.stringify(payload)).not.toContain("hintedRoot");
    expect(JSON.stringify(payload)).not.toContain("revocation_secret");
  });

  it("rejects renewal requests carrying local notes or revocation secrets", async () => {
    const outputs = await publicOutputs({ action: "renew", owner: ACTIVE });
    const wrapperPublicInputs = toPublicInputs(outputs);
    const basePayload = {
      schema: PASSPORT_A2_SCHEMA,
      activeOwner: ACTIVE,
      ghostOwner: GHOST,
      credentialValidUntil: outputs.credentialValidUntil,
      wrapperProof: { proof: "recursive-proof", publicInputs: wrapperPublicInputs },
      wrapperPublicInputs,
      registryContext: { ...REGISTRY_CONTEXT },
    };
    for (const injected of [
      { hintedRootStatusNote: { note: "private" } },
      { hintedRootAuthorityNote: { note: { revocation_secret: "1" } } },
      { revocation_secret: "1" },
    ]) {
      await expect(
        verifyAndRefreshRootAuthorityA2(
          config,
          { ...basePayload, ...injected } as never,
          vi.fn(),
          verifierDependencies,
        ),
      ).rejects.toThrow();
    }
  });

});

describe("unchanged API utilities", () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it("hydrates deployment values and reports stale issuer recovery", () => {
    expect(deploymentManifestEnvEntries({
      l2: { issuerAddress: ISSUER, webBootstrap: { orchestratorAddress: ACTIVE } },
      endpoints: { aztecNodeUrl: "http://localhost:8080" },
    })).toMatchObject({ MAGNA_ISSUER_ADDRESS: ISSUER, MAGNA_AZTEC_NODE_URL: "http://localhost:8080" });
    const target: Record<string, string> = {};
    applyHydratedEnvEntries({ A: "new" }, target);
    expect(target.A).toBe("new");
    expect(buildStaleIssuerDeploymentMessage("0xdead")).toContain("npm run bootstrap:local");
  });

  it("retains rooted mode and scoped ghost defaults", () => {
    expect(resolveVerificationMode(undefined)).toBe("rooted");
    expect(resolveGhostDerivationVersion(undefined, "rooted")).toBe("v2_scoped");
  });

  it("loads local env defaults", () => {
    process.env = { ...originalEnv, MAGNA_ISSUER_ADDRESS: ISSUER };
    expect(loadVerificationApiConfigFromEnv().zkPassportScope).toBe("magna-passport-onboarding");
  });
});

describe("session code store", () => {
  afterEach(() => clearSessionCodesForTest());
  it("round-trips an assertion exactly once", () => {
    const assertion = { id: "assertion" };
    const code = createSessionCode(assertion);
    expect(exchangeSessionCode(code)).toEqual(assertion);
    expect(exchangeSessionCode(code)).toBeNull();
  });
});
