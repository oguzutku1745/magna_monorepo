import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/compile-standalone-circuit.mjs');
function compilerFixture(version, run) {
  const dir = mkdtempSync(join(tmpdir(), 'magna-compiler-'));
  const compiler = join(dir, 'nargo');
  const output = join(dir, 'args');
  writeFileSync(compiler, `#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo 'nargo version = ${version}'\nelse\n  printf '%s\\n' "$@" > '${output}'\nfi\n`, { mode: 0o755 });
  try { run(compiler, output); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('standalone wrapper rejects the V6 compiler before compiling', () => {
  compilerFixture('1.0.0-rc.3', (compiler, output) => {
    const result = spawnSync(process.execPath, [script, 'circuit'], { env: { ...process.env, AZTEC_NARGO_BIN: compiler }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires nargo 1\.0\.0-beta\.22/);
    assert.equal(existsSync(output), false, "wrong compiler must not compile");
  });
});
test('standalone wrapper accepts beta.22 and forwards the circuit directory', () => {
  compilerFixture('1.0.0-beta.22', (compiler, output) => {
    const result = spawnSync(process.execPath, [script, 'circuit-dev'], { env: { ...process.env, AZTEC_NARGO_BIN: compiler }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(output, 'utf8').trim().split('\n'), ['compile', '--program-dir', 'circuit-dev']);
  });
});

test('pure network Noir tests select the pinned V6 binary over the global compiler', () => {
  const dir = mkdtempSync(join(tmpdir(), 'magna-network-compiler-'));
  const bin = join(dir, 'versions/6.0.0/bin');
  const output = join(dir, 'args');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'aztec-nargo'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${output}'\n`, { mode: 0o755 });
  try {
    const result = spawnSync(process.execPath, [resolve('scripts/aztec-tooling.mjs'), 'test-pure', '.'], {
      env: { ...process.env, AZTEC_HOME: dir, AZTEC_VERSION_PIN: '6.0.0' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), 'test\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
