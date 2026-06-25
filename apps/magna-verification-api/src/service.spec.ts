import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyHydratedEnvEntries,
  buildStaleIssuerDeploymentMessage,
  deploymentManifestEnvEntries,
  isPassportPilotRequest,
  verifyRootRecoveryPreflight,
  resolveGhostDerivationVersion,
  resolveRootRecoveryGhostDerivationVersion,
  resolveVerificationMode,
  loadVerificationApiConfigFromEnv,
  normalizePassportClaimsFromQueryResult,
  PASSPORT_PII_BLIND_PILOT_SCHEMA,
  validatePassportPilotRequest,
  verifyAndIssueInstagram,
} from "./service.js";
import { clearSessionCodesForTest, createSessionCode, exchangeSessionCode } from "./session-code-store.js";

describe("normalizePassportClaimsFromQueryResult", () => {
  it("maps disclosed zkPassport result into Magna passport claims", () => {
    const normalized = normalizePassportClaimsFromQueryResult(
      {
        age: {
          gte: {
            result: true,
            expected: 21,
          },
        },
        nationality: {
          disclose: {
            result: "tur",
          },
        },
        expiry_date: {
          disclose: {
            result: "2031-07-20",
          },
        },
      },
      undefined,
    );

    expect(normalized.nationalityAlpha3).toBe("TUR");
    expect(normalized.claims.minAgeProven).toBe(21);
    expect(normalized.claims.schemaVersion).toBe(1);
    expect(normalized.claims.expiryTs).toBeGreaterThan(0n);
  });

  it("accepts Date instances for disclosed expiry dates", () => {
    const normalized = normalizePassportClaimsFromQueryResult({
      age: {
        gte: {
          result: true,
          expected: 21,
        },
      },
      nationality: {
        disclose: {
          result: "DEU",
        },
      },
      expiry_date: {
        disclose: {
          result: new Date("2031-07-20T00:00:00.000Z"),
        },
      },
    });

    expect(normalized.passportExpiryDate).toBe("2031-07-20");
  });

  it("accepts serialized date objects for disclosed expiry dates", () => {
    const normalized = normalizePassportClaimsFromQueryResult({
      age: {
        gte: {
          result: true,
          expected: 21,
        },
      },
      nationality: {
        disclose: {
          result: "DEU",
        },
      },
      expiry_date: {
        disclose: {
          result: {
            year: 2031,
            month: 7,
            day: 20,
          },
        },
      },
    });

    expect(normalized.passportExpiryDate).toBe("2031-07-20");
  });

  it("throws when age proof is not satisfied", () => {
    expect(() =>
      normalizePassportClaimsFromQueryResult({
        age: {
          gte: {
            result: false,
            expected: 18,
          },
        },
      }),
    ).toThrow("age.gte");
  });
});

describe("loadVerificationApiConfigFromEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("falls back to VITE_* bootstrap values and localhost domain for local dev", () => {
    process.env = {
      ...originalEnv,
      MAGNA_ZKPASSPORT_DOMAIN: "",
      MAGNA_ZKPASSPORT_DEV_MODE: "",
      MAGNA_ISSUER_ADDRESS: "",
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      MAGNA_AZTEC_NODE_URL: "",
      VITE_AZTEC_NODE_URL: "http://localhost:8080",
      MAGNA_ORCHESTRATOR_ADDRESS: "",
      VITE_MAGNA_ORCHESTRATOR_ADDRESS: "0xorchestrator",
    };

    const config = loadVerificationApiConfigFromEnv();
    expect(config.zkPassportDomain).toBe("localhost");
    expect(config.zkPassportScope).toBe("magna-passport-onboarding");
    expect(config.zkPassportDevMode).toBe(false);
    expect(config.issuerAddress).toBe("0xissuer");
    expect(config.aztecNodeUrl).toBe("http://localhost:8080");
    expect(config.orchestratorAddress).toBe("0xorchestrator");
  });

  it("accepts zkPassport dev mode from either API or Vite env", () => {
    process.env = {
      ...originalEnv,
      MAGNA_ZKPASSPORT_DOMAIN: "localhost",
      MAGNA_ZKPASSPORT_DEV_MODE: "",
      VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true",
      MAGNA_ISSUER_ADDRESS: "0xissuer",
    };

    const config = loadVerificationApiConfigFromEnv();
    expect(config.zkPassportDevMode).toBe(true);
  });
});

describe("passport PII-blind pilot request validation", () => {
  const cleanPilotPayload = {
    pilotSchema: PASSPORT_PII_BLIND_PILOT_SCHEMA,
    activeOwner: "0x1111111111111111111111111111111111111111111111111111111111111111",
    claimsHash: "123",
    ghostOwner: "0x2222222222222222222222222222222222222222222222222222222222222222",
    rootCommitment: "456",
    credentialValidUntil: "1893456000",
    mode: "rooted" as const,
    ghostDerivationVersion: "v2_scoped" as const,
  };

  it("recognizes the pilot schema without accepting zkPassport private artifacts", () => {
    expect(isPassportPilotRequest(cleanPilotPayload)).toBe(true);
    expect(validatePassportPilotRequest(cleanPilotPayload)).toEqual(cleanPilotPayload);
  });

  it("rejects queryResult, committedInputs, outerProof, raw uniqueIdentifier, and passport expiry", () => {
    for (const key of ["queryResult", "committedInputs", "outerProof", "uniqueIdentifier", "expiryTs"]) {
      expect(() =>
        validatePassportPilotRequest({
          ...cleanPilotPayload,
          [key]: "leak",
        } as never),
      ).toThrow("PII-bearing zkPassport artifact");
    }
  });

  it("requires decimal string field values for claims and validity", () => {
    expect(() =>
      validatePassportPilotRequest({
        ...cleanPilotPayload,
        claimsHash: "not-a-field",
      }),
    ).toThrow("claimsHash must be a decimal string");
    expect(() =>
      validatePassportPilotRequest({
        ...cleanPilotPayload,
        rootCommitment: "not-a-field",
      }),
    ).toThrow("rootCommitment must be a decimal string");
    expect(() =>
      validatePassportPilotRequest({
        ...cleanPilotPayload,
        credentialValidUntil: "0",
      }),
    ).toThrow("credentialValidUntil must be a positive unix timestamp string");
  });

  it("rejects invalid runtime mode and ghost derivation values", () => {
    expect(() =>
      validatePassportPilotRequest({
        ...cleanPilotPayload,
        mode: "email" as never,
      }),
    ).toThrow("mode must be passport or rooted");
    expect(() =>
      validatePassportPilotRequest({
        ...cleanPilotPayload,
        ghostDerivationVersion: "v3_global" as never,
      }),
    ).toThrow("ghostDerivationVersion must be v1_legacy_unscoped or v2_scoped");
  });
});

describe("verifyAndIssuePassportPilot", () => {
  it("registers using v2 contract methods and never returns normalized passport PII", async () => {
    const send = vi.fn(async () => ({ txHash: "0xpilot" }));
    const context = {
      orchestratorAddress: {
        toString: () => "0xorchestrator",
      },
      issuer: {
        methods: {
          register_rooted_passport_v2: vi.fn(() => ({ send })),
        },
      },
    };

    const { verifyAndIssuePassportPilot } = await import("./service.js");
    const result = await verifyAndIssuePassportPilot(
      {
        port: 4310,
        allowedOrigin: "*",
        zkPassportDomain: "localhost",
        zkPassportScope: "magna-passport-onboarding",
        zkPassportDevMode: true,
        aztecNodeUrl: "http://localhost:8080",
        issuerAddress: "0xissuer",
        localTestAccountIndex: 0,
      },
      {
        pilotSchema: PASSPORT_PII_BLIND_PILOT_SCHEMA,
        activeOwner: "0x1111111111111111111111111111111111111111111111111111111111111111",
        claimsHash: "123",
        ghostOwner: "0x2222222222222222222222222222222222222222222222222222222222222222",
        rootCommitment: "456",
        credentialValidUntil: "1893456000",
        mode: "rooted",
        ghostDerivationVersion: "v2_scoped",
      },
      async () => context as never,
    );

    expect(result.claimsHash).toBe("123");
    expect(result.rootCommitment).toBe("456");
    expect(result.verificationSummary).toEqual({
      verified: true,
      pilot: true,
      piiBlind: true,
    });
    expect("normalizedClaims" in result).toBe(false);
    expect(context.issuer.methods.register_rooted_passport_v2).toHaveBeenCalled();
  });
});

describe("applyHydratedEnvEntries", () => {
  it("overrides stale inherited env values with repo file values", () => {
    const target = {
      VITE_MAGNA_ISSUER_ADDRESS: "0xold",
      MAGNA_ISSUER_ADDRESS: "0xalso-old",
    } as NodeJS.ProcessEnv;

    applyHydratedEnvEntries(
      {
        VITE_MAGNA_ISSUER_ADDRESS: "0xnew",
        MAGNA_ISSUER_ADDRESS: "0xnew-api",
      },
      target,
    );

    expect(target.VITE_MAGNA_ISSUER_ADDRESS).toBe("0xnew");
    expect(target.MAGNA_ISSUER_ADDRESS).toBe("0xnew-api");
  });
});

describe("deployment manifest hydration", () => {
  it("maps local deployment manifest addresses into API and Vite env entries", () => {
    expect(
      deploymentManifestEnvEntries({
        l2: {
          issuerAddress: "0xissuer-new",
          companySponsorAddress: "0xsponsor-new",
          companySponsorAddresses: ["0xsponsor-new", "0xsponsor-other"],
          activeCompanySponsorAddress: "0xsponsor-other",
        },
      }),
    ).toEqual({
      MAGNA_ISSUER_ADDRESS: "0xissuer-new",
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer-new",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESS: "0xsponsor-new",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xsponsor-new,0xsponsor-other",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xsponsor-other",
    });
  });

  it("explains stale issuer deployments with the local bootstrap recovery command", () => {
    expect(
      buildStaleIssuerDeploymentMessage(
        "0xissuer-old",
        "Artifact does not match expected class id (computed 0xnew but instance refers to 0xold)",
      ),
    ).toContain("npm run web:bootstrap:local -- --skip-rights-deploy");
  });
});

describe("issuance mode and ghost derivation resolution", () => {
  it("defaults the API flow to rooted mode", () => {
    expect(resolveVerificationMode(undefined)).toBe("rooted");
    expect(resolveVerificationMode("rooted")).toBe("rooted");
    expect(resolveVerificationMode("passport")).toBe("passport");
  });

  it("uses scoped ghost derivation for rooted mode and legacy for passport mode", () => {
    expect(resolveGhostDerivationVersion(undefined, "rooted")).toBe("v2_scoped");
    expect(resolveGhostDerivationVersion(undefined, "passport")).toBe("v1_legacy_unscoped");
  });

  it("honors explicit ghost derivation override", () => {
    expect(resolveGhostDerivationVersion("v1_legacy_unscoped", "rooted")).toBe("v1_legacy_unscoped");
    expect(resolveGhostDerivationVersion("v2_scoped", "passport")).toBe("v2_scoped");
  });

  it("uses scoped ghost derivation by default for rooted recovery preflight", () => {
    expect(resolveRootRecoveryGhostDerivationVersion(undefined)).toBe("v2_scoped");
    expect(resolveRootRecoveryGhostDerivationVersion("v1_legacy_unscoped")).toBe("v1_legacy_unscoped");
  });
});

describe("verifyRootRecoveryPreflight", () => {
  const config = {
    port: 4310,
    allowedOrigin: "*",
    zkPassportDomain: "localhost",
    zkPassportScope: "magna-passport-onboarding",
    zkPassportDevMode: true,
    aztecNodeUrl: "http://localhost:8080",
    issuerAddress: "0xissuer",
    localTestAccountIndex: 0,
  };

  const normalized = normalizePassportClaimsFromQueryResult({
    age: {
      gte: {
        result: true,
        expected: 21,
      },
    },
    nationality: {
      disclose: {
        result: "DEU",
      },
    },
    expiry_date: {
      disclose: {
        result: "2031-07-20",
      },
    },
  });

  it("returns verified preflight when proof-derived ghost owner matches expected owner", async () => {
    const result = await verifyRootRecoveryPreflight(
      config,
      {
        proofs: [{}] as never[],
        originalQuery: {} as never,
        queryResult: {} as never,
        expectedGhostOwner: "0xghost",
        expectedRootCommitment: "12345",
        ageThreshold: 21,
      },
      {
        verifyPassportClaims: async () => ({
          verification: { verified: true, uniqueIdentifier: "uid-123" },
          normalized,
        }),
        deriveGhostOwner: async () => "0xghost",
        deriveRoot: () => 12345n,
      },
    );

    expect(result.matchesExpectedGhostOwner).toBe(true);
    expect(result.matchesExpectedRootCommitment).toBe(true);
    expect(result.ghostDerivationVersion).toBe("v2_scoped");
    expect(result.derivedGhostOwner).toBe("0xghost");
    expect(result.derivedRootCommitment).toBe("12345");
  });

  it("fails preflight when proof-derived ghost owner mismatches expected owner", async () => {
    await expect(
      verifyRootRecoveryPreflight(
        config,
        {
          proofs: [{}] as never[],
          originalQuery: {} as never,
          queryResult: {} as never,
          expectedGhostOwner: "0xexpected",
          expectedRootCommitment: "12345",
          ghostDerivationVersion: "v2_scoped",
          ageThreshold: 21,
        },
        {
          verifyPassportClaims: async () => ({
            verification: { verified: true, uniqueIdentifier: "uid-123" },
            normalized,
          }),
          deriveGhostOwner: async () => "0xderived",
          deriveRoot: () => 12345n,
        },
      ),
    ).rejects.toThrow("proof does not match the configured ghost owner");
  });

  it("fails preflight when proof-derived root commitment mismatches hinted lineage", async () => {
    await expect(
      verifyRootRecoveryPreflight(
        config,
        {
          proofs: [{}] as never[],
          originalQuery: {} as never,
          queryResult: {} as never,
          expectedGhostOwner: "0xghost",
          expectedRootCommitment: "12345",
          ghostDerivationVersion: "v2_scoped",
          ageThreshold: 21,
        },
        {
          verifyPassportClaims: async () => ({
            verification: { verified: true, uniqueIdentifier: "uid-456" },
            normalized,
          }),
          deriveGhostOwner: async () => "0xghost",
          deriveRoot: () => 67890n,
        },
      ),
    ).rejects.toThrow("proof does not match the rooted passport lineage");
  });
});

describe("verifyAndIssueInstagram", () => {
  const config = {
    port: 4310,
    allowedOrigin: "*",
    zkPassportDomain: "localhost",
    zkPassportScope: "magna-passport-onboarding",
    zkPassportDevMode: true,
    aztecNodeUrl: "http://localhost:8080",
    issuerAddress: "0xissuer",
    localTestAccountIndex: 0,
  };

  it("registers an Instagram credential from a verified email proof", async () => {
    const send = vi.fn(async () => ({ receipt: { txHash: "0xtx" } }));
    const registerCredential = vi.fn(() => ({ send }));
    const contextLoader = async () =>
      ({
        issuer: {
          methods: {
            register_credential: registerCredential,
          },
        },
        orchestratorAddress: {
          toString: () => "0x1111111111111111111111111111111111111111111111111111111111111111",
        },
      }) as never;

    const result = await verifyAndIssueInstagram(
      config,
      {
        emlBase64: Buffer.from("raw email").toString("base64"),
        claimedHandle: "akinspur",
        activeOwner: "0x0000000000000000000000000000000000000000000000000000000000000002",
        expiryTs: "1893456000",
      },
      contextLoader,
      {
        proveEmail: async () =>
          ({
            proof: {} as never,
            publicInputs: [],
            outputs: {
              dkimPubkeyHash: "0x01",
              emailNullifier: "0x03",
              handleLen: 8,
              handlePacked: "0x616b696e73707572",
            },
            metadata: {
              normalizedHandle: "akinspur",
              template: "english",
              prefixIndex: 44,
              handleLen: 8,
              handlePacked: 0x616b696e73707572n,
            },
          }) as never,
        deriveGhostOwner: async () =>
          "0x0000000000000000000000000000000000000000000000000000000000000003",
      },
    );

    expect(registerCredential).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      from: expect.objectContaining({
        toString: expect.any(Function),
      }),
    });
    expect(result.issuanceTxHash).toBe("0xtx");
    expect(result.normalizedClaims.instagramHandle).toBe("akinspur");
    expect(result.normalizedClaims.handlePacked).toBe("0x616b696e73707572");
    expect(result.normalizedClaims.expiryTs).toBe("1893456000");
    expect(result.verificationSummary.emailNullifier).toBe("0x03");
  });
});


describe("session code store", () => {
  afterEach(() => {
    clearSessionCodesForTest();
    vi.useRealTimers();
  });

  it("round-trips an assertion exactly once", () => {
    const assertion = { verified: true, requestId: "req-1" };
    const code = createSessionCode(assertion);

    expect(exchangeSessionCode(code)).toBe(assertion);
    expect(exchangeSessionCode(code)).toBeNull();
  });

  it("returns null for expired codes and consumes them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const assertion = { verified: true, requestId: "req-expired" };
    const code = createSessionCode(assertion);

    vi.setSystemTime(62_000);

    expect(exchangeSessionCode(code)).toBeNull();
    expect(exchangeSessionCode(code)).toBeNull();
  });
});
