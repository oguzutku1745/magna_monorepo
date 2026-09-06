#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
if (nodeMajor < 24) {
  throw new Error(`Reviewer tests require Node.js >=24; received ${process.versions.node}.`);
}

const checks = [
  ["local clock diagnostic", ["run", "test:localnet:drift"]],
  ["passport issuer constraints", ["run", "test:contracts:issuer"]],
  ["chain-bound session authorization contract", ["run", "test:contracts:company-sponsor"]],
  ["protocol authorization hash vectors", ["run", "test:core"]],
  ["wallet verification transaction construction", ["run", "test:wallet"]],
  ["relying-party chain-effect validation", ["run", "test:client"]],
  ["A2 recursive wrapper", ["run", "-w", "@magna/passport-wrapper-proof", "test"]],
  ["Recovery V3 protocol", ["run", "test:recovery-v3"]],
  ["Recovery V3 recursive wrapper", ["run", "-w", "@magna/recovery-wrapper-proof", "test"]],
  ["Recovery V3 EVM portal", ["run", "test:recovery-portal"]],
  ["verification API boundaries", ["run", "-w", "@magna/verification-api", "test"]],
  ["management wallet flows", ["run", "-w", "@magna/management", "test"]],
  ["relying-party login surface", ["run", "-w", "@magna/reference-dapp", "test"]],
  ["Instagram real-DKIM circuit and proof", ["run", "test:instagram-proof"]],
];
const instagramNargo = process.env.NARGO_BIN?.trim() ||
  (existsSync("/usr/local/bin/nargo-instagram") ? "/usr/local/bin/nargo-instagram" : "nargo");

// The runnable image deliberately contains no deployment state. Two static
// management tests import the manifest shape at module load, so supply the
// checked-in non-secret build placeholder only when no real manifest exists.
// This is configuration scaffolding, never proof/chain evidence.
const deploymentPath = resolve("deployments/local.json");
const deploymentPlaceholderPath = resolve("deployments/docker-build-placeholder.json");
let createdDeploymentPlaceholder = false;
if (!existsSync(deploymentPath)) {
  if (!existsSync(deploymentPlaceholderPath)) {
    throw new Error(`Missing reviewer deployment placeholder: ${deploymentPlaceholderPath}.`);
  }
  copyFileSync(deploymentPlaceholderPath, deploymentPath);
  createdDeploymentPlaceholder = true;
}

try {
  for (const [label, args] of checks) {
    console.info(`\n[reviewer-critical] ${label}`);
    const result = spawnSync("npm", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=6144",
        NARGO_BIN: instagramNargo,
      },
      stdio: "inherit",
      shell: false,
    });
    if (result.error) {
      throw new Error(`Could not run ${label}: ${result.error.message}`);
    }
    if ((result.status ?? 1) !== 0) {
      throw new Error(`${label} failed with exit code ${result.status ?? 1}.`);
    }
  }
} finally {
  if (createdDeploymentPlaceholder) {
    rmSync(deploymentPath, { force: true });
  }
}

console.info("\n[reviewer-critical] all automated blocker and adapter checks passed");
