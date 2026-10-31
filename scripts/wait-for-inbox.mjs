import { isL1ToL2MessageReady } from "@aztec-labs/aztec.js/messaging";
import { createAztecNodeDebugClient } from "@aztec-labs/stdlib/interfaces/client";
import { createPublicClient, http } from "viem";

// The local automine sequencer needs explicit empty work while no L2 tx is pending.
// Inclusion, never the number of checkpoints, remains the completion condition.
export async function waitForCommittedInboxWitness(options) {
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 180_000, 180_000);
  let lastError = "message not committed";
  const assertBeforeDeadline = () => {
    if (Date.now() >= deadline) throw new Error(`Committed Inbox wait timed out. last_error=${lastError}`);
  };
  const sleep = async ms => {
    assertBeforeDeadline();
    await new Promise(resolve => setTimeout(resolve, Math.min(ms, Math.max(1, deadline - Date.now()))));
  };
  let l1;
  let debug;
  const advanceLocalCheckpoint = async () => {
    if (!l1) {
      const nodeInfo = await options.node.getNodeInfo();
      if (BigInt(nodeInfo.l1ChainId) !== 31337n) throw new Error("Inbox debug progress requires local chain 31337.");
      l1 = createPublicClient({ transport: http(options.l1RpcUrl) });
      if (BigInt(await l1.getChainId()) !== 31337n) throw new Error("Inbox L1 debug progress requires local chain 31337.");
      debug = createAztecNodeDebugClient(options.nodeUrl);
    }
    while (true) {
      assertBeforeDeadline();
      const latest = await l1.getBlock();
      const wall = BigInt(Math.floor(Date.now() / 1_000));
      const drift = latest.timestamp - wall;
      if (drift >= 180n) throw new Error(`Local L1 is ${drift}s ahead of the host; refusing another Inbox checkpoint.`);
      if (latest.timestamp < wall) {
        const before = await options.node.getBlockNumber();
        await debug.warpL2TimeAtLeastTo(Number(wall));
        if (await options.node.getBlockNumber() > before) return;
      }
      await sleep(1_000);
    }
  };
  while (true) {
    assertBeforeDeadline();
    let witness;
    try {
      if (await isL1ToL2MessageReady(options.node, options.messageHash)) witness = await options.getWitness();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (witness) {
      if (witness[0] !== options.expectedIndex) {
        throw new Error(`Inbox index mismatch: portal=${options.expectedIndex} Aztec=${witness[0]}.`);
      }
      return witness;
    }
    await advanceLocalCheckpoint();
    await sleep(options.pollMs ?? 1_000);
  }
}
