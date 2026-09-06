import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('docker', [
  'run', '--rm', '--network', 'none', '--label', 'io.magna.clock-experiment=true',
  '--entrypoint', 'node',
  '-e', 'LOG_LEVEL=error', '-e', 'MAGNA_MANAGED_LOCAL_CLOCK=1',
  '-e', 'MAGNA_LOCAL_CLOCK_MARKER=/tmp/clock-ready.json',
  '-e', 'ETHEREUM_SLOT_DURATION=4', '-e', 'AZTEC_SLOT_DURATION=8', '-e', 'SEQ_BLOCK_DURATION_MS=1000',
  '--mount', `type=bind,source=${resolve(root, 'docker/local-clock')},target=/opt/magna-local-clock,readonly`,
  '--mount', `type=bind,source=${resolve(root, 'scripts/test-local-clock-integration.mjs')},target=/workspace/scripts/test-local-clock-integration.mjs,readonly`,
  'magna-local-app:aztec-5.1.0', '--import', '/opt/magna-local-clock/register.mjs',
  '--experimental-import-meta-resolve', '/workspace/scripts/test-local-clock-integration.mjs',
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
