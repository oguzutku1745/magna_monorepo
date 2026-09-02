import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProofData } from "@aztec/bb.js";
import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { createUltraHonkBackend } from "./bb.js";
import {
  generateInstagramCircuitInputs,
  generateInstagramCircuitInputsFromVerifiedDkim,
  type InstagramVerifiedDkim,
} from "./inputs.js";
import { parseInstagramPublicInputs } from "./public-inputs.js";
import {
  INSTAGRAM_V2_ACIR_SHA256,
  type InstagramIssuanceContext,
  type InstagramProofInputMetadata,
  type InstagramProofPublicOutputs,
} from "./types.js";

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
  const circuit = JSON.parse(readFileSync(path, "utf8")) as CompiledCircuit;
  if (typeof circuit.bytecode !== "string" || circuit.bytecode.length === 0) {
    throw new Error("Instagram V2 circuit artifact does not contain ACIR bytecode.");
  }
  const digest = createHash("sha256").update(Buffer.from(circuit.bytecode, "base64")).digest("hex");
  if (digest !== INSTAGRAM_V2_ACIR_SHA256) {
    throw new Error(`Instagram V2 circuit ACIR hash mismatch: expected ${INSTAGRAM_V2_ACIR_SHA256}, received ${digest}.`);
  }
  return circuit;
}

export async function proveInstagramEmail(
  rawEmail: Buffer | string,
  claimedHandle: string,
  issuance: InstagramIssuanceContext,
  options: {
    circuit?: CompiledCircuit;
    verifiedDkim?: InstagramVerifiedDkim;
  } = {},
): Promise<InstagramProofArtifact> {
  const circuit = options.circuit ?? loadInstagramCircuitArtifact();
  const { inputs, metadata } = options.verifiedDkim
    ? generateInstagramCircuitInputsFromVerifiedDkim(options.verifiedDkim, claimedHandle, issuance)
    : await generateInstagramCircuitInputs(rawEmail, claimedHandle, issuance);
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
