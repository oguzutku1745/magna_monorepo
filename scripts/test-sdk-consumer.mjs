#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('SDK consumer test requires Node.js 24.12+');
const fromRegistry = process.argv.includes('--from-registry');
const output = resolve('artifacts/sdk');
const release = JSON.parse(readFileSync(join(output, 'release.json'), 'utf8'));
const consumer = mkdtempSync(join(tmpdir(), 'magna-sdk-consumer-'));
const app = resolve('apps/reference-dapp');
for (const file of ['src', 'index.html', 'tsconfig.json', 'vite.config.mjs', 'check-sdk.mjs']) {
  cpSync(join(app, file), join(consumer, file), { recursive: true });
}
const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
manifest.name = 'magna-installed-sdk-consumer';
for (const pkg of release.packages) {
  const tarball = join(output, pkg.filename);
  assert.equal(createHash('sha256').update(readFileSync(tarball)).digest('hex'), pkg.sha256, 'Tarball changed since audit');
  manifest.dependencies[pkg.name] = fromRegistry ? pkg.version : `file:${tarball}`;
}
writeFileSync(join(consumer, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
const envIndex = process.argv.indexOf('--env-file');
if (envIndex !== -1) cpSync(resolve(process.argv[envIndex + 1]), join(consumer, '.env'));
console.info(`[sdk-consumer] Isolated reference dApp: ${consumer}`);
// This directory is outside the monorepo; npm cannot resolve workspace links.
const run = (args) => execFileSync('npm', args, { cwd: consumer, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' } });
run(['install', '--maxsockets=5', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org']);
for (const pkg of release.packages) {
  const installed = join(consumer, 'node_modules', pkg.name);
  assert.equal(lstatSync(installed).isSymbolicLink(), false, `${pkg.name} resolved through a symlink`);
  assert.ok(realpathSync(installed).startsWith(realpathSync(consumer)));
  const installedManifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedManifest.version, pkg.version);
  assert.equal(installedManifest.license, 'Apache-2.0');
  assert.equal(readFileSync(join(installed, 'LICENSE'), 'utf8'), readFileSync(resolve('LICENSE'), 'utf8'));
}
run(['test']);
run(['run', 'build']);
writeFileSync(join(output, 'consumer.json'), JSON.stringify({ consumer, fromRegistry, sourceCommit: release.sourceCommit, packages: release.packages.map(({ name, version, sha256 }) => ({ name, version, sha256 })) }, null, 2) + '\n');
console.info(`[sdk-consumer] PASS: real package installation, reference tests, TypeScript and Vite build.\nRun the installed app: cd ${consumer} && npm run dev -- --host 127.0.0.1 --port 15175 --strictPort`);
