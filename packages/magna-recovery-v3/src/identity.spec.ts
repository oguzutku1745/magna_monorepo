import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeRecoveryGhostAccountSalt,
  computeRecoveryGhostSigningSeed,
  computeRecoveryRootCommitment,
  deriveRecoveryGhostIdentity,
  RECOVERY_V3_GOLDEN_VECTOR,
} from "./index.js";

const identityInput = {
  identityValue: 0x7777n,
};

describe("Magna recovery V3 identity derivation", () => {
  it("matches the rooted A2 root/Ghost split", () => {
    const root = computeRecoveryRootCommitment(identityInput);
    const seed = computeRecoveryGhostSigningSeed(identityInput);
    const salt = computeRecoveryGhostAccountSalt(identityInput);
    assert.notEqual(root.toBigInt(), seed.toBigInt());
    assert.notEqual(root.toBigInt(), salt.toBigInt());
    assert.equal(seed.toBigInt(), salt.toBigInt());
  });

  it("changes when the authenticated identity changes", () => {
    const baseline = computeRecoveryRootCommitment(identityInput).toBigInt();
    assert.notEqual(
      computeRecoveryRootCommitment({ identityValue: 0x7778n }).toBigInt(),
      baseline,
    );
  });

  it("uses the Aztec 5.1 Schnorr account derivation APIs", async () => {
    const first = await deriveRecoveryGhostIdentity(identityInput);
    const second = await deriveRecoveryGhostIdentity(identityInput);
    assert.equal(first.rootCommitment.toString(), second.rootCommitment.toString());
    assert.equal(first.signingKey.toString(), second.signingKey.toString());
    assert.equal(first.privacySecret.toString(), second.privacySecret.toString());
    assert.equal(first.accountSalt.toString(), second.accountSalt.toString());
    assert.equal(first.address.toString(), second.address.toString());
    assert.equal(first.rootCommitment.toBigInt(), RECOVERY_V3_GOLDEN_VECTOR.outputs.rootCommitment);
    assert.equal(first.signingSeed.toBigInt(), RECOVERY_V3_GOLDEN_VECTOR.outputs.ghostSigningSeed);
    assert.equal(first.privacySecret.toBigInt(), RECOVERY_V3_GOLDEN_VECTOR.outputs.ghostPrivacySecret);
    assert.equal(first.accountSalt.toBigInt(), RECOVERY_V3_GOLDEN_VECTOR.outputs.ghostAccountSalt);
    assert.equal(first.address.toString(), RECOVERY_V3_GOLDEN_VECTOR.outputs.ghostAddress);
  });
});
