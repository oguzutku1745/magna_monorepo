import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { patchLocalNetwork, patchSequencer } from '../docker/local-clock/patch.mjs';
test('loader rejects unsupported or ambiguous upstream code', () => {
  assert.throws(() => patchLocalNetwork('changed upstream'), /Unsupported/);
  const line = 'const dateProvider = new TestDateProvider();';
  assert.throws(() => patchLocalNetwork(line + line), /exactly one/);
  assert.throws(() => patchSequencer('changed upstream'), /Unsupported/);
});
const installed = '/usr/src/yarn-project/aztec/dest/local-network/local-network.js';
test('clock hooks match the pinned Aztec image', { skip: !existsSync(installed) }, () => {
  assert.match(patchLocalNetwork(readFileSync(installed, 'utf8')), /await initializeLocalClock/);
  assert.match(patchSequencer(readFileSync('/usr/src/yarn-project/sequencer-client/dest/sequencer/automine/automine_sequencer.js', 'utf8')), /await paceLocalCheckpoint/);
});
