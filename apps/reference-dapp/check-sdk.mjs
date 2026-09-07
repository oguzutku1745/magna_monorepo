import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';

const require = createRequire(import.meta.url);
function installedPackage(name, resolver) {
  const entry = realpathSync(resolver.resolve(name));
  assert.ok(entry.includes(`${sep}node_modules${sep}`), `${name} resolved to a workspace: ${entry}`);
  const manifest = JSON.parse(readFileSync(join(dirname(entry), '..', 'package.json'), 'utf8'));
  assert.equal(manifest.name, name);
  console.info(`[reference-sdk] ${name}@${manifest.version}: ${entry}`);
  return { entry, manifest };
}

const client = installedPackage('@magna-protocol/client', require);
// Resolve core from the client's actual location, so a transitive workspace
// dependency cannot pass merely because the app has a separate installed core.
const core = installedPackage('@magna-protocol/core', createRequire(client.entry));
assert.equal(core.manifest.version, client.manifest.dependencies['@magna-protocol/core']);
