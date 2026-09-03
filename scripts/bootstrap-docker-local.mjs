#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(process.env.MAGNA_DOCKER_RUNTIME_DIR ?? "/runtime");
const manifestPath = resolve(process.env.MAGNA_DEPLOYMENT_MANIFEST ?? "/workspace/deployments/local.json");
const internalAztecNodeUrl = process.env.MAGNA_AZTEC_NODE_URL ?? "http://aztec-localnet:8080";
const internalL1RpcUrl = process.env.MAGNA_L1_RPC_URL ?? "http://aztec-localnet:8545";
const publicAztecNodeUrl = process.env.MAGNA_PUBLIC_AZTEC_NODE_URL ?? "http://localhost:8080";
const publicL1RpcUrl = process.env.MAGNA_PUBLIC_L1_RPC_URL ?? "http://127.0.0.1:18545";
const publicVerificationApiUrl = process.env.MAGNA_PUBLIC_VERIFICATION_API_URL ?? "http://localhost:4310";
const publicWalletOrigin = process.env.MAGNA_PUBLIC_WALLET_ORIGIN ?? "http://localhost:5174";
const completionMarkerPath = resolve(runtimeDir, "bootstrap-complete.json");
const localAnvilKey =
  process.env.MAGNA_DOCKER_LOCAL_ANVIL_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const localInstagramDkimPubkeyHashes =
  process.env.MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES ??
  "0x2f98bb0fd5d8e691af9dd90027c769678ac017a689173593d6edc98faa01c952";

function run(label, command, args, env = process.env) {
  console.info(`[docker-bootstrap] ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `${label} failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 1}`}`,
    );
  }
}

function readManifest() {
  if (!existsSync(manifestPath)) throw new Error(`Deployment manifest was not created: ${manifestPath}`);
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function requireManifestString(manifest, path) {
  let cursor = manifest;
  for (const segment of path) cursor = cursor?.[segment];
  if (typeof cursor !== "string" || !cursor.trim()) {
    throw new Error(`Deployment manifest is missing ${path.join(".")}.`);
  }
  return cursor.trim();
}

function envText(entries) {
  return `${Object.entries(entries)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function ensureLocalInstagramDkimTrustConfig() {
  const path = resolve(runtimeDir, "verification-api.env");
  if (!existsSync(path)) return;
  const current = readFileSync(path, "utf8");
  const entry = `MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES=${localInstagramDkimPubkeyHashes}`;
  const next = /^MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES=.*$/m.test(current)
    ? current.replace(/^MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES=.*$/m, entry)
    : `${current}${current.endsWith("\n") ? "" : "\n"}${entry}\n`;
  if (next === current) return;
  writeFileSync(path, next, "utf8");
  console.info("[docker-bootstrap] synchronized the governed local Instagram DKIM keys in runtime configuration.");
}

function configureDockerFrontendProfile(deploymentInstanceId) {
  for (const fileName of ["magna-management.env", "reference-dapp.env"]) {
    const path = resolve(runtimeDir, fileName);
    if (!existsSync(path)) throw new Error(`Cannot bind the Docker deployment instance; missing ${path}.`);
    const current = readFileSync(path, "utf8");
    const entries = {
      VITE_MAGNA_DEPLOYMENT_PROFILE: "development",
      VITE_MAGNA_DEPLOYMENT_INSTANCE_ID: deploymentInstanceId,
    };
    let next = current;
    for (const [key, value] of Object.entries(entries)) {
      const entry = `${key}=${value}`;
      next = new RegExp(`^${key}=.*$`, "m").test(next)
        ? next.replace(new RegExp(`^${key}=.*$`, "m"), entry)
        : `${next}${next.endsWith("\n") ? "" : "\n"}${entry}\n`;
    }
    writeFileSync(path, next, "utf8");
  }
}

function existingDeploymentInstanceId() {
  const path = resolve(runtimeDir, "magna-management.env");
  if (!existsSync(path)) return undefined;
  return readFileSync(path, "utf8").match(/^VITE_MAGNA_DEPLOYMENT_INSTANCE_ID=(.+)$/m)?.[1]?.trim();
}

async function existingBootstrapIsValid() {
  const requiredRuntimeFiles = [
    "magna-management.env",
    "reference-dapp.env",
    "verification-api.env",
  ].map((fileName) => resolve(runtimeDir, fileName));

  if (
    !existsSync(manifestPath) ||
    !existsSync(completionMarkerPath) ||
    requiredRuntimeFiles.some((filePath) => !existsSync(filePath))
  ) {
    return false;
  }

  try {
    const manifestBytes = readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const marker = JSON.parse(readFileSync(completionMarkerPath, "utf8"));
    const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
    const portalAddress = requireManifestString(manifest, ["recoveryV3", "portalAddress"]);

    if (marker?.manifestSha256 !== manifestSha256) return false;

    const response = await fetch(internalL1RpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [portalAddress, "latest"] }),
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return typeof payload?.result === "string" && payload.result !== "0x" && payload.result !== "0x0";
  } catch {
    return false;
  }
}

if (Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10) < 24) {
  throw new Error(`Node.js >=24 is required; received ${process.versions.node}.`);
}

mkdirSync(dirname(manifestPath), { recursive: true });
mkdirSync(runtimeDir, { recursive: true });

if (await existingBootstrapIsValid()) {
  ensureLocalInstagramDkimTrustConfig();
  configureDockerFrontendProfile(existingDeploymentInstanceId() ?? randomUUID());
  console.info("[docker-bootstrap] existing manifest, runtime configuration, and L1 portal are valid; bootstrap is already complete.");
  process.exit(0);
}

if (existsSync(completionMarkerPath)) {
  console.info("[docker-bootstrap] existing completion marker is stale for the current chain; performing a fresh deployment.");
}

run("deploy the complete local Aztec application stack", process.execPath, [
  "./scripts/bootstrap-local-apps-wrapper.mjs",
  "--network-name",
  "local",
  "--manifest",
  manifestPath,
  "--management-env-out",
  resolve(runtimeDir, "magna-management.env"),
  "--reference-dapp-env-out",
  resolve(runtimeDir, "reference-dapp.env"),
  "--aztec-node-url",
  internalAztecNodeUrl,
  "--l1-rpc-url",
  internalL1RpcUrl,
  "--public-aztec-node-url",
  publicAztecNodeUrl,
  "--public-l1-rpc-url",
  publicL1RpcUrl,
  "--verification-api-url",
  publicVerificationApiUrl,
  "--recovery-v3-relayer-private-key",
  localAnvilKey,
  "--local-faucet-private-key",
  localAnvilKey,
]);

run("deploy and pin Recovery V3", process.execPath, ["./scripts/bootstrap-recovery-v3-local.mjs"], {
  ...process.env,
  MAGNA_DEPLOYMENT_MANIFEST: manifestPath,
  MAGNA_L1_RPC_URL: internalL1RpcUrl,
  MAGNA_AZTEC_NODE_URL: internalAztecNodeUrl,
});

const manifest = readManifest();
const issuerAddress = requireManifestString(manifest, ["l2", "issuerAddress"]);
const orchestratorAddress = requireManifestString(manifest, ["l2", "webBootstrap", "orchestratorAddress"]);
requireManifestString(manifest, ["recoveryV3", "portalAddress"]);
requireManifestString(manifest, ["recoveryV3", "wrapperVerifierAddress"]);
requireManifestString(manifest, ["recoveryV3", "issuerPortalInitializationTxHash"]);

writeFileSync(
  resolve(runtimeDir, "verification-api.env"),
  envText({
    MAGNA_VERIFICATION_API_PORT: "4310",
    MAGNA_VERIFICATION_ALLOWED_ORIGIN: publicWalletOrigin,
    MAGNA_WALLET_ORIGIN: publicWalletOrigin,
    MAGNA_ZKPASSPORT_DOMAIN: "localhost",
    MAGNA_ZKPASSPORT_SCOPE: "magna-passport-onboarding",
    MAGNA_ZKPASSPORT_DEV_MODE: "true",
    MAGNA_ZKPASSPORT_EVM_RPC_URL:
      process.env.MAGNA_ZKPASSPORT_EVM_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    MAGNA_AZTEC_NODE_URL: internalAztecNodeUrl,
    MAGNA_DEPLOYMENT_MANIFEST: manifestPath,
    MAGNA_ISSUER_ADDRESS: issuerAddress,
    MAGNA_LOCAL_TEST_ACCOUNT_INDEX: "0",
    MAGNA_ORCHESTRATOR_ADDRESS: orchestratorAddress,
    MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES: localInstagramDkimPubkeyHashes,
  }),
  "utf8",
);

configureDockerFrontendProfile(randomUUID());

const manifestSha256 = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
writeFileSync(
  completionMarkerPath,
  `${JSON.stringify({ completedAt: new Date().toISOString(), manifestSha256 }, null, 2)}\n`,
  "utf8",
);
console.info(`[docker-bootstrap] complete (manifest sha256=${manifestSha256})`);
