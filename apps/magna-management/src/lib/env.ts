export type SponsorCatalogEntry = {
  address: string;
  isActiveDefault: boolean;
};

export type ManagementEnv = {
  aztecNodeUrl: string;
  appId: string;
  verificationApiUrl?: string;
  l1RpcUrl?: string;
  l1RightsPortalAddress?: string;
  l1PaymentTokenAddress?: string;
  l1BuyerPrivateKey?: string;
  zkPassportRequestName: string;
  zkPassportRequestLogo: string;
  zkPassportRequestPurpose: string;
  zkPassportRequestScope: string;
  zkPassportDevMode: boolean;
  zkPassportPrimaryIssuanceMode: "rooted" | "passport";
  zkPassportGhostDerivationVersion: "v1_legacy_unscoped" | "v2_scoped";
  issuerAddress?: string;
  orchestratorAddress?: string;
  companySponsorAddresses: string[];
  companySponsors: SponsorCatalogEntry[];
  activeCompanySponsorAddress?: string;
  rightsRegistryAddress?: string;
  rightsPurchaseL2Address?: string;
  l2PaymentTokenAddress?: string;
  requireRealSends: boolean;
  enableDevOrchestrator: boolean;
  enableLocalTestBootstrap: boolean;
  localTestAccountIndex: number;
};

type EnvSource = Record<string, string | boolean | number | undefined>;

function parseBoolean(value: string | boolean | number | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string" || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseNumber(value: string | boolean | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseOptionalString(value: string | boolean | number | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseStringList(value: string | boolean | number | undefined): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map(entry => entry.trim()).filter(Boolean);
}

function parseIssuanceMode(value: string | boolean | number | undefined): "rooted" | "passport" {
  return typeof value === "string" && value.trim().toLowerCase() === "passport" ? "passport" : "rooted";
}

function parseGhostVersion(value: string | boolean | number | undefined): "v1_legacy_unscoped" | "v2_scoped" {
  if (value === "v1_legacy_unscoped" || value === "v2_scoped") return value;
  return "v2_scoped";
}

export function getManagementEnv(source: EnvSource = import.meta.env): ManagementEnv {
  const legacySponsor = parseOptionalString(source.VITE_MAGNA_COMPANY_SPONSOR_ADDRESS);
  const sponsorSet = new Set(parseStringList(source.VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES));
  if (legacySponsor) sponsorSet.add(legacySponsor);
  const activeSponsor =
    parseOptionalString(source.VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS) ?? legacySponsor ?? Array.from(sponsorSet)[0];
  if (activeSponsor) sponsorSet.add(activeSponsor);
  const companySponsorAddresses = Array.from(sponsorSet);

  return {
    aztecNodeUrl: parseOptionalString(source.VITE_AZTEC_NODE_URL) ?? "http://localhost:8080",
    appId: parseOptionalString(source.VITE_MAGNA_APP_ID) ?? "magna-management",
    verificationApiUrl: parseOptionalString(source.VITE_MAGNA_VERIFICATION_API_URL) ?? "http://localhost:4310",
    l1RpcUrl: parseOptionalString(source.VITE_L1_RPC_URL),
    l1RightsPortalAddress: parseOptionalString(source.VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS),
    l1PaymentTokenAddress: parseOptionalString(source.VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS),
    l1BuyerPrivateKey: parseOptionalString(source.VITE_MAGNA_L1_BUYER_PRIVATE_KEY),
    zkPassportRequestName: parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_NAME) ?? "Magna",
    zkPassportRequestLogo:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_LOGO) ?? "https://magna.identity/logo.png",
    zkPassportRequestPurpose:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_PURPOSE) ??
      "Issue a Magna passport credential using zkPassport verification.",
    zkPassportRequestScope:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE) ?? "magna-passport-onboarding",
    zkPassportDevMode: parseBoolean(source.VITE_MAGNA_ZKPASSPORT_DEV_MODE, false),
    zkPassportPrimaryIssuanceMode: parseIssuanceMode(source.VITE_MAGNA_ZKPASSPORT_PRIMARY_ISSUANCE_MODE),
    zkPassportGhostDerivationVersion: parseGhostVersion(source.VITE_MAGNA_ZKPASSPORT_GHOST_DERIVATION_VERSION),
    issuerAddress: parseOptionalString(source.VITE_MAGNA_ISSUER_ADDRESS),
    orchestratorAddress: parseOptionalString(source.VITE_MAGNA_ORCHESTRATOR_ADDRESS),
    companySponsorAddresses,
    companySponsors: companySponsorAddresses.map(address => ({
      address,
      isActiveDefault: Boolean(activeSponsor && activeSponsor === address),
    })),
    activeCompanySponsorAddress: activeSponsor,
    rightsRegistryAddress: parseOptionalString(source.VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS),
    rightsPurchaseL2Address: parseOptionalString(source.VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS),
    l2PaymentTokenAddress: parseOptionalString(source.VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS),
    requireRealSends: parseBoolean(source.VITE_MAGNA_REQUIRE_REAL_SENDS, true),
    enableDevOrchestrator: parseBoolean(source.VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR, false),
    enableLocalTestBootstrap: parseBoolean(source.VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP, true),
    localTestAccountIndex: parseNumber(source.VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX, 0),
  };
}
