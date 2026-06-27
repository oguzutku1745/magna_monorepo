import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { buildPassportWrapperInputs } from "./inputs.js";
import {
  normalizePublicFieldString,
  parsePassportWrapperPublicInputs,
} from "./public-inputs.js";
import type { PassportWrapperLocalWitness, PassportWrapperProofArtifact } from "./types.js";

const circuitArtifactUrl = new URL("../circuit/target/magna_passport_wrapper_proof.json", import.meta.url);

async function loadBrowserPassportWrapperCircuitArtifact(): Promise<CompiledCircuit> {
  const response = await fetch(circuitArtifactUrl);
  if (!response.ok) {
    throw new Error(`Could not load passport wrapper circuit artifact: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as CompiledCircuit;
}

export async function provePassportWrapper(
  witness: PassportWrapperLocalWitness,
  options: { circuit?: CompiledCircuit } = {},
): Promise<PassportWrapperProofArtifact> {
  const circuit = options.circuit ?? (await loadBrowserPassportWrapperCircuitArtifact());
  const { Barretenberg, UltraHonkBackend } = await import("@aztec/bb.js");
  const { inputs, metadata } = await buildPassportWrapperInputs(witness);
  const noir = new Noir(circuit);
  const { witness: compressedWitness } = await noir.execute(inputs);
  const api = await Barretenberg.new({ threads: 1 });
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
