import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { pedersenHash } from "@aztec/foundation/crypto/sync";
import { loadVerifiedInstagramFixture } from "./fixture-dkim.js";
import { proveInstagramEmail } from "./prove.js";
import { verifyInstagramProof } from "./verify.js";

test("proves and verifies the committed real Instagram DKIM email", async () => {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const rawEmail = readFileSync(resolve(sourceDirectory, "../fixtures/instagram-valid.eml"));
  const verifiedDkim = await loadVerifiedInstagramFixture();
  const issuance = {
    handleBlind: 123456789n,
    expiryTs: 2_000_000_000n,
    activeOwner: 101n,
    issuerAddress: 202n,
    chainId: 31_337n,
  };
  const artifact = await proveInstagramEmail(rawEmail, "akinspur", issuance, { verifiedDkim });

  assert.equal(artifact.metadata.normalizedHandle, "akinspur");
  assert.equal(BigInt(artifact.outputs.expiryTs), issuance.expiryTs);
  assert.equal(BigInt(artifact.outputs.activeOwner), issuance.activeOwner);
  assert.equal(BigInt(artifact.outputs.issuerAddress), issuance.issuerAddress);
  assert.equal(BigInt(artifact.outputs.chainId), issuance.chainId);
  const handleHash = pedersenHash([0x4d414948n, 8n, 0x616b696e73707572n]).toBigInt();
  const handleCommitment = pedersenHash([0x4d414943n, handleHash, issuance.handleBlind]).toBigInt();
  const expectedClaimsHash = pedersenHash([
    0x4d414743n,
    2n,
    3n,
    handleCommitment,
    issuance.expiryTs,
  ]).toBigInt();
  assert.equal(BigInt(artifact.outputs.claimsHash), expectedClaimsHash);
  assert.equal(artifact.publicInputs.length, 7);
  assert.equal(await verifyInstagramProof(artifact.proof), true);
});
