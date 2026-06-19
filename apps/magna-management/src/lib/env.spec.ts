import { describe, expect, it } from "vitest";
import localDeployment from "../../../../deployments/local.json";
import { getManagementEnv } from "./env";

describe("getManagementEnv", () => {
  it("enables zkPassport dev mode by default in local Vite dev", () => {
    const env = getManagementEnv({ DEV: true });

    expect(env.zkPassportDevMode).toBe(true);
  });

  it("keeps zkPassport dev mode disabled by default outside local dev", () => {
    const env = getManagementEnv({});

    expect(env.zkPassportDevMode).toBe(false);
  });

  it("allows explicit zkPassport dev mode configuration to override the local-dev default", () => {
    expect(getManagementEnv({ DEV: true, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "false" }).zkPassportDevMode).toBe(false);
    expect(getManagementEnv({ DEV: false, VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true" }).zkPassportDevMode).toBe(true);
  });

  it("hydrates local contract addresses from the deployment manifest when env omits them", () => {
    const env = getManagementEnv({});

    expect(env.issuerAddress).toBe(localDeployment.l2.issuerAddress);
    expect(env.orchestratorAddress).toBe(localDeployment.l2.webBootstrap.orchestratorAddress);
    expect(env.activeCompanySponsorAddress).toBe(localDeployment.l2.activeCompanySponsorAddress);
    expect(env.rightsRegistryAddress).toBe(localDeployment.l2.rightsRegistryAddress);
  });
});
