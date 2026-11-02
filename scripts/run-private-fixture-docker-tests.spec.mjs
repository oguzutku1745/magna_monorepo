import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const [label, override, expected] of [
  ['default', undefined, '1'],
  ['explicit override', '2', '2'],
]) {
  test(`Docker proof tests pass the ${label} TXE worker budget into the container`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'magna-docker-test-env-'));
    const fixture = join(dir, 'fixture.eml');
    const output = join(dir, 'docker-args.json');
    writeFileSync(fixture, 'test-only argument fixture; never used for proving');
    writeFileSync(join(dir, 'docker'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, MAGNA_INSTAGRAM_TEST_EMAIL_PATH: fixture };
    delete env.TXE_WORKERS;
    if (override !== undefined) env.TXE_WORKERS = override;
    try {
      const result = spawnSync(process.execPath, [resolve('scripts/run-private-fixture-docker-tests.mjs'), 'reviewer'], {
        env, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const args = JSON.parse(readFileSync(output, 'utf8'));
      const workerArg = args.findIndex(value => value.startsWith('TXE_WORKERS='));
      assert.notEqual(workerArg, -1, 'the child container must receive a worker budget');
      assert.equal(args[workerArg - 1], '-e');
      assert.equal(args[workerArg], `TXE_WORKERS=${expected}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
