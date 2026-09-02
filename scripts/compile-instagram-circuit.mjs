#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// zkemail.nr v2.0.0 pins this exact compiler in its own upstream CI.
// Keep this separate from Aztec's bundled Nargo and fail closed on drift.
const EXPECTED_NARGO_VERSION = "1.0.0-beta.5";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(repoRoot, "packages/magna-instagram-proof");
const circuitRoot = resolve(packageRoot, "circuit");
const artifactPath = resolve(circuitRoot, "target/magna_instagram_proof.json");
const nargoBin = process.env.NARGO_BIN?.trim() || "nargo";

// Nargo beta.5's Brillig checker reports five conservative diagnostics in the
// exact upstream sources below. Each unsafe result is subsequently rebuilt or
// constrained in-circuit; docs/evidence/instagram-proof-portability-2026-08-30.md
// records the source-level review and adversarial witness tests. Keep this list
// fail-closed: any new, removed, relocated, or modified diagnostic requires a
// fresh review rather than a blanket warning suppression.
const AUDITED_BRILLIG_DIAGNOSTICS = [
  {
    suffix: "/noir-lang/sha256/v0.1.2/src/sha256.nr",
    line: 49,
    sourceSha256: "5577519b2799ba3ff7472c803df281e012667395c0679928826faad4f8339a68",
  },
  {
    suffix: "/noir-lang/sha256/v0.1.2/src/sha256.nr",
    line: 110,
    sourceSha256: "5577519b2799ba3ff7472c803df281e012667395c0679928826faad4f8339a68",
  },
  {
    suffix: "/noir-lang/noir-bignum/v0.6.0/src/fns/expressions.nr",
    line: 258,
    sourceSha256: "324bdc6c7e1f53a1789eb85ba69611213ff3407203a3ec2a39ab349d676fe1e0",
  },
  {
    suffix: "/zkemail/zkemail.nr/v2.0.0/lib/src/partial_hash.nr",
    line: 191,
    sourceSha256: "fdd10d1fac6369a694bd690832fe9e11ad6fdd2021dcbc8fb961d8a3f4390bfa",
  },
  {
    suffix: "/zkemail/zkemail.nr/v2.0.0/lib/src/partial_hash.nr",
    line: 252,
    sourceSha256: "fdd10d1fac6369a694bd690832fe9e11ad6fdd2021dcbc8fb961d8a3f4390bfa",
  },
];

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/gu, "");
}

function auditBrilligDiagnostics(rawOutput) {
  const output = stripAnsi(rawOutput);
  const diagnosticCount = (output.match(/bug: Brillig function call isn't properly covered by a manual constraint/gu) ?? []).length;
  if (diagnosticCount !== AUDITED_BRILLIG_DIAGNOSTICS.length) {
    throw new Error(
      `Instagram circuit emitted ${diagnosticCount} Brillig soundness diagnostics; ` +
        `${AUDITED_BRILLIG_DIAGNOSTICS.length} exact audited diagnostics were expected. Review the compiler output before proceeding.\n${output}`,
    );
  }

  const checkedSources = new Set();
  for (const expected of AUDITED_BRILLIG_DIAGNOSTICS) {
    const escapedSuffix = expected.suffix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = new RegExp(`([^\\s\\n]*${escapedSuffix}):${expected.line}:\\d+`, "u").exec(output);
    if (!match) {
      throw new Error(
        `Instagram circuit did not emit the audited diagnostic ${expected.suffix}:${expected.line}. ` +
          `Treat diagnostic drift as a security review failure.\n${output}`,
      );
    }
    if (!checkedSources.has(match[1])) {
      const digest = createHash("sha256").update(readFileSync(match[1])).digest("hex");
      if (digest !== expected.sourceSha256) {
        throw new Error(
          `Audited Instagram dependency source changed at ${match[1]}: expected ${expected.sourceSha256}, received ${digest}.`,
        );
      }
      checkedSources.add(match[1]);
    }
  }
  console.info(`[instagram-circuit] accepted exactly ${diagnosticCount} source-audited Brillig diagnostics`);
}

function run(args, options = {}) {
  const result = spawnSync(nargoBin, args, {
    cwd: packageRoot,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  if (result.error) {
    throw new Error(`Could not execute Instagram Nargo compiler ${JSON.stringify(nargoBin)}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    const detail = options.capture ? `\n${String(result.stdout ?? "")}${String(result.stderr ?? "")}` : "";
    throw new Error(`Instagram Nargo compiler exited with code ${result.status ?? 1}.${detail}`);
  }
  return result;
}

const versionResult = run(["--version"], { capture: true });
const versionText = `${versionResult.stdout ?? ""}\n${versionResult.stderr ?? ""}`;
const actualVersion = /nargo version\s*=\s*([^\s]+)/u.exec(versionText)?.[1];
if (actualVersion !== EXPECTED_NARGO_VERSION) {
  throw new Error(
    `Instagram circuit requires nargo ${EXPECTED_NARGO_VERSION}; received ${actualVersion ?? "an unrecognized version"} from ${JSON.stringify(nargoBin)}. ` +
      `Install the exact official release or set NARGO_BIN to its executable. Aztec's nargo must not compile this isolated zkEmail circuit.`,
  );
}

console.info(`[instagram-circuit] compiling with nargo ${actualVersion} (${nargoBin})`);
const compileResult = run(
  ["compile", "--force", "--enable-brillig-constraints-check-lookback", "--program-dir", circuitRoot],
  { capture: true },
);
const compilerOutput = `${compileResult.stdout ?? ""}${compileResult.stderr ?? ""}`;
auditBrilligDiagnostics(compilerOutput);

if (!existsSync(artifactPath)) {
  throw new Error(`Instagram circuit compilation did not create ${artifactPath}.`);
}
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
if (typeof artifact.bytecode !== "string" || artifact.bytecode.length === 0) {
  throw new Error(`Instagram circuit artifact ${artifactPath} does not contain ACIR bytecode.`);
}

// Hash semantic ACIR only. The complete artifact embeds source/debug paths, so
// byte-identical circuits compiled at /workspace and /repo have different JSON
// hashes even though their executable bytecode is identical.
const acirBytecode = Buffer.from(artifact.bytecode, "base64");
const acirSha256 = createHash("sha256").update(acirBytecode).digest("hex");
console.info(`[instagram-circuit] ACIR sha256=${acirSha256} (${acirBytecode.length} bytes)`);
