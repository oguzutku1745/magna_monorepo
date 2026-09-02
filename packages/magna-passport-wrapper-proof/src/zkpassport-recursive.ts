import { Buffer } from "buffer";
import { RegistryClient } from "@zkpassport/registry";
import { getNumberOfPublicInputs, getProofData } from "@zkpassport/utils";
import {
  PASSPORT_A2_INNER_NAME,
  PASSPORT_A2_INNER_PROOF_FIELD_COUNT,
  PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT,
  PASSPORT_A2_INNER_VERSION,
  PASSPORT_A2_INNER_VKEY_FIELD_COUNT,
  PASSPORT_A2_INNER_VKEY_HASH,
  type RegistryClientLike,
  type ZkPassportCompressedProof,
} from "./types.js";

export type ZkPassportRecursiveArtifacts = {
  proofFields: string[];
  publicInputs: string[];
  vkeyFields: string[];
};

const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function encodedFieldToDecimal(value: string, label: string): string {
  const hex = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${label} must be an exactly 32-byte hexadecimal field.`);
  }
  const parsed = BigInt(`0x${hex}`);
  if (parsed >= FIELD_MODULUS) {
    throw new Error(`${label} is outside the Noir field modulus.`);
  }
  return parsed.toString();
}

function normalizeHash(value: string, label: string): string {
  const hex = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{1,64}$/.test(hex)) {
    throw new Error(`${label} must be a field-sized hex string.`);
  }
  return `0x${hex.toLowerCase().padStart(64, "0")}`;
}

function requirePinnedProof(proof: ZkPassportCompressedProof): void {
  if (proof.name !== PASSPORT_A2_INNER_NAME) {
    throw new Error(`Passport A2 requires ${PASSPORT_A2_INNER_NAME}; received ${proof.name}.`);
  }
  if (proof.version !== PASSPORT_A2_INNER_VERSION) {
    throw new Error(`Passport A2 requires zkPassport circuits ${PASSPORT_A2_INNER_VERSION}.`);
  }
  if (normalizeHash(proof.vkeyHash, "zkPassport vkeyHash") !== PASSPORT_A2_INNER_VKEY_HASH) {
    throw new Error("zkPassport outer proof verification key is not the pinned Passport A2 key.");
  }
  if (getNumberOfPublicInputs(proof.name) !== PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT) {
    throw new Error("zkPassport outer proof public-input layout does not match Passport A2.");
  }
}

function fieldsFromBytes(bytes: Uint8Array, expected: number, label: string): string[] {
  if (bytes.byteLength !== expected * 32) {
    throw new Error(`${label} must contain exactly ${expected} fields.`);
  }
  const fields: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 32) {
    fields.push(`0x${Buffer.from(bytes.subarray(offset, offset + 32)).toString("hex")}`);
  }
  return fields;
}

function packagedVkeyHash(packaged: { vkey_hash?: string; vkeyHash?: string }): string {
  const value = packaged.vkey_hash ?? packaged.vkeyHash;
  if (!value) {
    throw new Error("zkPassport packaged circuit is missing vkey_hash.");
  }
  return normalizeHash(value, "packaged zkPassport vkey_hash");
}

export async function resolveZkPassportRecursiveArtifacts(
  proof: ZkPassportCompressedProof,
  registryClient: RegistryClientLike = new RegistryClient({ chainId: 1 }) as RegistryClientLike,
): Promise<ZkPassportRecursiveArtifacts> {
  requirePinnedProof(proof);
  const proofHex = proof.proof.trim().replace(/^0x/i, "");
  if (!proofHex || !/^[0-9a-fA-F]+$/.test(proofHex) || proofHex.length % 64 !== 0) {
    throw new Error("zkPassport compressed proof must be a field-aligned hex string.");
  }
  const proofData = getProofData(proofHex, PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT);
  if (proofData.proof.length !== PASSPORT_A2_INNER_PROOF_FIELD_COUNT) {
    throw new Error(
      `zkPassport outer proof must contain ${PASSPORT_A2_INNER_PROOF_FIELD_COUNT} private proof fields.`,
    );
  }
  if (proofData.publicInputs.length !== PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT) {
    throw new Error("zkPassport outer proof has the wrong public-input count.");
  }

  const manifest = await registryClient.getCircuitManifest(undefined, {
    version: PASSPORT_A2_INNER_VERSION,
    validate: true,
  });
  const packaged = await registryClient.getPackagedCircuit(PASSPORT_A2_INNER_NAME, manifest, {
    validate: true,
  });
  if (packagedVkeyHash(packaged) !== PASSPORT_A2_INNER_VKEY_HASH) {
    throw new Error("zkPassport registry returned a verification key other than the pinned A2 key.");
  }
  const vkeyFields = fieldsFromBytes(
    Buffer.from(packaged.vkey, "base64"),
    PASSPORT_A2_INNER_VKEY_FIELD_COUNT,
    "zkPassport outer verification key",
  );
  return {
    // zkPassport getProofData returns private proof fields as unprefixed hex,
    // while its public inputs are 0x-prefixed. Normalize both explicitly.
    proofFields: proofData.proof.map((value, index) =>
      encodedFieldToDecimal(value, `zkPassport outer proof field ${index}`),
    ),
    publicInputs: proofData.publicInputs.map((value, index) =>
      encodedFieldToDecimal(value, `zkPassport outer public input ${index}`),
    ),
    vkeyFields: vkeyFields.map((value, index) =>
      encodedFieldToDecimal(value, `zkPassport outer verification-key field ${index}`),
    ),
  };
}
