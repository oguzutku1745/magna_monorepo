// Loader for the exact Aztec 5.1.0 image pinned in compose.yaml. No vendor files
// are changed. Fail closed if an upstream integration point changes.
import { registerHooks } from 'node:module';
import { patchLocalNetwork, patchSequencer } from './patch.mjs';

if (process.env.MAGNA_MANAGED_LOCAL_CLOCK !== '1') {
  throw new Error('The Magna clock loader is restricted to the managed local Docker network.');
}
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url === 'file:///usr/src/yarn-project/aztec/dest/local-network/local-network.js') {
      return { ...result, source: patchLocalNetwork(String(result.source)) };
    }
    if (url === 'file:///usr/src/yarn-project/sequencer-client/dest/sequencer/automine/automine_sequencer.js') {
      return { ...result, source: patchSequencer(String(result.source)) };
    }
    return result;
  },
});
