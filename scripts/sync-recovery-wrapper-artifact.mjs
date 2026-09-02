#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = resolve(
  repoRoot,
  "packages/magna-recovery-wrapper-proof/circuit-dev/target/magna_recovery_wrapper_proof_dev.json",
);
const committedPath = resolve(
  repoRoot,
  "packages/magna-recovery-wrapper-proof/circuit-dev/bundle/magna_recovery_wrapper_proof_dev.json",
);
const expectedParameters = [
  "zkpassport_outer_vkey",
  "zkpassport_outer_proof",
  "zkpassport_outer_public_inputs",
  "disclose_mask",
  "disclosed_bytes",
  "nationality",
  "expiry_mrz",
  "min_age_proven",
  "age_min_bound",
  "age_max_bound",
  "facematch_root_key_leaf",
  "facematch_environment",
  "facematch_app_id_hash",
  "facematch_integrity_public_key_hash",
  "facematch_mode",
  "ethereum_chain_id",
  "recovery_portal_l1_address",
  "aztec_protocol_version",
  "aztec_chain_id",
  "issuer_l2_address",
  "destination",
  "recovery_nonce",
  "message_secret_hash",
  "recovery_wrapper_version",
];

const artifact = JSON.parse(readFileSync(generatedPath, "utf8"));
const parameterNames = artifact.abi?.parameters?.map(parameter => parameter.name);
if (JSON.stringify(parameterNames) !== JSON.stringify(expectedParameters)) {
  throw new Error("Refusing to sync a recovery wrapper artifact whose witness ABI is not pinned V3-dev.");
}
const returnType = artifact.abi?.return_type;
if (
  returnType?.visibility !== "public" ||
  returnType?.abi_type?.kind !== "array" ||
  returnType?.abi_type?.length !== 7 ||
  returnType?.abi_type?.type?.kind !== "field"
) {
  throw new Error("Refusing to sync a recovery wrapper without exactly seven public Field outputs.");
}
if (!String(artifact.noir_version ?? "").startsWith("1.0.0-beta.22")) {
  throw new Error(`Refusing to sync recovery artifact built by ${artifact.noir_version ?? "an unknown Noir version"}.`);
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
const expectedBundleHash = "7f068e040fd1d0bce2602d6c86567b590f9d58120c143e6061a9c58134c2e06b";
if (bundleHash !== expectedBundleHash) {
  throw new Error(`Refusing to sync unpinned Recovery V3 developer bundle hash ${bundleHash}.`);
}

mkdirSync(dirname(committedPath), { recursive: true });
writeFileSync(committedPath, bundleBytes);
console.log(`Synced deterministic Recovery V3 developer artifact to ${committedPath}`);
