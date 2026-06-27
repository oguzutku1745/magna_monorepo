import type { ProofData } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import { loadPassportWrapperCircuitArtifact } from "./prove.js";

export async function verifyPassportWrapperProof(
  proof: ProofData,
  options: {
    circuit?: CompiledCircuit;
  } = {},
): Promise<boolean> {
  const circuit = options.circuit ?? loadPassportWrapperCircuitArtifact();
  const backend = await createUltraHonkBackend(circuit.bytecode);
  try {
    await backend.instantiate?.();
    return await backend.verifyProof(proof);
  } finally {
    await backend.destroy?.();
  }
}
