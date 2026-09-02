#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OFFICIAL_COMMIT = "a843c1e3c541be889e2b092efa5c04fbc80ac58f";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceArgument = process.argv.find(argument => argument.startsWith("--source="));
if (!sourceArgument) {
  throw new Error(
    `Clone https://github.com/zkpassport/zkpassport-packages at ${OFFICIAL_COMMIT}, then pass --source=/absolute/path.`,
  );
}
const checkoutRoot = resolve(sourceArgument.slice("--source=".length));
const sourceRoot = resolve(checkoutRoot, "packages/registry-contracts/src");
const targetRoot = resolve(repoRoot, "contracts/magna-recovery-portal/lib/zkpassport-registry/src");
const files = new Map([
  ["IRegistryInstance.sol", "aa7f08a8f8bd42e05ea53067df8c5c5268059f22d6465484cffd8d2cdce57e18"],
  ["RootRegistry.sol", "9643fc67f203beb2857c7edbd4a5f54d461e3c3ec988eaa823d741eeee36d7e4"],
  ["RegistryInstance.sol", "816d915a7ef223b756a5a587a244abf4a3871083a7d6d2fb8ceb0a6bf3b0845c"],
  ["registries/CertificateRegistry.sol", "05de503e10f5de34194f22c026e2a195c64ec381a58dc6ae49bcaabd140bbca2"],
  ["registries/CircuitRegistry.sol", "457212aa58fbd622ba3e7e94a9af5fb381209376a039daaef9eda9c0573780f3"],
]);

for (const [relativePath, expectedHash] of files) {
  const sourcePath = resolve(sourceRoot, relativePath);
  const bytes = readFileSync(sourcePath);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`Refusing unpinned official zkPassport source ${relativePath}: ${actualHash}.`);
  }
  const targetPath = resolve(targetRoot, relativePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
}

writeFileSync(
  resolve(targetRoot, "PROVENANCE.md"),
  `# Official zkPassport registry source\n\n` +
    `Mechanically synced from https://github.com/zkpassport/zkpassport-packages at commit \`${OFFICIAL_COMMIT}\`.\n` +
    `Every source file is SHA-256 pinned by \`scripts/sync-zkpassport-registry-source.mjs\`.\n` +
    `No Magna-specific behavior is added to these contracts.\n`,
);
console.log(`Synced ${files.size} hash-pinned official zkPassport registry sources from ${OFFICIAL_COMMIT}.`);
