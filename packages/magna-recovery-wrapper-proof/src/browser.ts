import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { createBrowserBarretenberg } from "@magna/passport-wrapper-proof/browser-bb";
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

async function loadBrowserArtifact(): Promise<CompiledCircuit> {
  const response = await fetch(artifactUrl);
  if (!response.ok) throw new Error(`Could not load Recovery V3 wrapper artifact: ${response.status}.`);
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== RECOVERY_WRAPPER_ARTIFACT_SHA256) throw new Error("Recovery V3 wrapper artifact hash mismatch.");
  return JSON.parse(new TextDecoder().decode(bytes)) as CompiledCircuit;
}

export async function proveRecoveryWrapperInBrowser(
  witness: RecoveryWrapperLocalWitness,
  options: { circuit?: CompiledCircuit } = {},
): Promise<RecoveryWrapperProofArtifact> {
  const circuit = options.circuit ?? (await loadBrowserArtifact());
  const { Barretenberg, UltraHonkBackend } = await import("@aztec/bb.js");
  const built = await buildRecoveryWrapperInputs(witness);
  const executed = await new Noir(circuit).execute(built.inputs);
  const api = await createBrowserBarretenberg(Barretenberg, RECOVERY_WRAPPER_SRS_SIZE);
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    const proof = await backend.generateProof(executed.witness, EVM_OPTIONS);
    if (!(await backend.verifyProof(proof, EVM_OPTIONS))) {
      throw new Error("Generated Recovery V3 EVM-target proof did not verify locally.");
    }
    const publicInputs = proof.publicInputs.map((value, index) =>
      normalizeRecoveryPublicField(value, `proof.publicInputs[${index}]`),
    );
    if (JSON.stringify(publicInputs) !== JSON.stringify(built.publicInputs)) {
      throw new Error("Recovery proof public inputs differ from independently derived values.");
    }
    return { proof, publicInputs, outputs: parseRecoveryWrapperPublicInputs(publicInputs), metadata: built.metadata };
  } finally {
    await api.destroy();
  }
}

/** Proves that a deliberately mutated live witness cannot produce a valid
 * wrapper proof. Most mutations fail while deriving/building the witness. An
 * inner-proof mutation can still produce an ACVM witness because recursive
 * proof validity is enforced by Barretenberg's proving constraints, so Noir
 * execution alone is not evidence of acceptance or rejection. */
export async function assertRecoveryWrapperWitnessRejectedInBrowser(
  witness: RecoveryWrapperLocalWitness,
): Promise<void> {
  // Load and hash-check the circuit outside the rejection boundary. A missing
  // artifact, browser failure, or download problem is an infrastructure error,
  // never evidence that a malicious witness was rejected.
  const circuit = await loadBrowserArtifact();
  let executedWitness: Uint8Array;
  try {
    const built = await buildRecoveryWrapperInputs(witness);
    executedWitness = (await new Noir(circuit).execute(built.inputs)).witness;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cryptographicRejection = [
      /authenticated zkPassport/i,
      /does not match/i,
      /not bound/i,
      /vkey/i,
      /verification/i,
      /invalid.*proof/i,
      /decompress/i,
      /constraint/i,
      /assert/i,
      /failed.*circuit/i,
    ].some(pattern => pattern.test(message));
    if (cryptographicRejection) return;
    throw new Error(`Recovery mutation check had an infrastructure failure: ${message}`);
  }

  const { Barretenberg, UltraHonkBackend } = await import("@aztec/bb.js");
  const api = await createBrowserBarretenberg(Barretenberg, RECOVERY_WRAPPER_SRS_SIZE);
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    let mutatedProof: Awaited<ReturnType<typeof backend.generateProof>>;
    try {
      mutatedProof = await backend.generateProof(executedWitness, EVM_OPTIONS);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unsatisfiedProofConstraint = [
        /constraint/i,
        /recursive/i,
        /proof.*fail/i,
        /verification/i,
        /sumcheck/i,
        /relation/i,
        /assert/i,
      ].some(pattern => pattern.test(message));
      if (unsatisfiedProofConstraint) return;
      throw new Error(`Recovery mutation proving check had an infrastructure failure: ${message}`);
    }
    if (!(await backend.verifyProof(mutatedProof, EVM_OPTIONS))) return;
  } finally {
    await api.destroy();
  }
  throw new Error("Mutated Recovery V3 witness produced a valid wrapper proof.");
}
