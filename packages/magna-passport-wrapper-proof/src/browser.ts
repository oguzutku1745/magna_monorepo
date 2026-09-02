import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { createBrowserBarretenberg } from "./browser-bb.js";
import { buildPassportWrapperInputs } from "./inputs.js";
import {
  normalizePublicFieldString,
  parsePassportWrapperPublicInputs,
} from "./public-inputs.js";
import {
  PASSPORT_A2_WRAPPER_ARTIFACT_SHA256,
  PASSPORT_A2_DEVELOPMENT_WRAPPER_ARTIFACT_SHA256,
  PASSPORT_A2_WRAPPER_SRS_SIZE,
  type PassportA2ProofProfile,
  type PassportWrapperLocalWitness,
  type PassportWrapperProofArtifact,
} from "./types.js";

const circuitArtifactUrls: Record<PassportA2ProofProfile, URL> = {
  development: new URL("../circuit-dev/bundle/magna_passport_wrapper_proof_dev.json", import.meta.url),
  production: new URL("../circuit/bundle/magna_passport_wrapper_proof.json", import.meta.url),
};

async function loadBrowserPassportWrapperCircuitArtifact(
  profile: PassportA2ProofProfile,
): Promise<CompiledCircuit> {
  const response = await fetch(circuitArtifactUrls[profile]);
  if (!response.ok) {
    throw new Error(`Could not load passport wrapper circuit artifact: ${response.status} ${response.statusText}`);
  }
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const expectedDigest =
    profile === "development"
      ? PASSPORT_A2_DEVELOPMENT_WRAPPER_ARTIFACT_SHA256
      : PASSPORT_A2_WRAPPER_ARTIFACT_SHA256;
  if (digest !== expectedDigest) {
    throw new Error("Passport A2 wrapper circuit artifact hash mismatch.");
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as CompiledCircuit;
}

export async function provePassportWrapper(
  witness: PassportWrapperLocalWitness,
  options: { circuit?: CompiledCircuit } = {},
): Promise<PassportWrapperProofArtifact> {
  const circuit = options.circuit ?? (await loadBrowserPassportWrapperCircuitArtifact(witness.profile));
  const { Barretenberg, UltraHonkBackend } = await import("@aztec/bb.js");
  const { inputs, metadata } = await buildPassportWrapperInputs(witness);
  const noir = new Noir(circuit);
  const { witness: compressedWitness } = await noir.execute(inputs);
  const api = await createBrowserBarretenberg(Barretenberg, PASSPORT_A2_WRAPPER_SRS_SIZE);
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    const proof = await backend.generateProof(compressedWitness);
    const verified = await backend.verifyProof(proof);
    if (!verified) {
      throw new Error("Generated passport wrapper proof did not verify.");
    }
    const publicInputs = proof.publicInputs.map((entry, index) =>
      normalizePublicFieldString(String(entry), `publicInputs[${index}]`),
    );
    return {
      proof,
      publicInputs,
      outputs: parsePassportWrapperPublicInputs(publicInputs),
      metadata,
    };
  } finally {
    await api.destroy();
  }
}
