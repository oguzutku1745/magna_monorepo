import { describe, expect, it } from "vitest";
import { getAppEnv } from "./env";

describe("getAppEnv", () => {
  it("applies defaults when optional values are omitted", () => {
    const env = getAppEnv({});

    expect(env.aztecNodeUrl).toBe("http://localhost:8080");
    expect(env.appId).toBe("magna-web");
    expect(env.enableManagedWallets).toBe(true);
    expect(env.enableDevOrchestrator).toBe(true);
    expect(env.enableLocalTestBootstrap).toBe(true);
    expect(env.localTestAccountIndex).toBe(0);
  });

  it("parses strings and booleans from Vite-style env input", () => {
    const env = getAppEnv({
      VITE_AZTEC_NODE_URL: "https://sandbox.example",
      VITE_MAGNA_APP_ID: "magna-stage",
      VITE_MAGNA_ISSUER_ADDRESS: "0x123",
      VITE_MAGNA_ENABLE_MANAGED_WALLETS: "false",
      VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR: "0",
      VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP: "yes",
      VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX: "2",
    });

    expect(env.aztecNodeUrl).toBe("https://sandbox.example");
    expect(env.appId).toBe("magna-stage");
    expect(env.issuerAddress).toBe("0x123");
    expect(env.enableManagedWallets).toBe(false);
    expect(env.enableDevOrchestrator).toBe(false);
    expect(env.enableLocalTestBootstrap).toBe(true);
    expect(env.localTestAccountIndex).toBe(2);
  });
});
