import localDeployment from "../../../../deployments/local.json";

export type SponsorCatalogEntry = {
  address: string;
  isActiveDefault: boolean;
};

export type ManagementEnv = {
  aztecNodeUrl: string;
  appId: string;
  deploymentProfile: "development" | "production";
  deploymentInstanceId?: string;
  verificationApiUrl?: string;
  l1RpcUrl?: string;
  l1RightsPortalAddress?: string;
  l1PaymentTokenAddress?: string;
  recoveryV3RelayerPrivateKey?: string;
  localFaucetPrivateKey?: string;
  recoveryV3?: {
    ethereumChainId: bigint;
    aztecChainId: bigint;
    aztecProtocolVersion: bigint;
    rootRegistryAddress: `0x${string}`;
    certificateRegistryAddress: `0x${string}`;
    circuitRegistryAddress: `0x${string}`;
    wrapperVerifierAddress: `0x${string}`;
    portalAddress: `0x${string}`;
    trustContext: bigint;
    domain: string;
    scope: string;
  };
  zkPassportRequestName: string;
  zkPassportRequestLogo: string;
  zkPassportRequestPurpose: string;
  zkPassportRequestScope: string;
  zkPassportDevMode: boolean;
  zkPassportIssuanceKind: "a2";
  zkPassportPrimaryIssuanceMode: "rooted" | "passport";
  zkPassportGhostDerivationVersion: "v2_scoped";
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

type LocalDeployment = {
  l1?: {
    portalAddress?: string;
    paymentTokenAddress?: string;
  };
  l2?: {
    issuerAddress?: string;
    companySponsorAddress?: string;
    companySponsorAddresses?: string[];
    activeCompanySponsorAddress?: string;
    rightsRegistryAddress?: string;
    purchaseAdapterAddress?: string;
    paymentTokenAddress?: string;
    webBootstrap?: {
      orchestratorAddress?: string;
    };
  };
  recoveryV3?: {
    profile?: string;
    ethereumChainId?: string;
    aztecChainId?: string;
    aztecProtocolVersion?: string;
    rootRegistryAddress?: string;
    certificateRegistryAddress?: string;
    circuitRegistryAddress?: string;
    wrapperVerifierAddress?: string;
    portalAddress?: string;
    trustContext?: string;
    domain?: string;
    scope?: string;
  };
};

const deployment = localDeployment as LocalDeployment;

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

function parseDeploymentProfile(value: string | boolean | number | undefined): "development" | "production" {
  const profile = parseOptionalString(value)?.toLowerCase();
  if (!profile || profile === "development") return "development";
  if (profile === "production") return "production";
  throw new Error("VITE_MAGNA_DEPLOYMENT_PROFILE must be development or production.");
}

function localRecoveryV3(): ManagementEnv["recoveryV3"] {
  const value = deployment.recoveryV3;
  if (!value) return undefined;
  const addresses = [
    value.rootRegistryAddress,
    value.certificateRegistryAddress,
    value.circuitRegistryAddress,
    value.wrapperVerifierAddress,
    value.portalAddress,
  ];
  if (value.profile !== "development" || addresses.some(address => !/^0x[0-9a-fA-F]{40}$/.test(address ?? ""))) {
    throw new Error("deployments/local.json contains an incomplete Recovery V3 developer deployment.");
  }
  if (!value.ethereumChainId || !value.aztecChainId || !value.aztecProtocolVersion || !value.trustContext) {
    throw new Error("deployments/local.json is missing Recovery V3 network commitments.");
  }
  return {
    ethereumChainId: BigInt(value.ethereumChainId),
    aztecChainId: BigInt(value.aztecChainId),
    aztecProtocolVersion: BigInt(value.aztecProtocolVersion),
    rootRegistryAddress: value.rootRegistryAddress as `0x${string}`,
    certificateRegistryAddress: value.certificateRegistryAddress as `0x${string}`,
    circuitRegistryAddress: value.circuitRegistryAddress as `0x${string}`,
    wrapperVerifierAddress: value.wrapperVerifierAddress as `0x${string}`,
    portalAddress: value.portalAddress as `0x${string}`,
    trustContext: BigInt(value.trustContext),
    domain: value.domain ?? "localhost",
    scope: value.scope ?? "magna-passport-onboarding",
  };
}

function parseStringList(value: string | boolean | number | undefined): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map(entry => entry.trim()).filter(Boolean);
}

function parseIssuanceMode(value: string | boolean | number | undefined): "rooted" | "passport" {
  return typeof value === "string" && value.trim().toLowerCase() === "passport" ? "passport" : "rooted";
}

function parsePassportIssuanceKind(
  value: string | boolean | number | undefined,
): "a2" {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "a2") {
      return "a2";
    }
    if (normalized) {
      throw new Error("VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND must be a2.");
    }
  }
  return "a2";
}

function rejectProductionDevFlag(value: boolean, label: string): boolean {
  if (value) {
    throw new Error(`${label} must be disabled in production.`);
  }
  return false;
}

function parseGhostVersion(value: string | boolean | number | undefined): "v2_scoped" {
  if (value && value !== "v2_scoped") {
    throw new Error("VITE_MAGNA_ZKPASSPORT_GHOST_DERIVATION_VERSION must be v2_scoped.");
  }
  return "v2_scoped";
}

export function getManagementEnv(source: EnvSource = import.meta.env): ManagementEnv {
  // Vite's PROD flag only means `vite build`; Docker intentionally serves an
  // optimized bundle for the local developer network. Security policy must be
  // selected explicitly instead of being inferred from bundle optimization.
  const deploymentProfile = parseDeploymentProfile(source.VITE_MAGNA_DEPLOYMENT_PROFILE);
  const isProduction = deploymentProfile === "production";
  const legacySponsor = parseOptionalString(source.VITE_MAGNA_COMPANY_SPONSOR_ADDRESS);
  const manifestSponsors =
    deployment.l2?.companySponsorAddresses ??
    (deployment.l2?.companySponsorAddress ? [deployment.l2.companySponsorAddress] : []);
  const sponsorSet = new Set([
    ...manifestSponsors,
    ...parseStringList(source.VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES),
  ]);
  if (legacySponsor) sponsorSet.add(legacySponsor);
  const activeSponsor =
    parseOptionalString(source.VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS) ??
    legacySponsor ??
    deployment.l2?.activeCompanySponsorAddress ??
    Array.from(sponsorSet)[0];
  if (activeSponsor) sponsorSet.add(activeSponsor);
  const companySponsorAddresses = Array.from(sponsorSet);

  const zkPassportDevMode = parseBoolean(source.VITE_MAGNA_ZKPASSPORT_DEV_MODE, false);
  const enableDevOrchestrator = parseBoolean(source.VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR, !isProduction);
  const enableLocalTestBootstrap = parseBoolean(source.VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP, !isProduction);
  const recoveryV3RelayerPrivateKey = parseOptionalString(source.VITE_MAGNA_RECOVERY_V3_RELAYER_PRIVATE_KEY);
  const configuredLocalFaucetPrivateKey = parseOptionalString(source.VITE_MAGNA_LOCAL_FAUCET_PRIVATE_KEY);
  if (isProduction && configuredLocalFaucetPrivateKey) {
    throw new Error("VITE_MAGNA_LOCAL_FAUCET_PRIVATE_KEY must not be configured in production.");
  }

  return {
    aztecNodeUrl: parseOptionalString(source.VITE_AZTEC_NODE_URL) ?? "http://localhost:8080",
    appId: parseOptionalString(source.VITE_MAGNA_APP_ID) ?? "magna-management",
    deploymentProfile,
    deploymentInstanceId: parseOptionalString(source.VITE_MAGNA_DEPLOYMENT_INSTANCE_ID),
    verificationApiUrl: parseOptionalString(source.VITE_MAGNA_VERIFICATION_API_URL) ?? "http://localhost:4310",
    l1RpcUrl: parseOptionalString(source.VITE_MAGNA_L1_RPC_URL) ?? parseOptionalString(source.VITE_L1_RPC_URL),
    l1RightsPortalAddress:
      parseOptionalString(source.VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS) ?? deployment.l1?.portalAddress,
    l1PaymentTokenAddress:
      parseOptionalString(source.VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS) ?? deployment.l1?.paymentTokenAddress,
    recoveryV3RelayerPrivateKey,
    localFaucetPrivateKey: isProduction
      ? undefined
      : configuredLocalFaucetPrivateKey ?? recoveryV3RelayerPrivateKey,
    recoveryV3: localRecoveryV3(),
    zkPassportRequestName: parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_NAME) ?? "Magna",
    zkPassportRequestLogo:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_LOGO) ?? "https://magna.identity/logo.png",
    zkPassportRequestPurpose:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_PURPOSE) ??
      "Issue a Magna passport credential using zkPassport verification.",
    zkPassportRequestScope:
      parseOptionalString(source.VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE) ?? "magna-passport-onboarding",
    zkPassportDevMode: isProduction
      ? rejectProductionDevFlag(zkPassportDevMode, "VITE_MAGNA_ZKPASSPORT_DEV_MODE")
      : zkPassportDevMode,
    zkPassportIssuanceKind: parsePassportIssuanceKind(source.VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND),
    zkPassportPrimaryIssuanceMode: parseIssuanceMode(source.VITE_MAGNA_ZKPASSPORT_PRIMARY_ISSUANCE_MODE),
    zkPassportGhostDerivationVersion: parseGhostVersion(source.VITE_MAGNA_ZKPASSPORT_GHOST_DERIVATION_VERSION),
    issuerAddress: parseOptionalString(source.VITE_MAGNA_ISSUER_ADDRESS) ?? deployment.l2?.issuerAddress,
    orchestratorAddress:
      parseOptionalString(source.VITE_MAGNA_ORCHESTRATOR_ADDRESS) ?? deployment.l2?.webBootstrap?.orchestratorAddress,
    companySponsorAddresses,
    companySponsors: companySponsorAddresses.map(address => ({
      address,
      isActiveDefault: Boolean(activeSponsor && activeSponsor === address),
    })),
    activeCompanySponsorAddress: activeSponsor,
    rightsRegistryAddress:
      parseOptionalString(source.VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS) ?? deployment.l2?.rightsRegistryAddress,
    rightsPurchaseL2Address:
      parseOptionalString(source.VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS) ?? deployment.l2?.purchaseAdapterAddress,
    l2PaymentTokenAddress:
      parseOptionalString(source.VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS) ?? deployment.l2?.paymentTokenAddress,
    requireRealSends: parseBoolean(source.VITE_MAGNA_REQUIRE_REAL_SENDS, true),
    enableDevOrchestrator: isProduction
      ? rejectProductionDevFlag(enableDevOrchestrator, "VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR")
      : enableDevOrchestrator,
    enableLocalTestBootstrap: isProduction
      ? rejectProductionDevFlag(enableLocalTestBootstrap, "VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP")
      : enableLocalTestBootstrap,
    localTestAccountIndex: parseNumber(source.VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX, 0),
  };
}
