#!/usr/bin/env node
// Reports how far the local Aztec network's latest L1 block differs from
// wall-clock and verifies Magna's pinned local timing profile. Aztec 5.1's
// AutomineSequencer assigns rapidly-built checkpoints to fresh slots; explicit
// debug checkpoints do the same. Production-sized 72s slots therefore turn a
// short local test run into hours of monotonic L1 time.
//
// Usage: node scripts/check-localnet-drift.mjs   (or: npm run localnet:drift)
// Exit code: 0 healthy, 1 drifted past the danger threshold, 2 network down.

import { resolveClockConfig } from "./localnet-clock-config.mjs";

let L1;
let AZTEC_NODE;
const EXPECTED_AZTEC_SLOT_S = Number(process.env.EXPECTED_AZTEC_SLOT_DURATION ?? 8);
// The node enforces MAX_ALLOWED_ETH_CLIENT_DRIFT_SECONDS (default 300). Warn well
// before that so there is time to restart before a session goes bad.
const DANGER_S = Number(process.env.DRIFT_DANGER_SECONDS ?? 180);

async function readBlockTimestamp(tag) {
  const res = await fetch(L1, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [tag, false] }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = await res.json();
  if (!/^0x[0-9a-f]+$/i.test(body.result?.timestamp ?? "")) throw new Error("invalid block timestamp in response");
  return { timestamp: parseInt(body.result.timestamp, 16), number: body.result.number };
}

async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

async function aztecSlotDuration() {
  const nodeInfo = await rpc(AZTEC_NODE, "aztec_getNodeInfo");
  const rollup = nodeInfo?.l1ContractAddresses?.rollupAddress;
  if (!rollup) throw new Error("Aztec node info did not return a rollup address");
  const code = await rpc(L1, "eth_getCode", [rollup, "latest"]);
  if (!code || /^0x0*$/.test(code)) throw new Error("Aztec rollup has no code on the selected L1; RPC endpoints do not match");
  const encoded = await rpc(L1, "eth_call", [{ to: rollup, data: "0xc4014c12" }, "latest"]);
  return Number(BigInt(encoded));
}

try {
  const config = resolveClockConfig();
  L1 = config.l1RpcUrl;
  AZTEC_NODE = config.aztecNodeUrl;
  console.log(`Clock source: ${config.source}\nL1 RPC: ${L1}\nAztec RPC: ${AZTEC_NODE}`);
  const block = await readBlockTimestamp("latest");
  const pending = await readBlockTimestamp("pending");
  const chain = block.timestamp;
  const slotSeconds = await aztecSlotDuration();
  const wall = Math.floor(Date.now() / 1000);
  const pendingDrift = pending.timestamp - wall;
  const drift = chain - wall; // positive => chain is ahead of wall-clock
  const mins = (drift / 60).toFixed(1);
  console.log(`L1 block: ${block.number}; L1 timestamp: ${chain}; host timestamp: ${wall}; drift: ${drift}s (L1 minus host)`);
  console.log(`Pending L1 timestamp: ${pending.timestamp}; pending drift: ${pendingDrift}s`);
  if (!Number.isFinite(DANGER_S) || DANGER_S <= 0) throw new Error("DRIFT_DANGER_SECONDS must be positive");
  if (slotSeconds !== EXPECTED_AZTEC_SLOT_S) {
    console.error(
      `❌ local rollup uses ${slotSeconds}s Aztec slots; Magna requires the validated ${EXPECTED_AZTEC_SLOT_S}s profile.`,
    );
    console.error(`   Restart it with npm run network:local, then rerun both local bootstraps.`);
    process.exit(1);
  }
  if (drift <= -DANGER_S && Math.abs(pendingDrift) < DANGER_S) {
    console.log(`ℹ️ Latest L1 block is ${-drift}s old (idle); the pending block tracks host time (${pendingDrift}s).`);
    console.log("   This is an idle block age, not a future clock offset. Recovery retains its forward-only synchronization before portal submission.");
    process.exit(0);
  }
  if (Math.abs(drift) >= DANGER_S || Math.abs(pendingDrift) >= DANGER_S) {
    console.error(`❌ Local L1 clock is outside the ${DANGER_S}s threshold: latest drift ${drift}s; pending drift ${pendingDrift}s.`);
    console.error("   Inspect the selected deployment's node/clock logs. A new passport scan cannot repair a clock offset. No clock was changed.");
    process.exit(1);
  }
  console.log(
    `✅ drift ${drift}s (${mins} min), Aztec slot ${slotSeconds}s — under the ${DANGER_S}s danger threshold. Network usable.`,
  );
  process.exit(0);
} catch (err) {
  console.error(`⚠️  could not verify local clock at ${L1 ?? "unresolved RPC"}: ${err instanceof Error ? err.message : String(err)}`);
  console.error(`   Is the local network running? (npm run network:local)`);
  process.exit(2);
}
