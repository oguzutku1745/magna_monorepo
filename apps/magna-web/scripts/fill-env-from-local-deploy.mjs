#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function parseEnvPairs(content) {
  const map = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1);
    map.set(key, value);
  }
  return map;
}

function parseAddressList(value) {
  if (Array.isArray(value)) {
    return value
      .map(entry => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function dedupeList(values) {
  return Array.from(new Set(values));
}

function loadJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireString(value, fieldName, context) {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  throw new Error(`Missing ${fieldName} in ${context}`);
}

function usage() {
  return `Usage:
  node ./apps/magna-web/scripts/fill-env-from-local-deploy.mjs [options]

Options:
  --network-name <name>            Default: local
  --manifest <path>                Default: deployments/<network>.json
  --out <path>                     Default: apps/magna-web/.env.local
  --template <path>                Default: apps/magna-web/.env.example
  --issuer-address <aztec address> Optional explicit issuer address
  --company-sponsor-address <aztec address> Optional explicit sponsor address
  --company-sponsor-addresses <csv> Optional explicit sponsor address list
  --active-company-sponsor-address <aztec address> Optional selected active sponsor
  --orchestrator-address <aztec address> Optional explicit orchestrator sender
  --verification-api-url <url>       Optional explicit zkPassport verification API URL
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.info(usage());
    process.exit(0);
  }

  const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const networkName = String(args.networkName ?? "local");
  const templatePath = resolve(repoRoot, String(args.template ?? "apps/magna-web/.env.example"));
  const manifestPath = resolve(repoRoot, String(args.manifest ?? `deployments/${networkName}.json`));
  const outPath = resolve(repoRoot, String(args.out ?? "apps/magna-web/.env.local"));

  const templateRaw = readFileSync(templatePath, "utf8");
  const templatePairs = parseEnvPairs(templateRaw);
  const existingOutPairs = existsSync(outPath) ? parseEnvPairs(readFileSync(outPath, "utf8")) : new Map();
  const manifest = loadJson(manifestPath, "Deployment manifest");

  const aztecNodeUrl = requireString(manifest?.endpoints?.aztecNodeUrl, "endpoints.aztecNodeUrl", "manifest");
  const manifestL1RpcUrl = typeof manifest?.endpoints?.l1RpcUrl === "string" ? manifest.endpoints.l1RpcUrl.trim() : "";
  const manifestL1PortalAddress = typeof manifest?.l1?.portalAddress === "string" ? manifest.l1.portalAddress.trim() : "";
  const manifestL1PaymentTokenAddress =
    typeof manifest?.l1?.paymentTokenAddress === "string" ? manifest.l1.paymentTokenAddress.trim() : "";
  const rightsRegistryAddress = requireString(manifest?.l2?.rightsRegistryAddress, "l2.rightsRegistryAddress", "manifest");
  const rightsPurchaseAddress = requireString(manifest?.l2?.purchaseAdapterAddress, "l2.purchaseAdapterAddress", "manifest");
  const l2PaymentTokenAddress = requireString(manifest?.l2?.paymentTokenAddress, "l2.paymentTokenAddress", "manifest");
  const adminAddress = requireString(manifest?.l2?.adminAddress, "l2.adminAddress", "manifest");

  const manifestSponsorAddresses = dedupeList([
    ...parseAddressList(manifest?.l2?.companySponsorAddresses),
    ...parseAddressList(manifest?.l2?.activeCompanySponsorAddress),
    ...parseAddressList(manifest?.l2?.companySponsorAddress),
  ]);
  const existingSponsorAddresses = parseAddressList(existingOutPairs.get("VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES"));
  const templateSponsorAddresses = parseAddressList(templatePairs.get("VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES"));
  const explicitSponsorAddresses = parseAddressList(args.companySponsorAddresses);

  const issuerAddress =
    (typeof args.issuerAddress === "string" && args.issuerAddress.trim()) ||
    manifest?.l2?.issuerAddress ||
    existingOutPairs.get("VITE_MAGNA_ISSUER_ADDRESS") ||
    templatePairs.get("VITE_MAGNA_ISSUER_ADDRESS") ||
    "";
  const explicitLegacyCompanySponsorAddress =
    typeof args.companySponsorAddress === "string" && args.companySponsorAddress.trim()
      ? args.companySponsorAddress.trim()
      : "";
  const manifestLegacyCompanySponsorAddress =
    (typeof manifest?.l2?.companySponsorAddress === "string" && manifest.l2.companySponsorAddress.trim()) || "";
  const fallbackLegacyCompanySponsorAddress =
    existingOutPairs.get("VITE_MAGNA_COMPANY_SPONSOR_ADDRESS") ||
    templatePairs.get("VITE_MAGNA_COMPANY_SPONSOR_ADDRESS") ||
    "";
  const sponsorAddressList = dedupeList(
    manifestSponsorAddresses.length > 0
      ? [
          ...explicitSponsorAddresses,
          ...manifestSponsorAddresses,
          ...(explicitLegacyCompanySponsorAddress ? [explicitLegacyCompanySponsorAddress] : []),
        ]
      : [
          ...explicitSponsorAddresses,
          ...existingSponsorAddresses,
          ...templateSponsorAddresses,
          ...(explicitLegacyCompanySponsorAddress ? [explicitLegacyCompanySponsorAddress] : []),
          ...(fallbackLegacyCompanySponsorAddress ? [fallbackLegacyCompanySponsorAddress] : []),
        ],
  );
  const requestedActiveCompanySponsorAddress =
    (typeof args.activeCompanySponsorAddress === "string" && args.activeCompanySponsorAddress.trim()) ||
    manifest?.l2?.activeCompanySponsorAddress ||
    existingOutPairs.get("VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS") ||
    templatePairs.get("VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS") ||
    explicitLegacyCompanySponsorAddress ||
    manifestLegacyCompanySponsorAddress ||
    fallbackLegacyCompanySponsorAddress ||
    sponsorAddressList[0];
  const activeCompanySponsorAddress =
    requestedActiveCompanySponsorAddress && sponsorAddressList.includes(requestedActiveCompanySponsorAddress)
      ? requestedActiveCompanySponsorAddress
      : sponsorAddressList[0];
  if (activeCompanySponsorAddress && !sponsorAddressList.includes(activeCompanySponsorAddress)) {
    sponsorAddressList.push(activeCompanySponsorAddress);
  }
  const companySponsorAddresses = sponsorAddressList.join(",");
  const companySponsorAddress =
    explicitLegacyCompanySponsorAddress ||
    manifestLegacyCompanySponsorAddress ||
    activeCompanySponsorAddress ||
    sponsorAddressList[0] ||
    "";
  const orchestratorAddress =
    (typeof args.orchestratorAddress === "string" && args.orchestratorAddress.trim()) ||
    existingOutPairs.get("VITE_MAGNA_ORCHESTRATOR_ADDRESS") ||
    adminAddress;
  const l1RpcUrl =
    manifestL1RpcUrl ||
    existingOutPairs.get("VITE_MAGNA_L1_RPC_URL") ||
    templatePairs.get("VITE_MAGNA_L1_RPC_URL") ||
    "";
  const l1RightsPortalAddress =
    manifestL1PortalAddress ||
    existingOutPairs.get("VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS") ||
    templatePairs.get("VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS") ||
    "";
  const l1PaymentTokenAddress =
    manifestL1PaymentTokenAddress ||
    existingOutPairs.get("VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS") ||
    templatePairs.get("VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS") ||
    "";
  const l1BuyerPrivateKey =
    existingOutPairs.get("VITE_MAGNA_L1_BUYER_PRIVATE_KEY") ||
    templatePairs.get("VITE_MAGNA_L1_BUYER_PRIVATE_KEY") ||
    "";
  const verificationApiUrl =
    (typeof args.verificationApiUrl === "string" && args.verificationApiUrl.trim()) ||
    existingOutPairs.get("VITE_MAGNA_VERIFICATION_API_URL") ||
    templatePairs.get("VITE_MAGNA_VERIFICATION_API_URL") ||
    "";

  const merged = new Map(templatePairs);
  merged.set("VITE_AZTEC_NODE_URL", aztecNodeUrl);
  merged.set("VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS", rightsRegistryAddress);
  merged.set("VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS", rightsPurchaseAddress);
  merged.set("VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS", l2PaymentTokenAddress);
  merged.set("VITE_MAGNA_ORCHESTRATOR_ADDRESS", orchestratorAddress);
  merged.set("VITE_MAGNA_VERIFICATION_API_URL", verificationApiUrl);
  merged.set("VITE_MAGNA_L1_RPC_URL", l1RpcUrl);
  merged.set("VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS", l1RightsPortalAddress);
  merged.set("VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS", l1PaymentTokenAddress);
  merged.set("VITE_MAGNA_L1_BUYER_PRIVATE_KEY", l1BuyerPrivateKey);
  merged.set("VITE_MAGNA_SPONSOR_PROFILE_NAME", existingOutPairs.get("VITE_MAGNA_SPONSOR_PROFILE_NAME") ?? `${networkName}-sponsor`);
  merged.set("VITE_MAGNA_ISSUER_ADDRESS", issuerAddress);
  merged.set("VITE_MAGNA_COMPANY_SPONSOR_ADDRESS", companySponsorAddress);
  merged.set("VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES", companySponsorAddresses);
  merged.set("VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS", activeCompanySponsorAddress);

  const lines = templateRaw.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = line.indexOf("=");
    if (eq < 0) return line;
    const key = line.slice(0, eq).trim();
    if (!merged.has(key)) return line;
    return `${key}=${merged.get(key) ?? ""}`;
  });

  writeFileSync(outPath, `${lines.join("\n").replace(/\n+$/, "\n")}`, "utf8");

  const warnings = [];
  if (!issuerAddress) warnings.push("VITE_MAGNA_ISSUER_ADDRESS is still empty (pass --issuer-address)");
  if (!companySponsorAddress) warnings.push("VITE_MAGNA_COMPANY_SPONSOR_ADDRESS is still empty (pass --company-sponsor-address)");
  if (!companySponsorAddresses) {
    warnings.push("VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES is still empty (pass --company-sponsor-addresses)");
  }
  if (!l1RpcUrl) warnings.push("VITE_MAGNA_L1_RPC_URL is still empty");
  if (!l1RightsPortalAddress) warnings.push("VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS is still empty");
  if (!l1PaymentTokenAddress) warnings.push("VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS is still empty");
  if (!verificationApiUrl) warnings.push("VITE_MAGNA_VERIFICATION_API_URL is still empty");

  console.info(`Wrote ${outPath} from ${manifestPath}`);
  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`WARN: ${warning}`);
    }
  }
}

main();
