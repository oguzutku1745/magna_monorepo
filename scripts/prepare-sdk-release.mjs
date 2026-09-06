#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('SDK release requires Node.js 24.12+');
const output = resolve('artifacts/sdk');
mkdirSync(output, { recursive: true });
const packages = [];
for (const directory of ['magna-core', 'magna-client']) {
  const cwd = resolve('packages', directory);
  const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  console.info(`[sdk] Test and pack ${manifest.name}@${manifest.version}`);
  execFileSync('npm', ['test'], { cwd, stdio: 'inherit' });
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', output], { cwd, encoding: 'utf8' }));
  assert.equal(manifest.private, undefined);
  assert.equal(manifest.publishConfig.access, 'public');
  assert.ok(packed.files.some(file => file.path === 'dist/index.js'));
  assert.ok(packed.files.some(file => file.path === 'dist/index.d.ts'));
  for (const { path } of packed.files) {
    assert.match(path, /^(package\.json|README\.md|dist\/[\w-]+\.(js|d\.ts))$/, `Unexpected package file: ${path}`);
    assert.ok(!path.includes('.spec.'), `Test leaked into package: ${path}`);
  }
  const tarball = resolve(output, packed.filename);
  const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex');
  packages.push({ name: manifest.name, version: manifest.version, filename: packed.filename, integrity: packed.integrity, sha256, files: packed.files.map(file => file.path) });
}
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
writeFileSync(resolve(output, 'release.json'), JSON.stringify({ sourceCommit, sourceDirty, packages }, null, 2) + '\n');
console.info(`[sdk] Audited tarballs and checksums: ${output}`);
