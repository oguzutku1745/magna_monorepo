import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  defaultPassportWrapperCircuitArtifactPath,
  loadPassportWrapperCircuitArtifact,
} from "./prove.js";
import { normalizePassportWrapperProofData } from "./verify.js";

describe("Passport A2 circuit artifact", () => {
  it("loads only the pinned eight-output bundle", () => {
    const artifact = loadPassportWrapperCircuitArtifact();
    assert.equal(artifact.abi.return_type?.visibility, "public");
    assert.equal(artifact.abi.return_type?.abi_type.kind, "array");
    if (artifact.abi.return_type?.abi_type.kind === "array") {
      assert.equal(artifact.abi.return_type.abi_type.length, 8);
    }
  });

  it("loads a separately pinned developer bundle", () => {
    const artifact = loadPassportWrapperCircuitArtifact(undefined, "development");
    assert.equal(artifact.abi.return_type?.visibility, "public");
    assert.notEqual(
      defaultPassportWrapperCircuitArtifactPath("development"),
      defaultPassportWrapperCircuitArtifactPath("production"),
    );
  });

  it("rejects a modified bundle before verification", () => {
    const directory = mkdtempSync(join(tmpdir(), "magna-a2-artifact-"));
    const path = join(directory, "wrapper.json");
    try {
      const bytes = readFileSync(defaultPassportWrapperCircuitArtifactPath());
      const modified = Buffer.from(bytes);
      modified[modified.length - 1] ^= 1;
      writeFileSync(path, modified);
      assert.throws(() => loadPassportWrapperCircuitArtifact(path), /hash mismatch/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not accept the production bundle under the developer profile", () => {
    assert.throws(
      () =>
        loadPassportWrapperCircuitArtifact(
          defaultPassportWrapperCircuitArtifactPath("production"),
          "development",
        ),
      /hash mismatch/,
    );
  });
});

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
