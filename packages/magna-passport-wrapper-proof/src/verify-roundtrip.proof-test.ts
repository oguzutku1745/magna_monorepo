import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { normalizePassportWrapperProofData, verifyPassportWrapperProof } from "./verify.js";

const circuit = JSON.parse(readFileSync(
  new URL("../fixtures/public-input-roundtrip/circuit.json", import.meta.url), "utf8",
)) as CompiledCircuit;
const payload = JSON.parse(readFileSync(
  new URL("../fixtures/public-input-roundtrip/proof.json", import.meta.url), "utf8",
));

test("API verifies the browser BB5 proof after decimal JSON transport", async () => {
  assert.deepEqual(payload.publicInputs, ["1234", "18", "1900000000", "20", "30", "40", "50", "60"]);
  assert.equal(await verifyPassportWrapperProof(payload, { circuit }), true);
  const tampered = { ...payload, publicInputs: ["1235", ...payload.publicInputs.slice(1)] };
  assert.equal(await verifyPassportWrapperProof(tampered, { circuit }), false);
});

test("SDK-style BB5 verification accepts the existing proof and rejects changed claims", async () => {
  const require = createRequire(import.meta.url);
  const { BackendType, Barretenberg, UltraHonkBackend, UltraHonkVerifierBackend } =
    require("@aztec/bb.js") as typeof import("@aztec/bb.js");
  const api = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1, srsSize: 2 ** 20 });
  try {
    const verificationKey = await new UltraHonkBackend(circuit.bytecode, api).getVerificationKey();
    const proof = { ...normalizePassportWrapperProofData(payload), verificationKey };
    const verifier = new UltraHonkVerifierBackend(api);
    assert.equal(await verifier.verifyProof(proof), true);
    assert.equal(await verifier.verifyProof({
      ...proof, publicInputs: ["1235", ...proof.publicInputs.slice(1)],
    }), false);
  } finally {
    await api.destroy();
  }
});

const networkBinary = "/usr/src/labs-aztec-toolchain/bin/bb-avm";
test("Aztec V6's BB6 binary override cannot affect standalone Passport verification", {
  skip: !existsSync(networkBinary), // The pinned Docker image supplies the network binary.
}, async () => {
  assert.equal(execFileSync(networkBinary, ["--version"], { encoding: "utf8" }).trim(), "6.0.0");
  const previous = process.env.BB_BINARY_PATH;
  process.env.BB_BINARY_PATH = networkBinary;
  try {
    assert.equal(await verifyPassportWrapperProof(payload, { circuit }), true);
  } finally {
    if (previous === undefined) delete process.env.BB_BINARY_PATH;
    else process.env.BB_BINARY_PATH = previous;
  }
});
