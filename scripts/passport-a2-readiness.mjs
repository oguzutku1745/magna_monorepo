#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const expectedArtifactHash = "a3b6b963911d5ec9021a302a38be59b4016f7def2d182e15dbb280a8a19f844a";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const entries = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[trimmed.slice(0, eqIndex).trim()] = value;
  }
  return entries;
}

for (const path of [
  "apps/magna-management/.env",
  "apps/magna-management/.env.local",
  "apps/magna-verification-api/.env",
  "apps/magna-verification-api/.env.local",
]) {
  Object.assign(process.env, parseEnvFile(resolve(root, path)));
}

const issuanceKind = process.env.VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND?.trim().toLowerCase();
if (issuanceKind && issuanceKind !== "a2") {
  failures.push("VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND must be a2 when set.");
}

const artifactPath = resolve(
  root,
  "packages/magna-passport-wrapper-proof/circuit/bundle/magna_passport_wrapper_proof.json",
);
if (!existsSync(artifactPath)) {
  failures.push(`Missing committed Passport A2 wrapper artifact: ${artifactPath}`);
} else {
  const bytes = readFileSync(artifactPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedArtifactHash) {
    failures.push(`Passport A2 wrapper artifact hash mismatch: ${digest}`);
  }
  const artifact = JSON.parse(bytes.toString("utf8"));
  const returnType = artifact.abi?.return_type;
  if (
    returnType?.visibility !== "public" ||
    returnType?.abi_type?.kind !== "array" ||
    returnType?.abi_type?.length !== 8 ||
    returnType?.abi_type?.type?.kind !== "field"
  ) {
    failures.push("Passport A2 wrapper artifact must expose exactly eight public Field outputs.");
  }
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (packageJson.dependencies?.["@zkpassport/sdk"] !== "0.16.1") {
  failures.push("The root @zkpassport/sdk version must be pinned to 0.16.1.");
}
if (packageJson.dependencies?.["@zkpassport/utils"] !== "0.37.3") {
  failures.push("The root @zkpassport/utils version must be pinned to 0.37.3.");
}

if (failures.length > 0) {
  console.error("Passport A2 readiness failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Passport A2 readiness checks passed.");
