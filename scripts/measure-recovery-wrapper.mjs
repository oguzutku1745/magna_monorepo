#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { ungzip } from "pako";

// Resolve from the standalone recovery lane, never the network/Instagram hoist.
const require = createRequire(new URL("../packages/magna-recovery-wrapper-proof/package.json", import.meta.url));
const { BackendType, Barretenberg } = require("@aztec/bb.js");

const artifactPath = resolve(
  "packages/magna-recovery-wrapper-proof/circuit-dev/bundle/magna_recovery_wrapper_proof_dev.json",
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const compressed = Uint8Array.from(atob(artifact.bytecode), character => character.charCodeAt(0));
const bytecode = ungzip(compressed);
const api = await Barretenberg.new({ backend: BackendType.Wasm, skipSrsInit: true, threads: 1 });
try {
  const [numGates, numGatesDyadic] = await api.acirGetCircuitSizes(bytecode, true, false);
  console.log(JSON.stringify({ profile: "development", numGates, numGatesDyadic }, null, 2));
  if (numGates !== 709547 || numGatesDyadic !== 1048576) {
    throw new Error(`Recovery wrapper size changed: ${numGates}/${numGatesDyadic}.`);
  }
} finally {
  await api.destroy();
}
