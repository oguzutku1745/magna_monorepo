import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const workspace = process.argv.includes('--workspace');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function installedPackage(name, resolver) {
  const entry = realpathSync(resolver.resolve(name));
  if (workspace) {
    assert.equal(entry, realpathSync(join(root, 'packages', `magna-${name.split('/')[1]}`, 'dist/index.js')),
      `${name} must resolve to this repository's workspace`);
  } else {
    assert.ok(entry.includes(`${sep}node_modules${sep}`), `${name} resolved to a workspace: ${entry}`);
  }
  const manifest = JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8'));
  assert.equal(manifest.name, name);
  console.info(`[reference-sdk] ${name}@${manifest.version}: ${entry}`);
  return { entry, manifest };
}

const client = installedPackage('@magna-protocol/client', require);
assert.equal(client.manifest.version, '0.3.0', 'The V6 reference app requires client 0.3.0');
assert.equal(client.manifest.dependencies['@aztec-labs/aztec.js'], '6.0.0');
// Resolve core from the client's actual location, so a transitive workspace
// dependency cannot pass merely because the app has a separate installed core.
const core = installedPackage('@magna-protocol/core', createRequire(client.entry));
assert.equal(core.manifest.version, client.manifest.dependencies['@magna-protocol/core']);
