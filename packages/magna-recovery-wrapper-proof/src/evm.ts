import type { ProofData } from "@aztec/bb.js";
import { parseRecoveryWrapperPublicInputs } from "./public-inputs.js";

export type Hex = `0x${string}`;

function bytes32(value: string, label: string): Hex {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= (1n << 256n)) throw new Error(`${label} does not fit bytes32.`);
  return `0x${parsed.toString(16).padStart(64, "0")}`;
}

export function serializeRecoveryProofForEvm(proof: ProofData): {
  wrapperProof: Hex;
  publicInputs: readonly [Hex, Hex, Hex, Hex, Hex, Hex, Hex];
} {
  if (proof.proof.byteLength === 0 || proof.proof.byteLength % 32 !== 0) {
    throw new Error("Recovery wrapper proof must be a non-empty field-aligned byte array.");
  }
  parseRecoveryWrapperPublicInputs(proof.publicInputs);
  const proofHex = `0x${Array.from(proof.proof, byte => byte.toString(16).padStart(2, "0")).join("")}` as Hex;
  const values = proof.publicInputs.map((value, index) => bytes32(value, `publicInputs[${index}]`));
  return {
    wrapperProof: proofHex,
    publicInputs: values as [Hex, Hex, Hex, Hex, Hex, Hex, Hex],
  };
}
