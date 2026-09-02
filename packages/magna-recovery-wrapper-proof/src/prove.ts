import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BackendType, Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { buildRecoveryWrapperInputs } from "./inputs.js";
import { normalizeRecoveryPublicField, parseRecoveryWrapperPublicInputs } from "./public-inputs.js";
import {
  RECOVERY_WRAPPER_ARTIFACT_SHA256,
  RECOVERY_WRAPPER_SRS_SIZE,
  type RecoveryWrapperLocalWitness,
  type RecoveryWrapperProofArtifact,
} from "./types.js";

const artifactUrl = new URL("../circuit-dev/bundle/magna_recovery_wrapper_proof_dev.json", import.meta.url);
const EVM_OPTIONS = { verifierTarget: "evm" as const };

export async function loadRecoveryWrapperCircuitArtifact(): Promise<CompiledCircuit> {
  const bytes = await readFile(artifactUrl);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== RECOVERY_WRAPPER_ARTIFACT_SHA256) {
    throw new Error("Recovery V3 wrapper artifact hash mismatch.");
  }
  return JSON.parse(bytes.toString("utf8")) as CompiledCircuit;
}

export async function proveRecoveryWrapper(
  witness: RecoveryWrapperLocalWitness,
  options: { circuit?: CompiledCircuit } = {},
): Promise<RecoveryWrapperProofArtifact> {
  const circuit = options.circuit ?? (await loadRecoveryWrapperCircuitArtifact());
  const built = await buildRecoveryWrapperInputs(witness);
  const noir = new Noir(circuit);
  const executed = await noir.execute(built.inputs);
  const api = await Barretenberg.new({
    backend: BackendType.Wasm,
    threads: 1,
    srsSize: RECOVERY_WRAPPER_SRS_SIZE,
  });
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    const proof = await backend.generateProof(executed.witness, EVM_OPTIONS);
    if (!(await backend.verifyProof(proof, EVM_OPTIONS))) {
      throw new Error("Generated Recovery V3 EVM-target wrapper proof did not verify locally.");
    }
    const publicInputs = proof.publicInputs.map((value, index) =>
      normalizeRecoveryPublicField(value, `proof.publicInputs[${index}]`),
    );
    if (JSON.stringify(publicInputs) !== JSON.stringify(built.publicInputs)) {
      throw new Error("Recovery wrapper proof public inputs differ from the independently derived values.");
    }
    return { proof, publicInputs, outputs: parseRecoveryWrapperPublicInputs(publicInputs), metadata: built.metadata };
  } finally {
    await api.destroy();
  }
}

export async function generateRecoveryWrapperSolidityVerifier(): Promise<{
  solidity: string;
  verificationKey: Uint8Array;
}> {
  const circuit = await loadRecoveryWrapperCircuitArtifact();
  const api = await Barretenberg.new({
    backend: BackendType.Wasm,
    threads: 1,
    srsSize: RECOVERY_WRAPPER_SRS_SIZE,
  });
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    const verificationKey = await backend.getVerificationKey(EVM_OPTIONS);
    const solidity = await backend.getSolidityVerifier(verificationKey, EVM_OPTIONS);
    return { solidity, verificationKey };
  } finally {
    await api.destroy();
  }
}
