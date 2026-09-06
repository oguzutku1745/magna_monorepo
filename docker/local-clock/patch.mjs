const policy = new URL('./policy.mjs', import.meta.url).href;
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error(`Unsupported Aztec clock integration: expected exactly one ${JSON.stringify(before)}`);
  }
  return source.replace(before, after);
}
function addImport(source, names) {
  const statement = `import { ${names} } from ${JSON.stringify(policy)};\n`;
  return source.startsWith('#!')
    ? source.replace(/^(#![^\n]*\n)/, `$1${statement}`)
    : statement + source;
}
export function patchLocalNetwork(source) {
  return addImport(replaceOnce(source,
    'const dateProvider = new TestDateProvider();',
    'const dateProvider = new TestDateProvider();\n    await initializeLocalClock(dateProvider, l1RpcUrl);'),
  'initializeLocalClock');
}
export function patchSequencer(source) {
  source = replaceOnce(source,
    'const pendingBlockTs = await this.deps.ethCheatCodes.nextBlockTimestamp();',
    'await paceLocalCheckpoint(this);\n            const pendingBlockTs = await this.deps.ethCheatCodes.nextBlockTimestamp();');
  source = replaceOnce(source,
    'this.settler.start();\n        }\n    }',
    'this.settler.start();\n        }\n        await attachLocalClock(this);\n    }');
  source = replaceOnce(source,
    'async runWarp(targetTimestampSec) {',
    'async runWarp(targetTimestampSec) {\n        assertLocalWarpTarget(targetTimestampSec);');
  source = replaceOnce(source,
    'await this.deps.ethCheatCodes.setNextBlockTimestamp(slotBoundaryTs);\n        await this.runBuild({',
    'await paceLocalWarp(slotBoundaryTs);\n        await this.deps.ethCheatCodes.setNextBlockTimestamp(slotBoundaryTs);\n        await this.runBuild({');
  source = replaceOnce(source,
    'this.stopped = true;\n        this.running = false;',
    'this.stopped = true;\n        this.running = false;\n        closeLocalClock();');
  return addImport(source,
    'paceLocalCheckpoint, paceLocalWarp, attachLocalClock, assertLocalWarpTarget, closeLocalClock');
}
