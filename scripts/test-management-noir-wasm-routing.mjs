#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveNoirWasmDevAsset } from "../apps/magna-management/vite.config.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const instagramNoircAbi = resolve(repoRoot, "node_modules/@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm");
const aztecNoircAbi = resolve(repoRoot, "node_modules/@aztec/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm");
const nestedPassportNoircAbi = resolve(
  repoRoot,
  "packages/magna-passport-wrapper-proof/node_modules/@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm",
);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

assert.equal(
  resolveNoirWasmDevAsset("/node_modules/@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?v=1"),
  instagramNoircAbi,
);
assert.notEqual(sha256(instagramNoircAbi), sha256(aztecNoircAbi));
assert.equal(
  resolveNoirWasmDevAsset("/node_modules/@aztec/noir-noirc_abi/web/noirc_abi_wasm_bg.wasm"),
  aztecNoircAbi,
);
assert.equal(resolveNoirWasmDevAsset(`/@fs/${nestedPassportNoircAbi.slice(1)}`), nestedPassportNoircAbi);
assert.equal(resolveNoirWasmDevAsset("/tmp/noirc_abi_wasm_bg.wasm"), undefined);

console.info("[management-wasm-routing] exact Noir/Aztec WASM paths confirmed");
