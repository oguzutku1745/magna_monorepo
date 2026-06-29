#!/usr/bin/env node
// Reports how far the local Aztec network's chain clock has drifted ahead of
// wall-clock. The sandbox warps its clock forward during block production /
// epoch settlement; once it is far enough ahead, valid txs (issuance, login)
// that simulate fine still get "Tx dropped by P2P node" at inclusion, because
// the sequencer cannot propose a block until wall-clock catches up. anvil
// timestamps are monotonic, so a drifted chain cannot be realigned in place —
// the only recovery is a restart.
//
// Usage: node scripts/check-localnet-drift.mjs   (or: npm run localnet:drift)
// Exit code: 0 healthy, 1 drifted past the danger threshold, 2 network down.

const L1 = process.env.L1_RPC_URL ?? "http://127.0.0.1:8545";
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

try {
  const chain = await latestBlockTimestamp();
  const wall = Math.floor(Date.now() / 1000);
  const drift = chain - wall; // positive => chain is ahead of wall-clock
  const mins = (drift / 60).toFixed(1);
  if (drift >= DANGER_S) {
    console.error(`❌ chain clock is ${drift}s (${mins} min) AHEAD of wall-clock.`);
    console.error(`   New txs will likely be "Tx dropped by P2P node". Restart the local network before testing.`);
    process.exit(1);
  }
  console.log(`✅ drift ${drift}s (${mins} min) — under the ${DANGER_S}s danger threshold. Network usable.`);
  process.exit(0);
} catch (err) {
  console.error(`⚠️  could not reach the L1 node at ${L1}: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`   Is the local network running? (npm run network:local)`);
  process.exit(2);
}
