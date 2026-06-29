import { describe, expect, it } from "vitest";
import localDeployment from "../../../../deployments/local.json";
import { getManagementEnv } from "./env";

const deployment = localDeployment as {
  l2: {
    issuerAddress?: string;
    webBootstrap?: {
      orchestratorAddress?: string;
    };
    activeCompanySponsorAddress?: string;
    rightsRegistryAddress?: string;
  };
};

describe("getManagementEnv", () => {
  it("keeps zkPassport dev mode disabled by default in local Vite dev", () => {
    const env = getManagementEnv({ DEV: true });

    expect(env.zkPassportDevMode).toBe(false);
  });

  it("defaults passport issuance to A1 outside local dev", () => {
    const env = getManagementEnv({});

    expect(env.zkPassportDevMode).toBe(false);
    expect(env.zkPassportIssuanceKind).toBe("a1");
  });

  it("allows explicit zkPassport dev mode configuration to override the local-dev default", () => {
    expect(getManagementEnv({ DEV: true, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "false" }).zkPassportDevMode).toBe(false);
    expect(getManagementEnv({ DEV: false, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true" }).zkPassportDevMode).toBe(true);
  });

  it("parses explicit passport issuance kind configuration", () => {
    expect(getManagementEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "legacy" }).zkPassportIssuanceKind).toBe(
      "legacy",
    );
    expect(getManagementEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "pilot" }).zkPassportIssuanceKind).toBe("pilot");
    expect(getManagementEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "a1" }).zkPassportIssuanceKind).toBe("a1");
  });

  it("defaults production passport issuance to A1 with dev-only paths disabled", () => {
    const env = getManagementEnv({ PROD: true });

    expect(env.zkPassportIssuanceKind).toBe("a1");
    expect(env.zkPassportDevMode).toBe(false);
    expect(env.enableDevOrchestrator).toBe(false);
    expect(env.enableLocalTestBootstrap).toBe(false);
  });

  it("rejects legacy, pilot, and dev flags in production builds", () => {
    expect(() => getManagementEnv({ PROD: true, VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "legacy" })).toThrow(
      "Production passport issuance supports only A1",
    );
    expect(() => getManagementEnv({ PROD: true, VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "pilot" })).toThrow(
      "Production passport issuance supports only A1",
    );
    expect(getManagementEnv({ PROD: true, VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "a1" }).zkPassportIssuanceKind).toBe(
      "a1",
    );
    expect(() => getManagementEnv({ PROD: true, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true" })).toThrow(
      "VITE_MAGNA_ZKPASSPORT_DEV_MODE must be disabled in production",
    );
  });

  it("rejects unknown passport issuance modes", () => {
    expect(() => getManagementEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "unsafe" })).toThrow(
      "must be one of legacy, pilot, or a1",
    );
  });

  it("hydrates local contract addresses from the deployment manifest when env omits them", () => {
    const env = getManagementEnv({});

    expect(env.issuerAddress).toBe(deployment.l2.issuerAddress);
    expect(env.orchestratorAddress).toBe(deployment.l2.webBootstrap?.orchestratorAddress);
    expect(env.activeCompanySponsorAddress).toBe(deployment.l2.activeCompanySponsorAddress);
    expect(env.rightsRegistryAddress).toBe(deployment.l2.rightsRegistryAddress);
  });
});
