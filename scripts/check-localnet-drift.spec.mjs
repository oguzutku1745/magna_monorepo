import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { frontendEndpoints, resolveClockConfig } from "./localnet-clock-config.mjs";

test("active Docker public endpoints override the stale host manifest", () => {
  const config = resolveClockConfig({}, () => ({status: 0, stdout:
    "VITE_MAGNA_L1_RPC_URL=http://127.0.0.1:18545\nVITE_AZTEC_NODE_URL=http://localhost:8080\n"}));
  assert.equal(config.l1RpcUrl, "http://127.0.0.1:18545");
  assert.equal(config.source, "active Docker management runtime");
});
test("explicit endpoints work without Docker and inaccessible Docker fails closed", () => {
  assert.equal(resolveClockConfig({L1_RPC_URL: "http://l1", AZTEC_NODE_URL: "http://l2"}, () => {
    throw new Error("must not invoke Docker");
  }).l1RpcUrl, "http://l1");
  assert.throws(() => resolveClockConfig({}, () => ({status: 1, stderr: "permission denied"})), /Cannot inspect Docker/);
  assert.deepEqual(frontendEndpoints('PRIVATE_KEY=secret\nVITE_L1_RPC_URL="http://l1"'),
    {l1RpcUrl: "http://l1", aztecNodeUrl: undefined});
});
for (const [drift, pendingDrift, expected] of [[30, 30, 0], [2707, 2707, 1], [-517848, -517848, 1], [-600, 0, 0], [0, 2707, 1]]) {
  test(`CLI reports drift ${drift} with exit ${expected}`, async () => {
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const {method, params} = JSON.parse(body);
      const offset = params?.[0] === "pending" ? pendingDrift : drift;
      const result = method === "eth_getBlockByNumber"
        ? {timestamp: `0x${(Math.floor(Date.now()/1000) + offset).toString(16)}`, number: "0x42"}
        : method === "aztec_getNodeInfo" ? {l1ContractAddresses: {rollupAddress: "0x123"}} : "0x08";
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({jsonrpc: "2.0", id: 1, result}));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      const child = spawn(process.execPath, ["scripts/check-localnet-drift.mjs"], {
        env: {...process.env, L1_RPC_URL: url, AZTEC_NODE_URL: url},
      });
      let output = "";
      child.stdout.on("data", b => output += b);
      child.stderr.on("data", b => output += b);
      const code = await new Promise(resolve => child.on("exit", resolve));
      assert.equal(code, expected, output);
      assert.match(output, /L1 block: 0x42; L1 timestamp: \d+; host timestamp: \d+/);
      if (expected) assert.doesNotMatch(output, /Network usable/);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
}
