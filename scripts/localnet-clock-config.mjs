import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function frontendEndpoints(text) {
  const entries = Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(VITE_MAGNA_L1_RPC_URL|VITE_L1_RPC_URL|VITE_AZTEC_NODE_URL)=(.*)$/);
    return match ? [[match[1], match[2].trim().replace(/^(["'])(.*)\1$/, "$2")]] : [];
  }));
  return {
    l1RpcUrl: entries.VITE_MAGNA_L1_RPC_URL || entries.VITE_L1_RPC_URL,
    aztecNodeUrl: entries.VITE_AZTEC_NODE_URL,
  };
}

export function resolveClockConfig(env = process.env, run = spawnSync) {
  const l1Override = env.L1_RPC_URL || env.MAGNA_L1_RPC_URL;
  const nodeOverride = env.AZTEC_NODE_URL || env.MAGNA_AZTEC_NODE_URL;
  if (l1Override && nodeOverride) {
    return { l1RpcUrl: l1Override, aztecNodeUrl: nodeOverride, source: "explicit RPC overrides" };
  }
  let endpoints;
  let source;
  if (env.MAGNA_DEPLOYMENT_MANIFEST) {
    endpoints = JSON.parse(readFileSync(resolve(env.MAGNA_DEPLOYMENT_MANIFEST), "utf8")).endpoints;
    source = "explicit deployment manifest";
  } else {
    // Read only public endpoint fields, never print the runtime's private keys.
    const result = run("docker", ["compose", "exec", "-T", "management", "node", "--input-type=module", "-e",
      'import {readFileSync} from "node:fs"; const text=readFileSync("/runtime/magna-management.env","utf8"); console.log(text.split(/\\r?\\n/).filter(l=>/^(VITE_MAGNA_L1_RPC_URL|VITE_L1_RPC_URL|VITE_AZTEC_NODE_URL)=/.test(l)).join("\\n"));',
    ], { cwd: repoRoot, encoding: "utf8", timeout: 10_000 });
    if (result.status === 0) {
      endpoints = frontendEndpoints(result.stdout);
      source = "active Docker management runtime";
    } else {
      // Do not silently inspect an old host deployment when Docker is inaccessible.
      const failure = `${result.error?.message ?? ""} ${result.stderr ?? ""}`;
      if (!result.error && !/is not running|no such service/i.test(failure)) {
        throw new Error("Cannot inspect Docker management runtime. Supply both L1_RPC_URL and AZTEC_NODE_URL explicitly, or MAGNA_DEPLOYMENT_MANIFEST for a host deployment.");
      }
      if (result.error && result.error.code !== "ENOENT") throw result.error;
      const path = resolve(repoRoot, "apps/magna-management/.env");
      endpoints = existsSync(path) ? frontendEndpoints(readFileSync(path, "utf8")) : {};
      const manifest = JSON.parse(readFileSync(resolve(repoRoot, "deployments/local.json"), "utf8"));
      endpoints = {
        l1RpcUrl: endpoints.l1RpcUrl || manifest.endpoints?.l1RpcUrl,
        aztecNodeUrl: endpoints.aztecNodeUrl || manifest.endpoints?.aztecNodeUrl,
      };
      source = "host management environment / deployment manifest";
    }
  }
  const config = { ...endpoints, l1RpcUrl: l1Override || endpoints?.l1RpcUrl,
    aztecNodeUrl: nodeOverride || endpoints?.aztecNodeUrl, source };
  if (!config.l1RpcUrl || !config.aztecNodeUrl) throw new Error("Active deployment is missing L1/Aztec RPC URLs.");
  return config;
}
