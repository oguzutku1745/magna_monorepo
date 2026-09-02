#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateRecoveryWrapperSolidityVerifier } from "../packages/magna-recovery-wrapper-proof/dist/prove.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  repoRoot,
  "contracts/magna-recovery-portal/src/generated/RecoveryWrapperVerifier.sol",
);
const vkOutputPath = resolve(
  repoRoot,
  "contracts/magna-recovery-portal/src/generated/RecoveryWrapperVerifier.vk.bin",
);

const { solidity, verificationKey } = await generateRecoveryWrapperSolidityVerifier();
if (!solidity.includes("function verify(bytes calldata _proof, bytes32[] calldata _publicInputs)")) {
  throw new Error("Generated verifier does not expose the ABI required by MagnaRecoveryPortal.");
}
const source = `// GENERATED FILE: bb.js 5.0.0, verifierTarget=evm. DO NOT EDIT.\n${solidity}`;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, source);
writeFileSync(vkOutputPath, verificationKey);
console.log(`Generated ${outputPath}`);
console.log(`Solidity SHA-256: ${createHash("sha256").update(source).digest("hex")}`);
console.log(`VK SHA-256: ${createHash("sha256").update(verificationKey).digest("hex")}`);
