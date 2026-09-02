#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const artifactProfiles = [
  {
    name: "production",
    path: "packages/magna-passport-wrapper-proof/circuit/bundle/magna_passport_wrapper_proof.json",
    hash: "a7093ad57c0a5cfcb073134d7ed0907067e9b253b11f929fd84b4a321179cea7",
  },
  {
    name: "development",
    path: "packages/magna-passport-wrapper-proof/circuit-dev/bundle/magna_passport_wrapper_proof_dev.json",
    hash: "b952eb6435ac847e6dc87e5400b5e81703c2537629b56bab1a550a4561eca4c4",
  },
];
const productionCircuitPath = resolve(
  root,
  "packages/magna-passport-wrapper-proof/circuit/src/main.nr",
);
const developmentCircuitPath = resolve(
  root,
  "packages/magna-passport-wrapper-proof/circuit-dev/src/main.nr",
);

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

for (const profile of artifactProfiles) {
  const artifactPath = resolve(root, profile.path);
  if (!existsSync(artifactPath)) {
    failures.push(`Missing committed Passport A2 ${profile.name} wrapper artifact: ${artifactPath}`);
  } else {
    const bytes = readFileSync(artifactPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== profile.hash) {
      failures.push(`Passport A2 ${profile.name} wrapper artifact hash mismatch: ${digest}`);
    }
    const artifact = JSON.parse(bytes.toString("utf8"));
    const returnType = artifact.abi?.return_type;
    if (
      returnType?.visibility !== "public" ||
      returnType?.abi_type?.kind !== "array" ||
      returnType?.abi_type?.length !== 8 ||
      returnType?.abi_type?.type?.kind !== "field"
    ) {
      failures.push(
        `Passport A2 ${profile.name} wrapper artifact must expose exactly eight public Field outputs.`,
      );
    }
  }
}

if (existsSync(productionCircuitPath) && existsSync(developmentCircuitPath)) {
  const expectedDevelopmentCircuit = readFileSync(productionCircuitPath, "utf8")
    .replace(
      "global ZKPASSPORT_SALTED_NULLIFIER_TYPE: Field = 1;",
      "global ZKPASSPORT_NON_SALTED_MOCK_NULLIFIER_TYPE: Field = 2;",
    )
    .replace(
      "global ZKPASSPORT_OPRF_PUBLIC_KEY_HASH: Field =\n    1178201404428554206520802247552222388413553631367032661928167491793274360628;",
      "global ZKPASSPORT_NO_OPRF_PUBLIC_KEY_HASH: Field = 0;",
    )
    .replace("global FACEMATCH_MODE_STRICT: u8 = 2;", "global FACEMATCH_MODE_REGULAR: u8 = 1;")
    .replace(
      "facematch_mode == FACEMATCH_MODE_STRICT",
      "facematch_mode == FACEMATCH_MODE_REGULAR",
    )
    .replace("Facematch must use strict mode", "Developer facematch must use regular mode")
    .replace(
      "zkpassport_outer_public_inputs[9] == ZKPASSPORT_SALTED_NULLIFIER_TYPE",
      "zkpassport_outer_public_inputs[9] == ZKPASSPORT_NON_SALTED_MOCK_NULLIFIER_TYPE",
    )
    .replace(
      "zkPassport nullifier is not production salted",
      "zkPassport nullifier is not official non-salted mock",
    )
    .replace(
      "zkpassport_outer_public_inputs[11] == ZKPASSPORT_OPRF_PUBLIC_KEY_HASH",
      "zkpassport_outer_public_inputs[11] == ZKPASSPORT_NO_OPRF_PUBLIC_KEY_HASH",
    )
    .replace(
      "zkPassport OPRF public key is not pinned",
      "Non-salted zkPassport proof must not carry an OPRF public key",
    )
    .trimEnd();
  const actualDevelopmentCircuit = readFileSync(developmentCircuitPath, "utf8").trimEnd();
  if (actualDevelopmentCircuit !== expectedDevelopmentCircuit) {
    failures.push(
      "Passport A2 developer circuit differs from production beyond the approved profile constraints.",
    );
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
