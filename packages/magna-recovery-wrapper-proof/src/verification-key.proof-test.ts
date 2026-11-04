import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateRecoveryWrapperSolidityVerifier } from "./prove.js";

test("patched BB5 preserves the deployed Recovery V3 EVM verification key", async () => {
  const expected = readFileSync(new URL(
    "../../../contracts/magna-recovery-portal/src/generated/RecoveryWrapperVerifier.vk.bin",
    import.meta.url,
  ));
  const { verificationKey, solidity } = await generateRecoveryWrapperSolidityVerifier();
  assert.deepEqual(Buffer.from(verificationKey), expected);
  assert.ok(solidity.includes("function verify(bytes calldata _proof, bytes32[] calldata _publicInputs)"));
});
