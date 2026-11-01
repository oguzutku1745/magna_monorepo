#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lanes = [
  ['operations', '.', [['viem', '2.57.1']]],
  ['e2e', 'packages/e2e-tests', [['viem', '2.57.1']]],
  ['network', 'packages/magna-wallet', [['@aztec-labs/aztec.js', '6.0.0'], ['@aztec-foundation/bb.js', '6.0.0'], ['viem', '2.57.1']]],
  ['passport', 'packages/magna-passport-wrapper-proof', [['@aztec/bb.js', '5.0.0'], ['@noir-lang/noir_js', '1.0.0-beta.22'], ['@noir-lang/acvm_js', '1.0.0-beta.22'], ['@noir-lang/types', '1.0.0-beta.22']]],
  ['recovery', 'packages/magna-recovery-wrapper-proof', [['@aztec/bb.js', '5.0.0'], ['@noir-lang/noir_js', '1.0.0-beta.22'], ['@noir-lang/acvm_js', '1.0.0-beta.22'], ['@noir-lang/types', '1.0.0-beta.22']]],
  ['instagram', 'packages/magna-instagram-proof', [['@aztec/bb.js', '0.84.0'], ['@noir-lang/noir_js', '1.0.0-beta.5'], ['@noir-lang/acvm_js', '1.0.0-beta.5'], ['@noir-lang/types', '1.0.0-beta.5']]],
];
function installedVersion(requireFromLane, packageName) {
  let directory = dirname(requireFromLane.resolve(packageName === '@aztec-labs/aztec.js' ? `${packageName}/fields` : packageName));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (manifest.name) {
        assert.equal(manifest.name, packageName, `${packageName} must resolve its actual upstream package`);
        return manifest.version;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (directory === parse(directory).root) throw new Error(`Cannot find ${packageName} manifest`);
    directory = dirname(directory);
  }
}
for (const [lane, directory, packages] of lanes) {
  const requireFromLane = createRequire(resolve(root, directory, 'package.json'));
  for (const [packageName, expected] of packages) {
    assert.equal(installedVersion(requireFromLane, packageName), expected, `${lane}: ${packageName} must remain isolated at ${expected}`);
  }
  console.info(`[proof-runtime] ${lane}: exact package versions confirmed`);
}
