import type { ProofData } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import { loadPassportWrapperCircuitArtifact } from "./prove.js";
import type { PassportA2ProofProfile } from "./types.js";

function requireProofRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Passport wrapper proof must be an object.");
  }
  return value as Record<string, unknown>;
}

function byteFromUnknown(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${fieldName} must contain byte values between 0 and 255.`);
  }
  return value;
}

function bytesFromArray(value: readonly unknown[], fieldName: string): Uint8Array {
  return Uint8Array.from(value.map((entry, index) => byteFromUnknown(entry, `${fieldName}[${index}]`)));
}

function bytesFromNumericRecord(value: Record<string, unknown>, fieldName: string): Uint8Array | undefined {
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.every(key => /^\d+$/.test(key))) {
    return undefined;
  }
  const sorted = keys.map(Number).sort((a, b) => a - b);
  if (sorted.some((key, index) => key !== index)) {
    throw new Error(`${fieldName} numeric byte keys must be contiguous from 0.`);
  }
  return Uint8Array.from(sorted.map(key => byteFromUnknown(value[String(key)], `${fieldName}.${key}`)));
}

function bytesFromHex(value: string, fieldName: string): Uint8Array {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${fieldName} must be an even-length hex string.`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function normalizeProofBytes(value: unknown, fieldName: string): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    return bytesFromHex(value, fieldName);
  }
  if (Array.isArray(value)) {
    return bytesFromArray(value, fieldName);
  }
  if (value && typeof value === "object") {
    const bytes = bytesFromNumericRecord(value as Record<string, unknown>, fieldName);
    if (bytes) {
      return bytes;
    }
  }
  throw new Error(`${fieldName} must be a Uint8Array, hex string, byte array, or numeric byte record.`);
}

function normalizePublicInputs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Passport wrapper proof publicInputs must be an array.");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "bigint") {
      throw new Error(`Passport wrapper proof publicInputs[${index}] must be a field string.`);
    }
    const raw = String(entry).trim();
    if (!raw) {
      throw new Error(`Passport wrapper proof publicInputs[${index}] must not be empty.`);
    }
    try {
      BigInt(raw);
    } catch {
      throw new Error(`Passport wrapper proof publicInputs[${index}] must be a decimal or 0x-prefixed field string.`);
    }
    return raw;
  });
}

export function normalizePassportWrapperProofData(proof: unknown): ProofData {
  const record = requireProofRecord(proof);
  return {
    proof: normalizeProofBytes(record.proof, "Passport wrapper proof bytes"),
    publicInputs: normalizePublicInputs(record.publicInputs),
  };
}

export async function verifyPassportWrapperProof(
  proof: unknown,
  options: {
    circuit?: CompiledCircuit;
    profile?: PassportA2ProofProfile;
  } = {},
): Promise<boolean> {
  const circuit =
    options.circuit ?? loadPassportWrapperCircuitArtifact(undefined, options.profile ?? "production");
  const proofData = normalizePassportWrapperProofData(proof);
  const backend = await createUltraHonkBackend(circuit.bytecode);
  try {
    await backend.instantiate?.();
    return await backend.verifyProof(proofData);
  } finally {
    await backend.destroy?.();
  }
}
