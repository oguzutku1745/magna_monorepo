import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";

async function withKeeper(handler, check) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(process.execPath, ["docker/local-clock/keepalive.mjs"], {
    env: { ...process.env,
      MAGNA_LOCAL_CLOCK_CONTROL_URL: `http://127.0.0.1:${server.address().port}`,
      MAGNA_LOCAL_CLOCK_INTERVAL_MS: "20",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const exited = once(child, "exit");
  let timeout;
  try {
    await Promise.race([check(), exited.then(([code]) => {
      throw new Error(`Clock keeper exited with ${code}: ${output}`);
    }), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Clock keeper did not refresh: ${output}`)), 3000);
    })]);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(child.exitCode, null, output);
  }
}

test("keeps refreshing idle checkpoints after activation and skips bootstrap/failed clocks", { timeout: 5000 }, async () => {
  let reads = 0;
  let activations = 0;
  let done;
  const refreshed = new Promise(resolve => { done = resolve; });
  await withKeeper((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/status" && request.method === "GET") {
      reads++;
      response.end(JSON.stringify({ phase: reads === 1 ? "bootstrap" : reads === 2 ? "failed" : "realtime" }));
    } else if (request.url === "/activate" && request.method === "POST") {
      assert.ok(reads >= 3, "No checkpoint may be created before real-time activation");
      activations++;
      response.end(JSON.stringify({ phase: "realtime" }));
      if (activations === 2) done();
    } else {
      response.writeHead(404).end();
    }
  }, async () => {
    await refreshed;
    assert.equal(activations, 2, "Refresh must continue after the first idle checkpoint");
  });
});

test("retries a temporarily unavailable clock control endpoint", { timeout: 5000 }, async () => {
  let reads = 0;
  let done;
  const refreshed = new Promise(resolve => { done = resolve; });
  await withKeeper((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/status") {
      reads++;
      response.writeHead(reads === 1 ? 503 : 200);
      response.end(JSON.stringify({ phase: "realtime" }));
    } else {
      assert.ok(reads >= 2);
      response.end(JSON.stringify({ phase: "realtime" }));
      done();
    }
  }, async () => { await refreshed; });
});
