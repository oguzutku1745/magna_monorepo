import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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
  type PassportA2ProofProfile,
  PASSPORT_A2_DEVELOPMENT_WRAPPER_ARTIFACT_SHA256,
  PASSPORT_A2_WRAPPER_ARTIFACT_SHA256,
} from "./types.js";

export { parsePassportWrapperPublicInputs } from "./public-inputs.js";

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultPassportWrapperCircuitArtifactPath(
  profile: PassportA2ProofProfile = "production",
): string {
  return profile === "development"
    ? resolve(packageRoot(), "circuit-dev/bundle/magna_passport_wrapper_proof_dev.json")
    : resolve(packageRoot(), "circuit/bundle/magna_passport_wrapper_proof.json");
}

export function loadPassportWrapperCircuitArtifact(
  path?: string,
  profile: PassportA2ProofProfile = "production",
): CompiledCircuit {
  path ??= defaultPassportWrapperCircuitArtifactPath(profile);
  if (!existsSync(path)) {
    throw new Error(
      `Passport wrapper circuit artifact not found at ${path}. ` +
        "Run npm run -w @magna/passport-wrapper-proof compile:circuit first.",
    );
  }
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expectedDigest =
    profile === "development"
      ? PASSPORT_A2_DEVELOPMENT_WRAPPER_ARTIFACT_SHA256
      : PASSPORT_A2_WRAPPER_ARTIFACT_SHA256;
  if (digest !== expectedDigest) {
    throw new Error(`Passport A2 wrapper circuit artifact hash mismatch at ${path}.`);
  }
  return JSON.parse(bytes.toString("utf8")) as CompiledCircuit;
}

export async function provePassportWrapper(
  witness: PassportWrapperLocalWitness,
  options: {
    circuit?: CompiledCircuit;
  } = {},
): Promise<PassportWrapperProofArtifact> {
  const circuit = options.circuit ?? loadPassportWrapperCircuitArtifact(undefined, witness.profile);
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
