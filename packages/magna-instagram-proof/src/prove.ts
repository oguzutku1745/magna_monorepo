import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProofData } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import { generateInstagramCircuitInputs } from "./inputs.js";
import type { InstagramProofInputMetadata, InstagramProofPublicOutputs } from "./types.js";

export type InstagramProofArtifact = {
  proof: ProofData;
  publicInputs: string[];
  outputs: InstagramProofPublicOutputs;
  metadata: InstagramProofInputMetadata;
};

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function defaultCircuitArtifactPath(): string {
  return resolve(packageRoot(), "circuit/target/magna_instagram_proof.json");
}

export function loadInstagramCircuitArtifact(path = defaultCircuitArtifactPath()): CompiledCircuit {
  if (!existsSync(path)) {
    throw new Error(
      `Instagram circuit artifact not found at ${path}. ` +
        "Run npm run instagram-proof:prepare from the repository root, then restart the verification API.",
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as CompiledCircuit;
}

export function parseInstagramPublicInputs(publicInputs: string[]): InstagramProofPublicOutputs {
  if (publicInputs.length < 4) {
    throw new Error("Instagram proof must expose at least four public inputs.");
  }
  return {
    dkimPubkeyHash: publicInputs[0],
    emailNullifier: publicInputs[1],
    handleLen: Number(publicInputs[2]),
    handlePacked: publicInputs[3],
  };
}

export async function proveInstagramEmail(
  rawEmail: Buffer | string,
  claimedHandle: string,
  options: {
    circuit?: CompiledCircuit;
  } = {},
): Promise<InstagramProofArtifact> {
  const circuit = options.circuit ?? loadInstagramCircuitArtifact();
  const { inputs, metadata } = await generateInstagramCircuitInputs(rawEmail, claimedHandle);
  const noir = new Noir(circuit);
  const backend = createUltraHonkBackend(circuit.bytecode);
  const { witness } = await noir.execute(inputs);
  try {
    await backend.instantiate();
    const proof = await backend.generateProof(witness);
    const verified = await backend.verifyProof(proof);
    if (!verified) {
      throw new Error("Generated Instagram proof did not verify.");
    }
    return {
      proof,
      publicInputs: proof.publicInputs.map(String),
      outputs: parseInstagramPublicInputs(proof.publicInputs.map(String)),
      metadata,
    };
  } finally {
    await backend.destroy();
  }
}
