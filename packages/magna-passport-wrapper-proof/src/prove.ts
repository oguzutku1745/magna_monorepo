import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import { buildPassportWrapperInputs } from "./inputs.js";
import {
  PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT,
  type PassportWrapperLocalWitness,
  type PassportWrapperProofArtifact,
  type PassportWrapperPublicOutputs,
  type Task2UnverifiedOuterProofOptions,
} from "./types.js";

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function assertTask2Mode(options: Task2UnverifiedOuterProofOptions): void {
  if (!options.allowUnverifiedOuterProofForTask2) {
    throw new Error(
      "Passport wrapper proving is blocked until Task 3 wires recursive zkPassport outer proof verification. " +
        "Pass allowUnverifiedOuterProofForTask2 only for Task 2 constraint-only development tests.",
    );
  }
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

export function parsePassportWrapperPublicInputs(
  publicInputs: readonly string[],
): PassportWrapperPublicOutputs {
  if (publicInputs.length !== PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT) {
    throw new Error(
      `Passport wrapper proof must expose exactly ${PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT} public inputs.`,
    );
  }
  return {
    claimsHash: publicInputs[0],
    nationalityCommitment: publicInputs[1],
    expiryCommitment: publicInputs[2],
    minAgeProven: Number(publicInputs[3]),
    credentialValidUntil: publicInputs[4],
    scopedNullifier: publicInputs[5],
  };
}

export async function provePassportWrapper(
  witness: PassportWrapperLocalWitness,
  options: Task2UnverifiedOuterProofOptions & {
    circuit?: CompiledCircuit;
  } = {},
): Promise<PassportWrapperProofArtifact> {
  assertTask2Mode(options);

  const circuit = options.circuit ?? loadPassportWrapperCircuitArtifact();
  const { inputs, metadata } = await buildPassportWrapperInputs(witness);
  const noir = new Noir(circuit);
  const backend = createUltraHonkBackend(circuit.bytecode);
  const { witness: compressedWitness } = await noir.execute(inputs);
  try {
    await backend.instantiate();
    const proof = await backend.generateProof(compressedWitness);
    const verified = await backend.verifyProof(proof);
    if (!verified) {
      throw new Error("Generated passport wrapper proof did not verify.");
    }
    const publicInputs = proof.publicInputs.map(String);
    return {
      proof,
      publicInputs,
      outputs: parsePassportWrapperPublicInputs(publicInputs),
      metadata,
    };
  } finally {
    await backend.destroy();
  }
}
