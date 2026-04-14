import { afterEach, describe, expect, it } from "vitest";
import {
  applyHydratedEnvEntries,
  resolveGhostDerivationVersion,
  resolveVerificationMode,
  loadVerificationApiConfigFromEnv,
  normalizePassportClaimsFromQueryResult,
} from "./service.js";

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
});
