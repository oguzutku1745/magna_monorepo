#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileArgument = process.argv.find(argument => argument.startsWith("--profile="));
const profile = profileArgument?.slice("--profile=".length) ?? "production";
if (profile !== "development" && profile !== "production") {
  throw new Error("Passport A2 artifact profile must be development or production.");
}
const circuitDirectory = profile === "development" ? "circuit-dev" : "circuit";
const artifactName =
  profile === "development" ? "magna_passport_wrapper_proof_dev" : "magna_passport_wrapper_proof";
const generatedPath = resolve(
  repoRoot,
  `packages/magna-passport-wrapper-proof/${circuitDirectory}/target/${artifactName}.json`,
);
const committedPath = resolve(
  repoRoot,
  `packages/magna-passport-wrapper-proof/${circuitDirectory}/bundle/${artifactName}.json`,
);
const expectedParameters = [
  "zkpassport_outer_vkey",
  "zkpassport_outer_proof",
  "zkpassport_outer_public_inputs",
  "disclose_mask",
  "disclosed_bytes",
  "nationality",
  "expiry_mrz",
  "nationality_blind",
  "expiry_ts",
  "expiry_blind",
  "min_age_proven",
  "age_min_bound",
  "age_max_bound",
  "bind_data",
  "facematch_root_key_leaf",
  "facematch_environment",
  "facematch_app_id_hash",
  "facematch_integrity_public_key_hash",
  "facematch_mode",
  "credential_valid_until",
  "action",
  "issuer",
  "owner",
  "ghost_owner",
  "credential_mode",
];

const artifact = JSON.parse(readFileSync(generatedPath, "utf8"));
const parameterNames = artifact.abi?.parameters?.map(parameter => parameter.name);
if (JSON.stringify(parameterNames) !== JSON.stringify(expectedParameters)) {
  throw new Error("Refusing to sync a wrapper artifact whose A2 witness ABI does not match the pinned schema.");
}
const returnType = artifact.abi?.return_type;
if (
  returnType?.visibility !== "public" ||
  returnType?.abi_type?.kind !== "array" ||
  returnType?.abi_type?.length !== 8 ||
  returnType?.abi_type?.type?.kind !== "field"
) {
  throw new Error("Refusing to sync a wrapper artifact without exactly eight public Field outputs.");
}
if (!String(artifact.noir_version ?? "").startsWith("1.0.0-beta.22")) {
  throw new Error(`Refusing to sync wrapper artifact built by ${artifact.noir_version ?? "an unknown Noir version"}.`);
}

const bundle = {
  noir_version: artifact.noir_version,
  hash: artifact.hash,
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  debug_symbols: "",
  file_map: {},
};
const bundleBytes = Buffer.from(JSON.stringify(bundle));
const bundleHash = createHash("sha256").update(bundleBytes).digest("hex");
const expectedBundleHash =
  profile === "development"
    ? "b952eb6435ac847e6dc87e5400b5e81703c2537629b56bab1a550a4561eca4c4"
    : "a7093ad57c0a5cfcb073134d7ed0907067e9b253b11f929fd84b4a321179cea7";
if (bundleHash !== expectedBundleHash) {
  throw new Error(`Refusing to sync unpinned Passport A2 bundle hash ${bundleHash}.`);
}

mkdirSync(dirname(committedPath), { recursive: true });
writeFileSync(committedPath, bundleBytes);
console.log(`Synced deterministic Passport A2 ${profile} artifact to ${committedPath}`);
