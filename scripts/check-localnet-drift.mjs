#!/usr/bin/env node
// Reports how far the local Aztec network's chain clock has drifted ahead of
// wall-clock and verifies Magna's pinned local timing profile. Aztec 5.1's
// AutomineSequencer assigns rapidly-built checkpoints to fresh slots; explicit
// debug checkpoints do the same. Production-sized 72s slots therefore turn a
// short local test run into hours of monotonic L1 time.
//
// Usage: node scripts/check-localnet-drift.mjs   (or: npm run localnet:drift)
// Exit code: 0 healthy, 1 drifted past the danger threshold, 2 network down.

const L1 = process.env.L1_RPC_URL ?? "http://127.0.0.1:8545";
const AZTEC_NODE = process.env.AZTEC_NODE_URL ?? "http://127.0.0.1:8080";
const EXPECTED_AZTEC_SLOT_S = Number(process.env.EXPECTED_AZTEC_SLOT_DURATION ?? 8);
// The node enforces MAX_ALLOWED_ETH_CLIENT_DRIFT_SECONDS (default 300). Warn well
// before that so there is time to restart before a session goes bad.
const DANGER_S = Number(process.env.DRIFT_DANGER_SECONDS ?? 180);

async function latestBlockTimestamp() {
  const res = await fetch(L1, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
  });
  const body = await res.json();
  if (!body.result?.timestamp) throw new Error("no block timestamp in response");
  return parseInt(body.result.timestamp, 16);
}

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

async function aztecSlotDuration() {
  const nodeInfo = await rpc(AZTEC_NODE, "aztec_getNodeInfo");
  const rollup = nodeInfo?.l1ContractAddresses?.rollupAddress;
  if (!rollup) throw new Error("Aztec node info did not return a rollup address");
  const encoded = await rpc(L1, "eth_call", [{ to: rollup, data: "0xc4014c12" }, "latest"]);
  return Number(BigInt(encoded));
}

try {
  const chain = await latestBlockTimestamp();
  const slotSeconds = await aztecSlotDuration();
  const wall = Math.floor(Date.now() / 1000);
  const drift = chain - wall; // positive => chain is ahead of wall-clock
  const mins = (drift / 60).toFixed(1);
  if (slotSeconds !== EXPECTED_AZTEC_SLOT_S) {
    console.error(
      `❌ local rollup uses ${slotSeconds}s Aztec slots; Magna requires the validated ${EXPECTED_AZTEC_SLOT_S}s profile.`,
    );
    console.error(`   Restart it with npm run network:local, then rerun both local bootstraps.`);
    process.exit(1);
  }
  if (drift >= DANGER_S) {
    console.error(`❌ chain clock is ${drift}s (${mins} min) AHEAD of wall-clock (${slotSeconds}s Aztec slots).`);
    console.error(`   New txs will likely be "Tx dropped by P2P node". Restart the local network before testing.`);
    process.exit(1);
  }
  console.log(
    `✅ drift ${drift}s (${mins} min), Aztec slot ${slotSeconds}s — under the ${DANGER_S}s danger threshold. Network usable.`,
  );
  process.exit(0);
} catch (err) {
  console.error(`⚠️  could not reach the L1 node at ${L1}: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`   Is the local network running? (npm run network:local)`);
  process.exit(2);
}
