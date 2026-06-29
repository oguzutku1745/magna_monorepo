#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function envHasLine(envText, key, value) {
  return envText.split(/\r?\n/u).includes(`${key}=${value}`);
}

function outputsAreComplete({ manifestPath, envOutPath, managementEnvOutPath, referenceDappEnvOutPath }) {
  try {
    if (
      !existsSync(manifestPath) ||
      !existsSync(envOutPath) ||
      !existsSync(managementEnvOutPath) ||
      !existsSync(referenceDappEnvOutPath)
    ) {
      return false;
    }

    const manifest = readJson(manifestPath);
    const l2 = manifest?.l2 ?? {};
    const envText = readText(envOutPath);
    const managementEnvText = readText(managementEnvOutPath);
    const referenceDappEnvText = readText(referenceDappEnvOutPath);

    const requiredManifestFields = [
      l2.adminAddress,
      l2.rightsRegistryAddress,
      l2.purchaseAdapterAddress,
      l2.paymentTokenAddress,
      l2.issuerAddress,
      l2.companySponsorAddress,
      l2.consumerAddress,
      l2.referenceDappConsumerAddress,
      l2.webBootstrap?.orchestratorAddress,
    ];
    if (requiredManifestFields.some(value => !value)) return false;

    const webEnvMatchesManifest =
      envHasLine(envText, "VITE_MAGNA_ISSUER_ADDRESS", l2.issuerAddress) &&
      envHasLine(envText, "VITE_MAGNA_COMPANY_SPONSOR_ADDRESS", l2.companySponsorAddress) &&
      envHasLine(envText, "VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS", l2.rightsRegistryAddress) &&
      envHasLine(envText, "VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS", l2.purchaseAdapterAddress) &&
      envHasLine(envText, "VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS", l2.paymentTokenAddress);
    const managementEnvMatchesManifest =
      envHasLine(managementEnvText, "VITE_MAGNA_ISSUER_ADDRESS", l2.issuerAddress) &&
      envHasLine(managementEnvText, "VITE_MAGNA_COMPANY_SPONSOR_ADDRESS", l2.companySponsorAddress) &&
      envHasLine(managementEnvText, "VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS", l2.rightsRegistryAddress) &&
      envHasLine(managementEnvText, "VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS", l2.purchaseAdapterAddress) &&
      envHasLine(managementEnvText, "VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS", l2.paymentTokenAddress) &&
      envHasLine(managementEnvText, "VITE_REFERENCE_DAPP_GATEWAY", l2.referenceDappConsumerAddress);
    const referenceDappEnvIsReady =
      envHasLine(referenceDappEnvText, "VITE_MAGNA_WALLET_ORIGIN", "http://localhost:5174");

    return webEnvMatchesManifest && managementEnvMatchesManifest && referenceDappEnvIsReady;
  } catch {
    return false;
  }
}

function exitDescription(result) {
  return result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 1}`;
}

function isAztecNativeTeardownNoise(line) {
  return (
    /^node\(\d+,0x[0-9a-f]+\) malloc: double free for ptr 0x[0-9a-f]+$/iu.test(line) ||
    /^node\(\d+,0x[0-9a-f]+\) malloc: \*\*\* set a breakpoint in malloc_error_break to(?: debug)?$/iu.test(
      line.trim(),
    )
  );
}

function pipeFilteredStderr(stream) {
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", chunk => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/u);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!isAztecNativeTeardownNoise(line)) {
        process.stderr.write(`${line}\n`);
      }
    }
  });
  stream.on("end", () => {
    if (buffered && !isAztecNativeTeardownNoise(buffered)) {
      process.stderr.write(buffered);
    }
  });
}

function runWorker(scriptPath, argv) {
  return new Promise((resolveWorker, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argv], {
      cwd: repoRoot,
      stdio: ["inherit", "inherit", "pipe"],
      shell: false,
    });

    pipeFilteredStderr(child.stderr);

    child.on("error", reject);
    child.on("close", (status, signal) => {
      resolveWorker({ status, signal });
    });
  });
}

const args = parseArgs(process.argv.slice(2));
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const networkName = String(args.networkName ?? "local");
const manifestPath = resolve(repoRoot, args.manifest ?? `deployments/${networkName}.json`);
const envOutPath = resolve(repoRoot, args.envOut ?? "apps/magna-web/.env.local");
const managementEnvOutPath = resolve(repoRoot, args.managementEnvOut ?? "apps/magna-management/.env");
const referenceDappEnvOutPath = resolve(repoRoot, args.referenceDappEnvOut ?? "apps/reference-dapp/.env");

const result = await runWorker(resolve(here, "bootstrap-web-local.mjs"), process.argv.slice(2));

if ((result.status ?? 1) === 0) {
  process.exit(0);
}

if (
  outputsAreComplete({ manifestPath, envOutPath, managementEnvOutPath, referenceDappEnvOutPath })
) {
  console.info("[web-bootstrap] verified complete local outputs after Aztec worker teardown.");
  process.exit(0);
}

console.error(`[web-bootstrap] bootstrap failed with ${exitDescription(result)} before complete outputs were written.`);
process.exit(result.status ?? 1);
