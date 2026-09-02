import type { ProofData } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import { loadInstagramCircuitArtifact } from "./prove.js";

function normalizeProofBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) {
    return Uint8Array.from(value.map((entry, index) => {
      if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 255) {
        throw new Error(`Instagram proof byte ${index} must be an integer between 0 and 255.`);
      }
      return entry;
    }));
  }
  throw new Error("Instagram proof bytes must be a Uint8Array or byte array.");
}

export function normalizeInstagramProofData(value: unknown): ProofData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Instagram proof must be an object.");
  }
  const proof = Reflect.get(value, "proof");
  const publicInputs = Reflect.get(value, "publicInputs");
  if (!Array.isArray(publicInputs)) {
    throw new Error("Instagram proof publicInputs must be an array.");
  }
  return {
    proof: normalizeProofBytes(proof),
    publicInputs: publicInputs.map((entry, index) => {
      if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "bigint") {
        throw new Error(`Instagram proof publicInputs[${index}] must be a field string.`);
      }
      const field = BigInt(String(entry));
      return field.toString();
    }),
  };
}

export async function verifyInstagramProof(
  proof: unknown,
  options: {
    circuit?: CompiledCircuit;
  } = {},
): Promise<boolean> {
  const circuit = options.circuit ?? loadInstagramCircuitArtifact();
  const backend = createUltraHonkBackend(circuit.bytecode);
  try {
    await backend.instantiate();
    return await backend.verifyProof(normalizeInstagramProofData(proof));
  } finally {
    await backend.destroy();
  }
}
