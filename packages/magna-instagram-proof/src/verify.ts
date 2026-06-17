import { UltraHonkBackend, type ProofData } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { loadInstagramCircuitArtifact } from "./prove.js";

export async function verifyInstagramProof(
  proof: ProofData,
  options: {
    circuit?: CompiledCircuit;
  } = {},
): Promise<boolean> {
  const circuit = options.circuit ?? loadInstagramCircuitArtifact();
  const backend = new UltraHonkBackend(circuit.bytecode);
  try {
    await backend.instantiate();
    return await backend.verifyProof(proof);
  } finally {
    await backend.destroy();
  }
}
