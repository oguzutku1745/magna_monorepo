import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

function fixture(t, { workspace = false, clientVersion = '0.3.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'magna-reference-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, 'apps/reference-dapp');
  mkdirSync(app, { recursive: true });
  cpSync(resolve('apps/reference-dapp/check-sdk.mjs'), join(app, 'check-sdk.mjs'));
  for (const [name, version] of [['core', '0.1.1'], ['client', clientVersion]]) {
    const installed = join(root, 'node_modules/@magna-protocol', name);
    const directory = workspace ? join(root, 'packages', `magna-${name}`) : installed;
    mkdirSync(join(directory, 'dist'), { recursive: true });
    writeFileSync(join(directory, 'dist/index.js'), 'export {};');
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: `@magna-protocol/${name}`, version, main: 'dist/index.js',
      dependencies: name === 'client' ? { '@magna-protocol/core': '0.1.1', '@aztec-labs/aztec.js': '6.0.0' } : {},
    }));
    if (workspace) {
      mkdirSync(join(root, 'node_modules/@magna-protocol'), { recursive: true });
      symlinkSync(directory, installed);
    }
  }
  return args => execFileSync(process.execPath, [join(app, 'check-sdk.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' });
}

test('repository reference accepts the workspace V6 SDK only with explicit workspace mode', t => {
  const run = fixture(t, { workspace: true });
  assert.match(run(['--workspace']), /client@0\.3\.0/);
  assert.throws(() => run([]), /resolved to a workspace/);
});

test('strict SDK consumer accepts a real installed V6 release', t => {
  const run = fixture(t);
  assert.match(run([]), /client@0\.3\.0/);
});

test('reference checker rejects the published V5 SDK in either mode', t => {
  assert.throws(() => fixture(t, { clientVersion: '0.2.1' })([]), /0\.3\.0/);
  assert.throws(() => fixture(t, { workspace: true, clientVersion: '0.2.1' })(['--workspace']), /0\.3\.0/);
});
