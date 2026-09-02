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

  it("defaults passport issuance to A2", () => {
    const env = getManagementEnv({});

    expect(env.zkPassportDevMode).toBe(false);
    expect(env.zkPassportIssuanceKind).toBe("a2");
  });

  it("allows explicit zkPassport dev mode configuration to override the local-dev default", () => {
    expect(getManagementEnv({ DEV: true, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "false" }).zkPassportDevMode).toBe(false);
    expect(getManagementEnv({ DEV: false, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true" }).zkPassportDevMode).toBe(true);
  });

  it("accepts only explicit A2 passport issuance configuration", () => {
    expect(getManagementEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "a2" }).zkPassportIssuanceKind).toBe("a2");
    expect(() => getManagementEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "a1" })).toThrow("must be a2");
  });

  it("uses an explicit production profile rather than Vite's optimized-build flag", () => {
    const env = getManagementEnv({ VITE_MAGNA_DEPLOYMENT_PROFILE: "production" });

    expect(env.zkPassportIssuanceKind).toBe("a2");
    expect(env.zkPassportDevMode).toBe(false);
    expect(env.enableDevOrchestrator).toBe(false);
    expect(env.enableLocalTestBootstrap).toBe(false);
  });

  it("rejects non-A2 selection and dev flags in the explicit production profile", () => {
    const production = { VITE_MAGNA_DEPLOYMENT_PROFILE: "production" };
    expect(() => getManagementEnv({ ...production, VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "legacy" })).toThrow("must be a2");
    expect(getManagementEnv({ ...production, VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "a2" }).zkPassportIssuanceKind).toBe("a2");
    expect(() => getManagementEnv({ ...production, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true" })).toThrow(
      "VITE_MAGNA_ZKPASSPORT_DEV_MODE must be disabled in production",
    );
    expect(() =>
      getManagementEnv({
        ...production,
        VITE_MAGNA_LOCAL_FAUCET_PRIVATE_KEY: `0x${"01".repeat(32)}`,
      }),
    ).toThrow("VITE_MAGNA_LOCAL_FAUCET_PRIVATE_KEY must not be configured in production");
  });

  it("allows the local faucet in an optimized development bundle", () => {
    const key = `0x${"01".repeat(32)}`;
    const env = getManagementEnv({
      PROD: true,
      VITE_MAGNA_DEPLOYMENT_PROFILE: "development",
      VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true",
      VITE_MAGNA_LOCAL_FAUCET_PRIVATE_KEY: key,
    });

    expect(env.deploymentProfile).toBe("development");
    expect(env.zkPassportDevMode).toBe(true);
    expect(env.localFaucetPrivateKey).toBe(key);
  });

  it("uses the disposable recovery relayer key as the local faucet default", () => {
    const key = `0x${"01".repeat(32)}`;
    const env = getManagementEnv({ VITE_MAGNA_RECOVERY_V3_RELAYER_PRIVATE_KEY: key });

    expect(env.localFaucetPrivateKey).toBe(key);
  });

  it("rejects unknown passport issuance modes", () => {
    expect(() => getManagementEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "unsafe" })).toThrow(
      "must be a2",
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
