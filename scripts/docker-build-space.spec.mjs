import assert from 'node:assert/strict';
import test from 'node:test';
import { availableBytesFromDf, requireBuildSpace } from './docker-build-space.mjs';

test('reads available blocks rather than the Docker disk size', () => {
  assert.equal(availableBytesFromDf('Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 33554432 29360128 4194304 88% /\n'), 4 * 1024 ** 3);
});
test('rejects malformed space output', () => {
  assert.throws(() => availableBytesFromDf('unavailable'), /Could not determine/);
});
test('host free space cannot hide an undersized Docker filesystem', () => {
  assert.throws(() => requireBuildSpace(4 * 1024 ** 3, 46 * 1024 ** 3), /Docker has 4.0 GiB/);
});
test('checks export space independently and accepts both reserves', () => {
  assert.throws(() => requireBuildSpace(16 * 1024 ** 3, 2 * 1024 ** 3), /host temporary filesystem/);
  assert.match(requireBuildSpace(16 * 1024 ** 3, 46 * 1024 ** 3), /Docker 16.0 GiB free/);
});
