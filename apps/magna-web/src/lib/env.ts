export type MagnaSponsorCatalogEntry = {
  address: string;
  isActiveDefault: boolean;
};

export type MagnaAppEnv = {
  aztecNodeUrl: string;
  l1RpcUrl?: string;
  l1RightsPortalAddress?: string;
  l1PaymentTokenAddress?: string;
  l1BuyerPrivateKey?: string;
  appId: string;
  verificationApiUrl?: string;
  zkPassportRequestName: string;
  zkPassportRequestLogo: string;
  zkPassportRequestPurpose: string;
  zkPassportRequestScope: string;
  zkPassportDevMode: boolean;
  zkPassportIssuanceKind: "legacy" | "pilot" | "a1";
  zkPassportPrimaryIssuanceMode: "rooted" | "passport";
  zkPassportGhostDerivationVersion: "v1_legacy_unscoped" | "v2_scoped";
  issuerAddress?: string;
  companySponsorAddresses: string[];
  companySponsors: MagnaSponsorCatalogEntry[];
  activeCompanySponsorAddress?: string;
  // Backward-compatible alias for older call sites.
  companySponsorAddress?: string;
  rightsRegistryAddress?: string;
  rightsPurchaseL2Address?: string;
  l2PaymentTokenAddress?: string;
  orchestratorAddress?: string;
  sponsorProfileName: string;
  walletDiscoveryTimeoutMs: number;
  walletExtensionAllowList: string[];
  walletExtensionBlockList: string[];
  requireRealSends: boolean;
  enableManagedWallets: boolean;
  enableDevOrchestrator: boolean;
  enableLocalTestBootstrap: boolean;
  localTestAccountIndex: number;
};

type EnvSource = Record<string, string | boolean | number | undefined>;

function parseBoolean(value: string | boolean | number | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return fallback;
  if (value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseNumber(value: string | boolean | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseOptionalString(value: string | boolean | number | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseStringList(value: string | boolean | number | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function parseIssuanceMode(value: string | boolean | number | undefined): "rooted" | "passport" {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "passport") {
      return "passport";
    }
    if (normalized === "rooted") {
      return "rooted";
    }
  }
  return "rooted";
}

function parsePassportIssuanceKind(
  value: string | boolean | number | undefined,
  isProduction: boolean,
): "legacy" | "pilot" | "a1" {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "legacy" || normalized === "pilot" || normalized === "a1") {
      if (isProduction && normalized !== "a1") {
        throw new Error(
          "VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND must be a1 in production builds. legacy and pilot are development/test modes.",
        );
      }
      return normalized;
    }
    if (normalized) {
      throw new Error("VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND must be one of legacy, pilot, or a1.");
    }
  }
  return isProduction ? "a1" : "legacy";
}

function parseGhostDerivationVersion(
  value: string | boolean | number | undefined,
): "v1_legacy_unscoped" | "v2_scoped" {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized === "v1_legacy_unscoped") {
      return "v1_legacy_unscoped";
    }
    if (normalized === "v2_scoped") {
      return "v2_scoped";
    }
  }
  return "v2_scoped";
}

function buildSponsorCatalog(
  addresses: string[],
  activeAddress?: string,
): MagnaSponsorCatalogEntry[] {
  return addresses.map(address => ({
    address,
    isActiveDefault: Boolean(activeAddress && address === activeAddress),
  }));
}

export function getAppEnv(source: EnvSource = import.meta.env): MagnaAppEnv {
  const isProduction = parseBoolean(source.PROD, false);
  const legacyCompanySponsorAddress = parseOptionalString(source.VITE_MAGNA_COMPANY_SPONSOR_ADDRESS);
  const configuredSponsorAddresses = parseStringList(source.VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES);
  const sponsorAddressSet = new Set(configuredSponsorAddresses);
  if (legacyCompanySponsorAddress) {
    sponsorAddressSet.add(legacyCompanySponsorAddress);
  }
  const companySponsorAddresses = Array.from(sponsorAddressSet);
  const activeCompanySponsorAddress =
    parseOptionalString(source.VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS) ??
    legacyCompanySponsorAddress ??
    companySponsorAddresses[0];
  if (activeCompanySponsorAddress && !sponsorAddressSet.has(activeCompanySponsorAddress)) {
    sponsorAddressSet.add(activeCompanySponsorAddress);
  }
  const normalizedSponsorAddresses = Array.from(sponsorAddressSet);
  const companySponsors = buildSponsorCatalog(normalizedSponsorAddresses, activeCompanySponsorAddress);

  return {
    aztecNodeUrl: parseOptionalString(source.VITE_AZTEC_NODE_URL) ?? "http://localhost:8080",
    l1RpcUrl: parseOptionalString(source.VITE_MAGNA_L1_RPC_URL),
    l1RightsPortalAddress: parseOptionalString(source.VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS),
    l1PaymentTokenAddress: parseOptionalString(source.VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS),
    l1BuyerPrivateKey: parseOptionalString(source.VITE_MAGNA_L1_BUYER_PRIVATE_KEY),
    appId: parseOptionalString(source.VITE_MAGNA_APP_ID) ?? "magna-web",
    // Local-first default so zkPassport flow works after bootstrap
    // even when this variable is not explicitly present yet.
    verificationApiUrl: parseOptionalString(source.VITE_MAGNA_VERIFICATION_API_URL) ?? "http://localhost:4310",
    zkPassportRequestName: parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_NAME) ?? "Magna",
    zkPassportRequestLogo:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_LOGO) ?? "https://magna.identity/logo.png",
    zkPassportRequestPurpose:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_PURPOSE) ??
      "Issue a Magna passport credential using zkPassport verification.",
    zkPassportRequestScope:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE) ?? "magna-passport-onboarding",
    zkPassportDevMode: parseBoolean(source.VITE_MAGNA_ZKPASSPORT_DEV_MODE, false),
    zkPassportIssuanceKind: parsePassportIssuanceKind(source.VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND, isProduction),
    zkPassportPrimaryIssuanceMode: parseIssuanceMode(source.VITE_MAGNA_ZKPASSPORT_PRIMARY_ISSUANCE_MODE),
    zkPassportGhostDerivationVersion: parseGhostDerivationVersion(
      source.VITE_MAGNA_ZKPASSPORT_GHOST_DERIVATION_VERSION,
    ),
    issuerAddress: parseOptionalString(source.VITE_MAGNA_ISSUER_ADDRESS),
    companySponsorAddresses: normalizedSponsorAddresses,
    companySponsors,
    activeCompanySponsorAddress,
    companySponsorAddress: activeCompanySponsorAddress,
    rightsRegistryAddress: parseOptionalString(source.VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS),
    rightsPurchaseL2Address: parseOptionalString(source.VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS),
    l2PaymentTokenAddress: parseOptionalString(source.VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS),
    orchestratorAddress: parseOptionalString(source.VITE_MAGNA_ORCHESTRATOR_ADDRESS),
    sponsorProfileName: parseOptionalString(source.VITE_MAGNA_SPONSOR_PROFILE_NAME) ?? "default-sponsor-profile",
    walletDiscoveryTimeoutMs: parseNumber(source.VITE_MAGNA_WALLET_DISCOVERY_TIMEOUT_MS, 60_000),
    walletExtensionAllowList: parseStringList(source.VITE_MAGNA_WALLET_EXTENSION_ALLOW_LIST),
    walletExtensionBlockList: parseStringList(source.VITE_MAGNA_WALLET_EXTENSION_BLOCK_LIST),
    requireRealSends: parseBoolean(source.VITE_MAGNA_REQUIRE_REAL_SENDS, true),
    enableManagedWallets: parseBoolean(source.VITE_MAGNA_ENABLE_MANAGED_WALLETS, true),
    enableDevOrchestrator: parseBoolean(source.VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR, true),
    enableLocalTestBootstrap: parseBoolean(source.VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP, true),
    localTestAccountIndex: parseNumber(source.VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX, 0),
  };
}
