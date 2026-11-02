import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { verifyPassportWrapperProof } from "./verify.js";

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
