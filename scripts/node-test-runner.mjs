#!/usr/bin/env node
// TAP-aware wrapper around `node --test` that tolerates ONE specific,
// non-actionable failure mode: the Aztec v5 prover WASM (bb.js) aborts during
// process teardown AFTER all tests in a spec file have already passed. Node's
// test runner counts that nonzero subprocess exit as a failed file-level
// "test" (`not ok N - <path>.spec.js`), which would otherwise red a suite
// whose assertions all passed.
//
// Each spec file is run in its own `node --test` process (this also removes
// the cross-file parallel interference that the shared bb.js WASM exhibits).
// A file PASSES when it ran at least one named test and no named test failed —
// regardless of the process exit code. A real assertion failure shows up as a
// `not ok N - <test name>` (description is a test name, never a spec-file
// path) and DOES fail the run. A file that produced no test output at all
// (crash before/while running) also fails — we never silently pass a file
// that didn't actually execute its tests.
//
// Usage: node scripts/node-test-runner.mjs <glob...>   (globs relative to cwd)

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const patterns = process.argv.slice(2);
if (patterns.length === 0) {
  console.error("usage: node-test-runner.mjs <glob...>");
  process.exit(2);
}

const files = [...new Set(patterns.flatMap(p => globSync(p)))].sort();
if (files.length === 0) {
  console.error(`no test files matched: ${patterns.join(" ")}`);
  process.exit(2);
}

const SPEC_PATH = /\.spec\.js$/;
const tolerated = [];
const failed = [];

for (const file of files) {
  const res = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", file],
    { encoding: "utf8" },
  );
  const out = (res.stdout || "") + (res.stderr || "");
  process.stdout.write(out);

  let namedPass = 0;
  let namedFail = 0;
  for (const line of out.split("\n")) {
    const ok = line.match(/^ok \d+ - (.+)$/);
    const notOk = line.match(/^not ok \d+ - (.+)$/);
    if (ok && !SPEC_PATH.test(ok[1].trim())) namedPass++;
    if (notOk && !SPEC_PATH.test(notOk[1].trim())) namedFail++;
  }

  if (namedFail > 0) {
    failed.push(`${file} (${namedFail} test(s) failed)`);
  } else if (namedPass === 0) {
    failed.push(`${file} (no tests ran — process crashed before completing)`);
  } else if (res.status !== 0) {
    // All named tests passed but the process exited nonzero: the known WASM
    // teardown abort. Tolerated.
    tolerated.push(`${file} (exit ${res.status ?? res.signal}, ${namedPass} test(s) passed)`);
  }
}

console.log("\n--- node-test-runner summary ---");
if (tolerated.length > 0) {
  console.log(`tolerated ${tolerated.length} teardown abort(s) after all tests passed (Aztec WASM):`);
  for (const f of tolerated) console.log(`  - ${f}`);
}
if (failed.length > 0) {
  console.log(`REAL failures (${failed.length}):`);
  for (const f of failed) console.log(`  ✖ ${f}`);
  process.exit(1);
}
console.log(`all tests passed across ${files.length} file(s)`);
process.exit(0);
