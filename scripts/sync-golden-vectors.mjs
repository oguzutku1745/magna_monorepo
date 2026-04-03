#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_PATH = resolve(ROOT, "vectors/golden-vectors.json");
const TS_OUT_PATH = resolve(ROOT, "packages/magna-client/src/generated-golden-vectors.ts");
const NOIR_OUT_PATH = resolve(ROOT, "contracts/magna-issuer/src/test/generated_golden_vectors.nr");

function parseVectorJson() {
  const raw = readFileSync(SOURCE_PATH, "utf8");
  const data = JSON.parse(raw);

  const required = [
    "version",
    "domainSeparators",
    "inputs",
    "outputs",
  ];
  for (const key of required) {
    if (!(key in data)) {
      throw new Error(`missing ${key} in ${SOURCE_PATH}`);
    }
  }
  return data;
}

function normalizeHex(value) {
  return value.toLowerCase().startsWith("0x") ? value.toLowerCase() : `0x${value.toLowerCase()}`;
}

function toBigIntLiteral(value) {
  return `${BigInt(value)}n`;
}

function renderTsFile(data) {
  const dsClaims = normalizeHex(data.domainSeparators.claims);
  const dsRevocation = normalizeHex(data.domainSeparators.revocation);
  const dsGhost = normalizeHex(data.domainSeparators.ghost);

  const schemaVersion = Number(data.inputs.schemaVersion);
  const credentialType = Number(data.inputs.credentialType);
  const minAgeProven = Number(data.inputs.minAgeProven);

  return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: vectors/golden-vectors.json

export const GOLDEN_VECTOR_VERSION = "${data.version}" as const;

export const GOLDEN_DS = {
  claims: ${toBigIntLiteral(dsClaims)},
  revocation: ${toBigIntLiteral(dsRevocation)},
  ghost: ${toBigIntLiteral(dsGhost)},
} as const;

export const GOLDEN_INPUTS = {
  schemaVersion: ${schemaVersion},
  credentialType: ${credentialType},
  nationalityAlpha3: "${data.inputs.nationalityAlpha3}",
  minAgeProven: ${minAgeProven},
  expiryTs: ${toBigIntLiteral(data.inputs.expiryTs)},
  revocationSecret: ${toBigIntLiteral(data.inputs.revocationSecret)},
  uniqueIdentifierField: ${toBigIntLiteral(data.inputs.uniqueIdentifierField)},
} as const;

export const GOLDEN_OUTPUTS = {
  claimsHash: ${toBigIntLiteral(data.outputs.claimsHash)},
  revocationNullifier: ${toBigIntLiteral(data.outputs.revocationNullifier)},
  ghostSeed: ${toBigIntLiteral(data.outputs.ghostSeed)},
} as const;
`;
}

function renderNoirFile(data) {
  const uniqueIdentifier = data.inputs.uniqueIdentifierField;
  return `// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: vectors/golden-vectors.json

pub global GOLDEN_CLAIMS_HASH: Field = ${data.outputs.claimsHash};
pub global GOLDEN_REVOCATION_NULLIFIER: Field = ${data.outputs.revocationNullifier};
pub global GOLDEN_GHOST_SEED: Field = ${data.outputs.ghostSeed};
pub global GOLDEN_REVOCATION_SECRET: Field = ${data.inputs.revocationSecret};
pub global GOLDEN_UNIQUE_IDENTIFIER: Field = ${uniqueIdentifier};
`;
}

function writeFileWithParents(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

const vectors = parseVectorJson();
writeFileWithParents(TS_OUT_PATH, renderTsFile(vectors));
writeFileWithParents(NOIR_OUT_PATH, renderNoirFile(vectors));

process.stdout.write("Golden vectors synced to TS and Noir targets.\n");
