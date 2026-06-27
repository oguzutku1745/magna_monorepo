import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import { buildPassportWrapperInputs } from "./inputs.js";
import {
  normalizePublicFieldString,
  parsePassportWrapperPublicInputs,
} from "./public-inputs.js";
import {
  type PassportWrapperLocalWitness,
  type PassportWrapperProofArtifact,
} from "./types.js";

export { parsePassportWrapperPublicInputs } from "./public-inputs.js";

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultPassportWrapperCircuitArtifactPath(): string {
  return resolve(packageRoot(), "circuit/target/magna_passport_wrapper_proof.json");
}

export function loadPassportWrapperCircuitArtifact(
  path = defaultPassportWrapperCircuitArtifactPath(),
): CompiledCircuit {
  if (!existsSync(path)) {
    throw new Error(
      `Passport wrapper circuit artifact not found at ${path}. ` +
        "Run npm run -w @magna/passport-wrapper-proof compile:circuit first.",
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as CompiledCircuit;
}

export async function provePassportWrapper(
  witness: PassportWrapperLocalWitness,
  options: {
    circuit?: CompiledCircuit;
  } = {},
): Promise<PassportWrapperProofArtifact> {
  const circuit = options.circuit ?? loadPassportWrapperCircuitArtifact();
  const { inputs, metadata } = await buildPassportWrapperInputs(witness);
  const noir = new Noir(circuit);
  const backend = await createUltraHonkBackend(circuit.bytecode);
  const { witness: compressedWitness } = await noir.execute(inputs);
  try {
    await backend.instantiate?.();
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
    await backend.destroy?.();
  }
}
