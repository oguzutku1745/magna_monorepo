import { describe, expect, it } from "vitest";
import { getAppEnv } from "./env";

describe("getAppEnv", () => {
  it("applies defaults when optional values are omitted", () => {
    const env = getAppEnv({});

    expect(env.aztecNodeUrl).toBe("http://localhost:8080");
    expect(env.appId).toBe("magna-web");
    expect(env.verificationApiUrl).toBe("http://localhost:4310");
    expect(env.zkPassportRequestName).toBe("Magna");
    expect(env.zkPassportRequestScope).toBe("magna-passport-onboarding");
    expect(env.zkPassportDevMode).toBe(false);
    expect(env.zkPassportIssuanceKind).toBe("legacy");
    expect(env.zkPassportPrimaryIssuanceMode).toBe("rooted");
    expect(env.zkPassportGhostDerivationVersion).toBe("v2_scoped");
    expect(env.companySponsors).toEqual([]);
    expect(env.sponsorProfileName).toBe("default-sponsor-profile");
    expect(env.walletDiscoveryTimeoutMs).toBe(60_000);
    expect(env.walletExtensionAllowList).toEqual([]);
    expect(env.walletExtensionBlockList).toEqual([]);
    expect(env.requireRealSends).toBe(true);
    expect(env.enableManagedWallets).toBe(true);
    expect(env.enableDevOrchestrator).toBe(true);
    expect(env.enableLocalTestBootstrap).toBe(true);
    expect(env.localTestAccountIndex).toBe(0);
  });

  it("parses strings and booleans from Vite-style env input", () => {
    const env = getAppEnv({
      VITE_AZTEC_NODE_URL: "https://sandbox.example",
      VITE_MAGNA_APP_ID: "magna-stage",
      VITE_MAGNA_VERIFICATION_API_URL: "http://localhost:4310",
      VITE_MAGNA_ZKPASSPORT_REQUEST_NAME: "Magna Stage",
      VITE_MAGNA_ZKPASSPORT_REQUEST_LOGO: "https://example.com/logo.png",
      VITE_MAGNA_ZKPASSPORT_REQUEST_PURPOSE: "Prove passport claims for Magna stage",
      VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE: "magna-stage-passport",
      VITE_MAGNA_ZKPASSPORT_DEV_MODE: "true",
      VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "pilot",
      VITE_MAGNA_ZKPASSPORT_PRIMARY_ISSUANCE_MODE: "passport",
      VITE_MAGNA_ZKPASSPORT_GHOST_DERIVATION_VERSION: "v1_legacy_unscoped",
      VITE_MAGNA_ISSUER_ADDRESS: "0x123",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xaaa,0xbbb",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xbbb",
      VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS: "0xabc",
      VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS: "0xdef",
      VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS: "0x456",
      VITE_MAGNA_SPONSOR_PROFILE_NAME: "travel-gate",
      VITE_MAGNA_WALLET_DISCOVERY_TIMEOUT_MS: "90000",
      VITE_MAGNA_WALLET_EXTENSION_ALLOW_LIST: "wallet-a,wallet-b",
      VITE_MAGNA_WALLET_EXTENSION_BLOCK_LIST: "wallet-z",
      VITE_MAGNA_REQUIRE_REAL_SENDS: "true",
      VITE_MAGNA_ENABLE_MANAGED_WALLETS: "false",
      VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR: "0",
      VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP: "yes",
      VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX: "2",
    });

    expect(env.aztecNodeUrl).toBe("https://sandbox.example");
    expect(env.appId).toBe("magna-stage");
    expect(env.verificationApiUrl).toBe("http://localhost:4310");
    expect(env.zkPassportRequestName).toBe("Magna Stage");
    expect(env.zkPassportRequestLogo).toBe("https://example.com/logo.png");
    expect(env.zkPassportRequestPurpose).toBe("Prove passport claims for Magna stage");
    expect(env.zkPassportRequestScope).toBe("magna-stage-passport");
    expect(env.zkPassportDevMode).toBe(true);
    expect(env.zkPassportIssuanceKind).toBe("pilot");
    expect(env.zkPassportPrimaryIssuanceMode).toBe("passport");
    expect(env.zkPassportGhostDerivationVersion).toBe("v1_legacy_unscoped");
    expect(env.issuerAddress).toBe("0x123");
    expect(env.companySponsorAddresses).toEqual(["0xaaa", "0xbbb"]);
    expect(env.companySponsors).toEqual([
      { address: "0xaaa", isActiveDefault: false },
      { address: "0xbbb", isActiveDefault: true },
    ]);
    expect(env.activeCompanySponsorAddress).toBe("0xbbb");
    expect(env.companySponsorAddress).toBe("0xbbb");
    expect(env.rightsRegistryAddress).toBe("0xabc");
    expect(env.rightsPurchaseL2Address).toBe("0xdef");
    expect(env.l2PaymentTokenAddress).toBe("0x456");
    expect(env.sponsorProfileName).toBe("travel-gate");
    expect(env.walletDiscoveryTimeoutMs).toBe(90_000);
    expect(env.walletExtensionAllowList).toEqual(["wallet-a", "wallet-b"]);
    expect(env.walletExtensionBlockList).toEqual(["wallet-z"]);
    expect(env.requireRealSends).toBe(true);
    expect(env.enableManagedWallets).toBe(false);
    expect(env.enableDevOrchestrator).toBe(false);
    expect(env.enableLocalTestBootstrap).toBe(true);
    expect(env.localTestAccountIndex).toBe(2);
  });

  it("adds active sponsor into catalog when only active is configured", () => {
    const env = getAppEnv({
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xactive",
    });

    expect(env.companySponsorAddresses).toEqual(["0xactive"]);
    expect(env.companySponsors).toEqual([{ address: "0xactive", isActiveDefault: true }]);
    expect(env.companySponsorAddress).toBe("0xactive");
  });

  it("accepts explicit a1 issuance config so the app can fail clearly at runtime", () => {
    expect(getAppEnv({ VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND: "a1" }).zkPassportIssuanceKind).toBe("a1");
  });
});
