#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const compiler = process.env.AZTEC_NARGO_BIN?.trim() || resolve(
  process.env.AZTEC_HOME || resolve(homedir(), '.aztec'),
  'versions/5.1.0/bin/aztec-nargo',
);
const version = spawnSync(compiler, ['--version'], { encoding: 'utf8', shell: false });
const actual = /nargo version\s*=\s*([^\s]+)/u.exec(`${version.stdout ?? ''}\n${version.stderr ?? ''}`)?.[1];
if (version.error || version.status !== 0 || actual !== '1.0.0-beta.22') {
  throw new Error(`Standalone wrapper requires nargo 1.0.0-beta.22; received ${actual ?? version.error?.message ?? 'an unrecognized version'} from ${compiler}. Install Aztec 5.1.0 side by side or set AZTEC_NARGO_BIN to the exact beta.22 executable.`);
}
const circuit = process.argv[2];
if (!circuit) throw new Error('Usage: node scripts/compile-standalone-circuit.mjs <circuit-directory>');
const result = spawnSync(compiler, ['compile', '--program-dir', circuit], { stdio: 'inherit', shell: false });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
