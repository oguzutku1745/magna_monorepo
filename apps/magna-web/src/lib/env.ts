export type MagnaAppEnv = {
  aztecNodeUrl: string;
  appId: string;
  issuerAddress?: string;
  companySponsorAddress?: string;
  orchestratorAddress?: string;
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

export function getAppEnv(source: EnvSource = import.meta.env): MagnaAppEnv {
  return {
    aztecNodeUrl: parseOptionalString(source.VITE_AZTEC_NODE_URL) ?? "http://localhost:8080",
    appId: parseOptionalString(source.VITE_MAGNA_APP_ID) ?? "magna-web",
    issuerAddress: parseOptionalString(source.VITE_MAGNA_ISSUER_ADDRESS),
    companySponsorAddress: parseOptionalString(source.VITE_MAGNA_COMPANY_SPONSOR_ADDRESS),
    orchestratorAddress: parseOptionalString(source.VITE_MAGNA_ORCHESTRATOR_ADDRESS),
    enableManagedWallets: parseBoolean(source.VITE_MAGNA_ENABLE_MANAGED_WALLETS, true),
    enableDevOrchestrator: parseBoolean(source.VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR, true),
    enableLocalTestBootstrap: parseBoolean(source.VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP, true),
    localTestAccountIndex: parseNumber(source.VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX, 0),
  };
}
