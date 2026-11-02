import { setTimeout as delay } from "node:timers/promises";

const controlUrl = process.env.MAGNA_LOCAL_CLOCK_CONTROL_URL;
const intervalMs = Number(process.env.MAGNA_LOCAL_CLOCK_INTERVAL_MS ?? 60_000);
if (!controlUrl || !Number.isFinite(intervalMs) || intervalMs <= 0) {
  throw new Error("A managed local clock URL and positive refresh interval are required");
}

async function control(path, method = "GET") {
  const response = await fetch(new URL(path, controlUrl), {
    method, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Clock control HTTP ${response.status}`);
  return response.json();
}

// Automine produces no empty blocks while idle. Magna's private revocation
// reads expire five minutes after their L2 anchor, so keep that anchor current.
// /activate serializes a forward-only checkpoint with the sequencer's queue;
// it preserves the chain, refuses future clock drift, and cannot overlap builds.
for (;;) {
  try {
    const status = await control("/status");
    if (status.phase === "realtime") {
      await control("/activate", "POST");
      console.info("[magna-local-clock] idle checkpoint refreshed");
    }
  } catch (error) {
    console.error(`[magna-local-clock] checkpoint refresh failed: ${error.message}`);
  }
  await delay(intervalMs);
}
