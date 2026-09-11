#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = resolve(process.env.MAGNA_INSTAGRAM_TEST_EMAIL_PATH || resolve(root, '.private-test-fixtures/instagram-valid.eml'));
if (!existsSync(fixture)) {
  throw new Error('Supply a private Instagram .eml through MAGNA_INSTAGRAM_TEST_EMAIL_PATH; see packages/magna-instagram-proof/fixtures/README.md.');
}
const commands = { instagram: 'test:instagram-proof', reviewer: 'test:reviewer:critical' };
const command = commands[process.argv[2]];
if (!command) throw new Error('Expected instagram or reviewer test mode.');
const result = spawnSync('docker', [
  'run', '--rm',
  '--mount', `type=bind,source=${fixture},target=/private-fixtures/instagram.eml,readonly`,
  '-e', 'MAGNA_INSTAGRAM_TEST_EMAIL_PATH=/private-fixtures/instagram.eml',
  '-e', `MAGNA_INSTAGRAM_TEST_HANDLE=${process.env.MAGNA_INSTAGRAM_TEST_HANDLE || 'akinspur'}`,
  '-e', `NODE_OPTIONS=${process.env.NODE_OPTIONS || '--max-old-space-size=3072'}`,
  '-e', `HARDWARE_CONCURRENCY=${process.env.HARDWARE_CONCURRENCY || '2'}`,
  '-e', 'NARGO_BIN=/usr/local/bin/nargo-instagram',
  '--workdir', '/workspace', '--entrypoint', 'npm',
  'magna-local-app:aztec-5.1.0', 'run', command,
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
