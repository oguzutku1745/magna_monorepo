#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const record = JSON.parse(readFileSync(join(root, 'artifacts/sdk/consumer.json'), 'utf8'));
assert.equal(record.fromRegistry, true, 'Run npm run test:sdk:consumer -- --from-registry first.');
const release = JSON.parse(readFileSync(join(root, 'artifacts/sdk/release.json'), 'utf8'));
const consumer = realpathSync(record.consumer);
const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json'), 'utf8'));
for (const pkg of release.packages) {
  const installed = join(consumer, 'node_modules', pkg.name);
  const entry = lock.packages[`node_modules/${pkg.name}`];
  assert.equal(lstatSync(installed).isSymbolicLink(), false);
  assert.ok(realpathSync(installed).startsWith(consumer + sep));
  assert.equal(entry.version, pkg.version);
  assert.equal(entry.integrity, pkg.integrity);
  assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'));
}
const child = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5175', '--strictPort', ...process.argv.slice(2)], {
  cwd: consumer, stdio: 'inherit', shell: false,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exit(1); });
child.on('exit', code => process.exit(code ?? 1));
