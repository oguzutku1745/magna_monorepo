import type { ProofData } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import { loadPassportWrapperCircuitArtifact } from "./prove.js";
import type { Task2UnverifiedOuterProofOptions } from "./types.js";

function assertTask2Mode(options: Task2UnverifiedOuterProofOptions): void {
  if (!options.allowUnverifiedOuterProofForTask2) {
    throw new Error(
      "Passport wrapper verification is blocked until Task 3 wires recursive zkPassport outer proof verification. " +
        "Pass allowUnverifiedOuterProofForTask2 only to verify the Task 2 constraint-only wrapper proof.",
    );
  }
}

export async function verifyPassportWrapperProof(
  proof: ProofData,
  options: Task2UnverifiedOuterProofOptions & {
    circuit?: CompiledCircuit;
  } = {},
): Promise<boolean> {
  assertTask2Mode(options);

  const circuit = options.circuit ?? loadPassportWrapperCircuitArtifact();
  const backend = createUltraHonkBackend(circuit.bytecode);
  try {
    await backend.instantiate();
    return await backend.verifyProof(proof);
  } finally {
    await backend.destroy();
  }
}
