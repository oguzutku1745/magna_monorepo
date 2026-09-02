import type { ProofData } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { Buffer } from "buffer";
import { generateInstagramCircuitInputs } from "./inputs.js";
import { parseInstagramPublicInputs } from "./public-inputs.js";
import {
  INSTAGRAM_V2_ACIR_SHA256,
  type InstagramIssuanceContext,
  type InstagramProofInputMetadata,
  type InstagramProofPublicOutputs,
} from "./types.js";

export { INSTAGRAM_V2_SCHEMA, INSTAGRAM_V2_VALIDITY_SECONDS } from "./types.js";

export type InstagramBrowserProofArtifact = {
  proof: ProofData;
  publicInputs: string[];
  outputs: InstagramProofPublicOutputs;
  metadata: InstagramProofInputMetadata;
};

const circuitArtifactUrl = new URL("../circuit/target/magna_instagram_proof.json", import.meta.url);

async function sha256Base64Bytecode(bytecode: string): Promise<string> {
  const binary = atob(bytecode);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function loadBrowserInstagramCircuitArtifact(): Promise<CompiledCircuit> {
  const response = await fetch(circuitArtifactUrl);
  if (!response.ok) {
    throw new Error(`Could not load Instagram V2 circuit artifact: ${response.status} ${response.statusText}`);
  }
  const circuit = (await response.json()) as CompiledCircuit;
  if (typeof circuit.bytecode !== "string" || circuit.bytecode.length === 0) {
    throw new Error("Instagram V2 circuit artifact does not contain ACIR bytecode.");
  }
  const digest = await sha256Base64Bytecode(circuit.bytecode);
  if (digest !== INSTAGRAM_V2_ACIR_SHA256) {
    throw new Error(`Instagram V2 circuit ACIR hash mismatch: expected ${INSTAGRAM_V2_ACIR_SHA256}, received ${digest}.`);
  }
  return circuit;
}

export async function proveInstagramEmailInBrowser(
  rawEmail: Uint8Array | string,
  claimedHandle: string,
  issuance: InstagramIssuanceContext,
  options: { circuit?: CompiledCircuit } = {},
): Promise<InstagramBrowserProofArtifact> {
  const circuit = options.circuit ?? (await loadBrowserInstagramCircuitArtifact());
  const { inputs, metadata } = await generateInstagramCircuitInputs(
    typeof rawEmail === "string" ? rawEmail : Buffer.from(rawEmail),
    claimedHandle,
    issuance,
  );
  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs);
  const { UltraHonkBackend } = await import("@aztec/bb.js");
  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
  try {
    const proof = await backend.generateProof(witness);
    if (!(await backend.verifyProof(proof))) {
      throw new Error("Generated Instagram V2 proof did not verify in the browser.");
    }
    const publicInputs = proof.publicInputs.map(String);
    return {
      proof,
      publicInputs,
      outputs: parseInstagramPublicInputs(publicInputs),
      metadata,
    };
  } finally {
    await backend.destroy();
  }
}
