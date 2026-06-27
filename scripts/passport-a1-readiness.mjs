#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
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

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const entries = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
}

function hydrateEnvFromFiles() {
  const candidatePaths = [
    resolve(root, "apps/magna-web/.env"),
    resolve(root, "apps/magna-web/.env.local"),
    resolve(root, "apps/magna-verification-api/.env"),
    resolve(root, "apps/magna-verification-api/.env.local"),
  ];
  for (const path of candidatePaths) {
    Object.assign(process.env, parseEnvFile(path));
  }
}

function env(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function bool(name) {
  const value = env(name);
  return value ? ["1", "true", "yes", "on"].includes(value.toLowerCase()) : false;
}

function resolveProfile(args) {
  const rawProfile = String(args.profile ?? env("MAGNA_PASSPORT_A1_READINESS_PROFILE") ?? "auto").toLowerCase();
  if (rawProfile === "prod") return "production";
  if (rawProfile === "dev" || rawProfile === "local") return "development";
  if (rawProfile !== "auto" && rawProfile !== "production" && rawProfile !== "development") {
    failures.push("Passport A1 readiness profile must be production, development, or auto.");
    return "production";
  }
  if (rawProfile !== "auto") return rawProfile;
  return bool("VITE_MAGNA_ZKPASSPORT_DEV_MODE") ||
    bool("MAGNA_ZKPASSPORT_DEV_MODE") ||
    bool("VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP") ||
    bool("VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR")
    ? "development"
    : "production";
}

function hasPlaceholder(value) {
  return /<[^>]+>/u.test(value);
}

hydrateEnvFromFiles();

const args = parseArgs(process.argv.slice(2));
const profile = resolveProfile(args);
const isDevelopment = profile === "development";
const issuanceKind = (env("VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND") ?? (isDevelopment ? "" : "a1")).toLowerCase();
if (issuanceKind !== "a1") {
  failures.push(`VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND must be a1 for ${profile} Passport A1 readiness.`);
}

if (isDevelopment) {
  const frontendDevMode = bool("VITE_MAGNA_ZKPASSPORT_DEV_MODE");
  const backendDevMode = env("MAGNA_ZKPASSPORT_DEV_MODE") ? bool("MAGNA_ZKPASSPORT_DEV_MODE") : frontendDevMode;
  if (!frontendDevMode) {
    failures.push("VITE_MAGNA_ZKPASSPORT_DEV_MODE must be enabled for development Passport A1 readiness.");
  }
  if (!backendDevMode) {
    failures.push("MAGNA_ZKPASSPORT_DEV_MODE must be enabled, or unset so the API inherits VITE_MAGNA_ZKPASSPORT_DEV_MODE.");
  }
} else if (bool("VITE_MAGNA_ZKPASSPORT_DEV_MODE") || bool("MAGNA_ZKPASSPORT_DEV_MODE")) {
  failures.push("zkPassport dev mode must be disabled for production Passport A1 readiness.");
}

if (!isDevelopment && bool("VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR")) {
  failures.push("VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR must be disabled for production Passport A1 readiness.");
}
if (!isDevelopment && bool("VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP")) {
  failures.push("VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP must be disabled for production Passport A1 readiness.");
}
const evmRpcUrl = env("MAGNA_ZKPASSPORT_EVM_RPC_URL");
if (!evmRpcUrl) {
  failures.push(
    `MAGNA_ZKPASSPORT_EVM_RPC_URL is required for ${isDevelopment ? "Sepolia dev-mode" : "production"} backend outer proof verification.`,
  );
} else if (hasPlaceholder(evmRpcUrl)) {
  failures.push("MAGNA_ZKPASSPORT_EVM_RPC_URL still contains a placeholder value.");
} else {
  try {
    new URL(evmRpcUrl);
  } catch {
    failures.push("MAGNA_ZKPASSPORT_EVM_RPC_URL must be a valid URL.");
  }
}

const circuitArtifact = resolve(
  root,
  "packages/magna-passport-wrapper-proof/circuit/target/magna_passport_wrapper_proof.json",
);
if (!existsSync(circuitArtifact)) {
  failures.push(`Missing wrapper circuit artifact: ${circuitArtifact}`);
}

const browserProver = resolve(root, "packages/magna-passport-wrapper-proof/src/browser.ts");
if (!existsSync(browserProver)) {
  failures.push(`Missing browser wrapper prover entrypoint: ${browserProver}`);
}

if (failures.length > 0) {
  console.error("Passport A1 readiness failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Passport A1 readiness checks passed (${profile}).`);
