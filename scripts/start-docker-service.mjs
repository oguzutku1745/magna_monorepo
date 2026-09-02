#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = resolve(process.env.MAGNA_DOCKER_RUNTIME_DIR ?? "/runtime");
const service = process.argv[2];
const services = {
  management: {
    source: "magna-management.env",
    destination: "apps/magna-management/.env",
    startArgs: [
      "run",
      "-w",
      "@magna/management",
      "dev",
      "--",
      "--host",
      "0.0.0.0",
      "--port",
      "5174",
      "--strictPort",
    ],
  },
  "reference-dapp": {
    source: "reference-dapp.env",
    destination: "apps/reference-dapp/.env",
    startArgs: [
      "run",
      "-w",
      "@magna/reference-dapp",
      "dev",
      "--",
      "--host",
      "0.0.0.0",
      "--port",
      "5175",
      "--strictPort",
    ],
  },
  "verification-api": {
    source: "verification-api.env",
    destination: "apps/magna-verification-api/.env",
    startArgs: ["run", "-w", "@magna/verification-api", "start"],
  },
};

const selected = services[service];
if (!selected) throw new Error(`Unknown Docker service ${String(service)}.`);
const marker = resolve(runtimeDir, "bootstrap-complete.json");
const source = resolve(runtimeDir, selected.source);
if (!existsSync(marker) || !existsSync(source)) {
  throw new Error(`Docker bootstrap outputs are incomplete for ${service}.`);
}
copyFileSync(source, resolve(repoRoot, selected.destination));

const child = spawn("npm", selected.startArgs, { cwd: repoRoot, stdio: "inherit", shell: false });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", error => {
  console.error(`[docker-service:${service}] ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
