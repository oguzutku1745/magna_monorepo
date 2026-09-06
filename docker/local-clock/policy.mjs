import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { getSlotAtTimestamp, getTimestampForSlot } from '/usr/src/yarn-project/stdlib/dest/epoch-helpers/index.js';

const wall = () => Math.floor(Date.now() / 1000);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const markerPath = process.env.MAGNA_LOCAL_CLOCK_MARKER ?? '/runtime/clock-ready.json';
let state;
let server;
let closed = false;

async function rpc(method, params = []) {
  const response = await fetch(state.rpcUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Local clock RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
async function block(tag) {
  const value = await rpc('eth_getBlockByNumber', [tag, false]);
  return { timestamp: Number(BigInt(value.timestamp)), hash: value.hash, number: value.number };
}
export async function initializeLocalClock(dateProvider, rpcUrl) {
  state = { rpcUrl, phase: 'bootstrap', dateProvider };
  if (Number(BigInt(await rpc('eth_chainId'))) !== 31337) throw new Error('Managed clock requires Anvil chain 31337');
  state.genesisHash = (await block('0x0')).hash;
  const latest = await block('latest');
  if (latest.timestamp > wall()) throw new Error('Local chain is already ahead of host; refusing historical startup');
  dateProvider.setTime(latest.timestamp * 1000);
}
export async function paceLocalCheckpoint(sequencer) {
  if (!state || state.phase === 'bootstrap') return;
  if (state.phase !== 'realtime') throw new Error('Local clock activation failed; checkpoint production is disabled');
  // Runs inside the sequencer's serial queue, covering mempool and debug builds.
  // Read pending time as well as the next owned slot: L1 activity can advance it.
  const began = Date.now();
  while (!closed) {
    const pending = await sequencer.deps.ethCheatCodes.nextBlockTimestamp();
    const slot = Math.max(
      Number(getSlotAtTimestamp(BigInt(pending), sequencer.deps.l1Constants)),
      sequencer.lastBuiltSlot + 1,
    );
    const target = Math.max(pending, Number(getTimestampForSlot(slot, sequencer.deps.l1Constants)));
    const ahead = target - wall();
    if (ahead <= 0) return;
    if (ahead >= 180 || Date.now() - began >= 180_000) {
      throw new Error(`Local clock cannot publish checkpoint at ${target}: host ${wall()}. Refusing accumulated future drift.`);
    }
    await sleep(Math.min(1000, ahead * 1000));
  }
  throw new Error('Local clock is shutting down');
}
export function assertLocalWarpTarget(timestamp) {
  if (timestamp > wall()) {
    throw new Error(`Local clock refuses future warp target ${timestamp}; host ${wall()}.`);
  }
}
export async function paceLocalWarp(timestamp) {
  if (state?.phase === 'bootstrap') return;
  if (state?.phase !== 'realtime') throw new Error('Local clock is not ready for checkpoint synchronization');
  // Wait BEFORE setting Anvil's pending timestamp: unrelated L1 transactions
  // can mine while the sequencer's serial queue is waiting.
  const began = Date.now();
  while (!closed && timestamp > wall()) {
    if (timestamp - wall() >= 180 || Date.now() - began >= 180_000) {
      throw new Error('Local clock synchronization exceeded its three-minute pacing limit');
    }
    await sleep(Math.min(1000, (timestamp - wall()) * 1000));
  }
  if (closed) throw new Error('Local clock is shutting down');
}
async function snapshot() {
  const latest = await block('latest');
  const pending = await block('pending');
  const host = wall();
  return {
    phase: state.phase, genesisHash: state.genesisHash,
    l1Timestamp: latest.timestamp, pendingTimestamp: pending.timestamp,
    hostTimestamp: host, driftSeconds: latest.timestamp - host,
    pendingDriftSeconds: pending.timestamp - host,
  };
}
async function activate(sequencer) {
  return sequencer.queue.put(async () => {
    try {
      const before = await block('latest');
      if (before.timestamp > wall()) throw new Error('Cannot activate real time: mined L1 is ahead of host');
      const slotSeconds = Number(sequencer.deps.l1Constants.slotDuration);
      if (slotSeconds !== 8) throw new Error(`Expected 8s Aztec slots, received ${slotSeconds}`);
      // runWarp rounds UP one slot. Target one slot behind the host so the
      // resulting checkpoint remains at/before real time. It is a forward-only no-op
      // if the existing chain has already reached that time.
      state.phase = 'bootstrap';
      await sequencer.runWarp(wall() - slotSeconds);
      if ((await block('latest')).timestamp > wall()) throw new Error('Catch-up exceeded host time');
      await rpc('anvil_removeBlockTimestampInterval');
      // This pinned Anvil RPC takes SECONDS (not milliseconds).
      await rpc('evm_setTime', [wall()]);
      state.dateProvider.reset();
      state.phase = 'realtime';
      const status = await snapshot();
      if (Math.abs(status.pendingDriftSeconds) > 2 || Math.abs(status.driftSeconds) > 16) {
        state.phase = 'failed';
        throw new Error(`Clock activation verification failed: ${JSON.stringify(status)}`);
      }
      mkdirSync(dirname(markerPath), { recursive: true });
      writeFileSync(`${markerPath}.tmp`, JSON.stringify({ ...status, activatedAt: new Date().toISOString() }) + '\n');
      renameSync(`${markerPath}.tmp`, markerPath);
      console.info('[magna-local-clock] ready', JSON.stringify(status));
      return status;
    } catch (error) {
      state.phase = 'failed';
      throw error;
    }
  });
}
export async function attachLocalClock(sequencer) {
  if (!state) throw new Error('Local clock was not initialized');
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    if (marker.genesisHash === state.genesisHash && marker.phase === 'realtime') {
      await activate(sequencer);
    }
  }
  // Internal Docker control endpoint; compose does not publish this port.
  server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    try {
      let result;
      if (request.method === 'GET' && request.url === '/status') result = await snapshot();
      else if (request.method === 'POST' && request.url === '/activate') result = await activate(sequencer);
      else { response.writeHead(404); response.end('{}'); return; }
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(503);
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8090, '0.0.0.0', resolve);
  });
  console.info(`[magna-local-clock] phase=${state.phase}; internal control ready`);
}
export function closeLocalClock() {
  closed = true;
  server?.close();
}
