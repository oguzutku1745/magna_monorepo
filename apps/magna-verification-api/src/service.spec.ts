import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyHydratedEnvEntries,
  verifyRootRecoveryPreflight,
  resolveGhostDerivationVersion,
  resolveRootRecoveryGhostDerivationVersion,
  resolveVerificationMode,
  loadVerificationApiConfigFromEnv,
  normalizePassportClaimsFromQueryResult,
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
        ageThreshold: 21,
      },
      {
        verifyPassportClaims: async () => ({
          verification: { verified: true, uniqueIdentifier: "uid-123" },
          normalized,
        }),
        deriveGhostOwner: async () => "0xghost",
      },
    );

    expect(result.matchesExpectedGhostOwner).toBe(true);
    expect(result.ghostDerivationVersion).toBe("v2_scoped");
    expect(result.derivedGhostOwner).toBe("0xghost");
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
          ghostDerivationVersion: "v2_scoped",
          ageThreshold: 21,
        },
        {
          verifyPassportClaims: async () => ({
            verification: { verified: true, uniqueIdentifier: "uid-123" },
            normalized,
          }),
          deriveGhostOwner: async () => "0xderived",
        },
      ),
    ).rejects.toThrow("proof does not match the configured ghost owner");
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
