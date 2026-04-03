#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { connect } from "node:net";
import { resolve, join, basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PINNED_AZTEC_VERSION = process.env.AZTEC_VERSION_PIN ?? "4.2.0-aztecnr-rc.2";
const TXE_PORT = Number(process.env.AZTEC_TXE_PORT ?? "8081");
const TXE_START_TIMEOUT_MS = Number(process.env.AZTEC_TXE_START_TIMEOUT_MS ?? "30000");
const NARGO_TEST_THREADS = process.env.AZTEC_NARGO_TEST_THREADS ?? "1";

function getAztecEnv() {
  const env = { ...process.env };
  // Pin CLI container/image tag unless caller explicitly sets VERSION.
  if (!env.VERSION) {
    env.VERSION = PINNED_AZTEC_VERSION;
  }
  return env;
}

function getAztecTestEnv() {
  const env = getAztecEnv();
  env.LOG_LEVEL ??= "error";
  env.NARGO_FOREIGN_CALL_TIMEOUT ??= "300000";
  return env;
}

function run(command, args, cwd, env = getAztecEnv()) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env,
  });
  return result.status ?? 1;
}

function runCapture(command, args, cwd, env = getAztecEnv()) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env,
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function hasAztecCompile(cwd) {
  const help = runCapture("aztec", ["--help"], cwd);
  if (help.status !== 0) return false;
  return /\bcompile\b/.test(help.stdout);
}

function compileProject(projectPath) {
  const cwd = resolve(projectPath);
  if (hasAztecCompile(cwd)) {
    process.exit(run("aztec", ["compile"], cwd));
  }

  // Fallback for CLI builds that do not expose `aztec compile`.
  const aztecNargo = run("aztec-nargo", ["compile"], cwd);
  if (aztecNargo === 0) process.exit(0);

  const nargo = run("nargo", ["compile"], cwd);
  process.exit(nargo);
}

function compileProjectReturn(projectPath) {
  const cwd = resolve(projectPath);
  if (hasAztecCompile(cwd)) {
    return run("aztec", ["compile"], cwd);
  }
  // Fallback for CLI builds that do not expose `aztec compile`.
  const aztecNargo = run("aztec-nargo", ["compile"], cwd);
  if (aztecNargo === 0) return 0;
  return run("nargo", ["compile"], cwd);
}

function ensureArtifactInTarget(repoRoot, targetProjectPath, sourceProjectName, sourceArtifactName, destArtifactName) {
  const targetDir = join(targetProjectPath, "target");
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const sourceProject = join(repoRoot, "contracts", sourceProjectName);
  const sourceArtifact = join(sourceProject, "target", sourceArtifactName);
  if (!existsSync(sourceArtifact)) {
    const status = compileProjectReturn(sourceProject);
    if (status !== 0) return status;
  }

  copyFileSync(sourceArtifact, join(targetDir, destArtifactName));
  return 0;
}

function ensureArtifactFromProjectPath(targetProjectPath, sourceProjectPath, sourceArtifactName, destArtifactName) {
  const targetDir = join(targetProjectPath, "target");
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const sourceArtifact = join(sourceProjectPath, "target", sourceArtifactName);
  if (!existsSync(sourceArtifact)) {
    const status = compileProjectReturn(sourceProjectPath);
    if (status !== 0) return status;
  }

  copyFileSync(sourceArtifact, join(targetDir, destArtifactName));
  return 0;
}

function ensureArtifactFromFilePath(targetProjectPath, sourceArtifactPath, destArtifactName) {
  const targetDir = join(targetProjectPath, "target");
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  if (!existsSync(sourceArtifactPath)) {
    return 1;
  }
  copyFileSync(sourceArtifactPath, join(targetDir, destArtifactName));
  return 0;
}

function ensureCrossContractTestArtifacts(projectPath) {
  const cwd = resolve(projectPath);
  const repoRoot = resolve(cwd, "..", "..");
  if (cwd.endsWith(`${join("contracts", "magna-issuer")}`)) {
    // The Noir test runner expects deployed contracts to exist as artifacts under the
    // *current* project target directory. Issuer tests deploy `MagnaVerifyMeterHook`.
    return ensureArtifactInTarget(
      repoRoot,
      cwd,
      "magna-verify-meter-hook",
      "magna_verify_meter_hook-MagnaVerifyMeterHook.json",
      "magna_issuer-MagnaVerifyMeterHook.json",
    );
  }

  if (cwd.endsWith(`${join("contracts", "magna-company-sponsor")}`)) {
    // Sponsor tests deploy `MagnaIssuer` from the sponsor project.
    return ensureArtifactInTarget(
      repoRoot,
      cwd,
      "magna-issuer",
      "magna_issuer-MagnaIssuer.json",
      "magna_company_sponsor-MagnaIssuer.json",
    );
  }

  if (cwd.endsWith(`${join("contracts", "magna-rights-purchase-l2")}`)) {
    const ensureRegistryArtifact = ensureArtifactInTarget(
      repoRoot,
      cwd,
      "magna-company-rights-registry",
      "magna_company_rights_registry-MagnaCompanyRightsRegistry.json",
      "magna_company_rights_registry-MagnaCompanyRightsRegistry.json",
    );
    if (ensureRegistryArtifact !== 0) return ensureRegistryArtifact;

    const bundledTokenArtifact = join(
      repoRoot,
      "node_modules",
      "@aztec",
      "noir-contracts.js",
      "artifacts",
      "token_contract-Token.json",
    );
    if (existsSync(bundledTokenArtifact)) {
      return ensureArtifactFromFilePath(cwd, bundledTokenArtifact, "token_contract-Token.json");
    }

    const tokenProjectPath = resolve(
      process.env.HOME ?? "",
      "nargo",
      "github.com",
      "AztecProtocol",
      "aztec-packages",
      PINNED_AZTEC_VERSION,
      "noir-projects",
      "noir-contracts",
      "contracts",
      "app",
      "token_contract",
    );
    return ensureArtifactFromProjectPath(cwd, tokenProjectPath, "token_contract-Token.json", "token_contract-Token.json");
  }

  return 0;
}

function codegenProject(projectPath, outDir) {
  const cwd = process.cwd();
  const project = resolve(projectPath);
  const out = resolve(outDir);
  if (!existsSync(out)) {
    mkdirSync(out, { recursive: true });
  }
  // Old CLI variants expect a Noir ABI JSON path, while newer variants can
  // accept a project directory. Prefer explicit ABI JSON when available.
  let input = project;
  try {
    if (statSync(project).isDirectory()) {
      const targetDir = join(project, "target");
      if (existsSync(targetDir)) {
        const candidates = readdirSync(targetDir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => join(targetDir, f));
        if (candidates.length > 0) {
          const expectedContractName = basename(project)
            .split("-")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join("");
          const preferred = candidates.find((candidate) =>
            candidate.endsWith(`-${expectedContractName}.json`),
          );
          input = preferred ?? candidates[0];
        }
      }
    }
  } catch {
    // Keep original path if file stat fails.
  }

  process.exit(run("aztec", ["codegen", "--force", input, "-o", out], cwd));
}

async function waitForPort(port, child) {
  const deadline = Date.now() + TXE_START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`aztec start --txe exited before port ${port} became ready`);
    }

    const isReady = await new Promise((resolveReady) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolveReady(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolveReady(false);
      });
    });

    if (isReady) {
      return;
    }

    await sleep(200);
  }

  throw new Error(`Timed out waiting for TXE on port ${port}`);
}

function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
}

async function testProject(projectPath) {
  const cwd = resolve(projectPath);
  const prep = ensureCrossContractTestArtifacts(cwd);
  if (prep !== 0) process.exit(prep);

  // Aztec's shell wrapper hardcodes `nargo test --test-threads 16`, but our
  // contract suites exercise TXE/world-state state machines that are not stable
  // under parallel execution. Run tests serially by default and allow opt-in
  // overrides when the upstream runtime issue is resolved.
  const txe = spawn("aztec", ["start", "--txe", "--port", String(TXE_PORT)], {
    cwd,
    stdio: "inherit",
    shell: false,
    env: getAztecTestEnv(),
  });

  let status = 1;
  try {
    await waitForPort(TXE_PORT, txe);
    status = run(
      "nargo",
      [
        "test",
        "--silence-warnings",
        "--oracle-resolver",
        `http://127.0.0.1:${TXE_PORT}`,
        "--test-threads",
        NARGO_TEST_THREADS,
      ],
      cwd,
      getAztecTestEnv(),
    );
  } finally {
    stopChild(txe);
  }

  process.exit(status);
}

const [, , action, arg1, arg2] = process.argv;

if (!action || !arg1) {
  process.stderr.write(
    "Usage:\n  node scripts/aztec-tooling.mjs compile <project-path>\n  node scripts/aztec-tooling.mjs test <project-path>\n  node scripts/aztec-tooling.mjs codegen <project-path> <out-dir>\n",
  );
  process.exit(1);
}

async function main() {
  if (action === "compile") {
    compileProject(arg1);
  } else if (action === "test") {
    await testProject(arg1);
  } else if (action === "codegen") {
    if (!arg2) {
      process.stderr.write("codegen requires <out-dir>\n");
      process.exit(1);
    }
    codegenProject(arg1, arg2);
  } else {
    process.stderr.write(`Unknown action: ${action}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
