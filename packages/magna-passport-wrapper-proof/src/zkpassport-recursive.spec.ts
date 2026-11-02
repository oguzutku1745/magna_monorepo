import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveZkPassportRecursiveArtifacts } from "./zkpassport-recursive.js";
import type { RegistryClientLike, ZkPassportCompressedProof } from "./types.js";

// Public official artifact, not a Passport proof or personal data.
const circuit = JSON.parse(readFileSync(new URL("../fixtures/outer-count-7-0.21.1.json", import.meta.url), "utf8"));
const currentKey = "0x29678c37af3bf4df3517cf7104286665eee0a9b6f189405c159eaa84f820f372";
function proof(version = "0.21.1"): ZkPassportCompressedProof {
  return { name: "outer_count_7", version, vkeyHash: currentKey, proof: "0".repeat(64 * (12 + 458)) };
}
function registry(version = "0.21.1", key = currentKey): RegistryClientLike {
  return {
    getCircuitManifest: async (_root, options) => {
      assert.equal(options?.validate, true);
      assert.equal(options?.version, version);
      return { version };
    },
    getPackagedCircuit: async (name, _manifest, options) => {
      assert.equal(name, "outer_count_7");
      assert.equal(options?.validate, true);
      return { vkey: circuit.vkey, vkey_hash: key };
    },
  };
}

test("resolves the official 0.21.1 key into the existing recursive witness layout", async () => {
  const result = await resolveZkPassportRecursiveArtifacts(proof(), registry());
  assert.equal(result.publicInputs.length, 12);
  assert.equal(result.proofFields.length, 458);
  assert.equal(result.vkeyFields.length, 115);
  assert.deepEqual(result.vkeyFields, Array.from({ length: 115 }, (_, index) =>
    BigInt(`0x${Buffer.from(circuit.vkey, "base64").subarray(index * 32, (index + 1) * 32).toString("hex")}`).toString(),
  ));
});

test("accepts a new version label only when its validated artifact retains the approved key", async () => {
  await resolveZkPassportRecursiveArtifacts(proof("0.21.2"), registry("0.21.2"));
});

test("rejects an unapproved proof key before contacting the registry", async () => {
  const unexpectedRegistry: RegistryClientLike = {
    getCircuitManifest: async () => { throw new Error("Registry must not be contacted"); },
    getPackagedCircuit: async () => { throw new Error("Registry must not be contacted"); },
  };
  await assert.rejects(
    resolveZkPassportRecursiveArtifacts({ ...proof(), vkeyHash: "0x1234" }, unexpectedRegistry),
    /not the pinned Passport A2 key/,
  );
});

test("rejects a registry artifact with a different key", async () => {
  await assert.rejects(resolveZkPassportRecursiveArtifacts(proof(), registry("0.21.1", "0x1234")), /registry returned/);
});

test("rejects a truncated proof before building a recursive witness", async () => {
  await assert.rejects(
    resolveZkPassportRecursiveArtifacts({ ...proof(), proof: "0".repeat(64 * (12 + 457)) }, registry()),
    /458 private proof fields/,
  );
});
