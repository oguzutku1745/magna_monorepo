import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { normalizePassportWrapperProofData } from "./verify.js";

describe("normalizePassportWrapperProofData", () => {
  it("accepts hex proof bytes from JSON requests", () => {
    const proof = normalizePassportWrapperProofData({
      proof: "0x000102ff",
      publicInputs: ["0x01", "2"],
    });

    assert.deepEqual(Array.from(proof.proof), [0, 1, 2, 255]);
    assert.deepEqual(proof.publicInputs, ["0x01", "2"]);
  });

  it("accepts legacy JSON numeric-key byte records", () => {
    const proof = normalizePassportWrapperProofData({
      proof: { 0: 0, 1: 1, 2: 2, 3: 255 },
      publicInputs: ["1"],
    });

    assert.deepEqual(Array.from(proof.proof), [0, 1, 2, 255]);
  });

  it("rejects malformed byte records", () => {
    assert.throws(
      () =>
        normalizePassportWrapperProofData({
          proof: { 0: 0, 2: 2 },
          publicInputs: ["1"],
        }),
      /contiguous/,
    );
    assert.throws(
      () =>
        normalizePassportWrapperProofData({
          proof: [0, 256],
          publicInputs: ["1"],
        }),
      /byte values/,
    );
  });
});
