import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProofData } from "@aztec/bb.js";
import { MAGNA_RECOVERY_V3_SCHEMA } from "@magna/recovery-v3/protocol";
import { serializeRecoveryProofForEvm } from "./evm.js";
import { parseRecoveryWrapperPublicInputs } from "./public-inputs.js";

const publicInputs = [
  MAGNA_RECOVERY_V3_SCHEMA.toString(),
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
] as const;

describe("Recovery V3 wrapper public boundary", () => {
  it("parses exactly the seven schema-bound public fields", () => {
    assert.deepEqual(parseRecoveryWrapperPublicInputs(publicInputs), {
      schema: MAGNA_RECOVERY_V3_SCHEMA.toString(),
      authorization: "2",
      messageSecretHash: "3",
      proofCurrentDate: "4",
      certificateRegistryRoot: "5",
      circuitRegistryRoot: "6",
      trustContext: "7",
    });
    assert.throws(() => parseRecoveryWrapperPublicInputs(publicInputs.slice(0, 6)), /exactly 7/);
    assert.throws(
      () => parseRecoveryWrapperPublicInputs(["0", ...publicInputs.slice(1)]),
      /wrong V3 schema/,
    );
  });

  it("serializes a field-aligned proof and all public inputs for the EVM verifier", () => {
    const proof = {
      proof: Uint8Array.from({ length: 32 }, (_, index) => index),
      publicInputs: [...publicInputs],
    } as ProofData;
    const serialized = serializeRecoveryProofForEvm(proof);
    assert.equal(serialized.wrapperProof.length, 2 + 64);
    assert.equal(serialized.publicInputs.length, 7);
    assert.equal(serialized.publicInputs[0], `0x${MAGNA_RECOVERY_V3_SCHEMA.toString(16).padStart(64, "0")}`);
    assert.equal(serialized.publicInputs[6], `0x${"7".padStart(64, "0")}`);
  });

  it("rejects empty, non-field-aligned, or malformed proof statements", () => {
    for (const proofBytes of [new Uint8Array(), new Uint8Array(31)]) {
      assert.throws(
        () => serializeRecoveryProofForEvm({ proof: proofBytes, publicInputs: [...publicInputs] } as ProofData),
        /non-empty field-aligned/,
      );
    }
    assert.throws(
      () =>
        serializeRecoveryProofForEvm({
          proof: new Uint8Array(32),
          publicInputs: ["not-a-field", ...publicInputs.slice(1)],
        } as ProofData),
      /decimal or 0x-prefixed field string/,
    );
  });
});
