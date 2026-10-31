import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const script = readFileSync(resolve('scripts/sync-recovery-wrapper-artifact.mjs'), 'utf8');
const frozenBytes = readFileSync(resolve('packages/magna-recovery-wrapper-proof/circuit-dev/bundle/magna_recovery_wrapper_proof_dev.json'));
const reviewedMetadataHash = '4751306955926801238';
function runSync(change, check) {
  const root = mkdtempSync(join(tmpdir(), 'magna-recovery-sync-'));
  const scripts = join(root, 'scripts');
  const circuit = join(root, 'packages/magna-recovery-wrapper-proof/circuit-dev');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(circuit, 'target'), { recursive: true });
  mkdirSync(join(circuit, 'bundle'), { recursive: true });
  const artifact = JSON.parse(frozenBytes);
  change(artifact);
  writeFileSync(join(scripts, 'sync-recovery-wrapper-artifact.mjs'), script);
  writeFileSync(join(circuit, 'target/magna_recovery_wrapper_proof_dev.json'), JSON.stringify(artifact));
  const bundlePath = join(circuit, 'bundle/magna_recovery_wrapper_proof_dev.json');
  writeFileSync(bundlePath, frozenBytes);
  try {
    const result = spawnSync(process.execPath, [join(scripts, 'sync-recovery-wrapper-artifact.mjs')], { encoding: 'utf8' });
    check(result);
    assert.deepEqual(readFileSync(bundlePath), frozenBytes, 'the frozen trusted bundle must stay byte-identical');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('sync accepts the original pinned bundle', () => {
  runSync(() => {}, result => assert.equal(result.status, 0, result.stderr));
});
test('sync accepts the exact reviewed source-metadata change while preserving the frozen bundle', () => {
  runSync(artifact => { artifact.hash = reviewedMetadataHash; }, result => assert.equal(result.status, 0, result.stderr));
});
for (const [name, mutate] of [
  ['executable bytecode', artifact => { artifact.bytecode = Buffer.from('different ACIR').toString('base64'); }],
  ['witness ABI', artifact => { artifact.abi.parameters[0].visibility = 'public'; }],
  ['compiler build', artifact => { artifact.noir_version = '1.0.0-beta.22+unreviewed-build'; }],
  ['unreviewed source metadata', artifact => { artifact.hash = '123456789'; }],
]) {
  test(`sync rejects changed ${name} without modifying the trusted bundle`, () => {
    runSync(artifact => { artifact.hash = reviewedMetadataHash; mutate(artifact); }, result => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Refusing to sync/);
    });
  });
}
