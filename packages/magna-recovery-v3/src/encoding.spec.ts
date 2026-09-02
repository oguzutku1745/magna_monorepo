import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAGNA_RECOVERY_BIND_PREFIX,
  RECOVERY_V3_GOLDEN_VECTOR,
  computeRecoveryAuthorization,
  computeRecoveryIntent,
  computeRecoveryMessageSecretHash,
  computeRecoveryTrustContext,
  deriveRecoveryClaims,
  deriveZkPassportServiceContext,
  formatRecoveryBindCustomData,
  formatRecoveryBindData,
} from "./index.js";

const intentInput = {
  ethereumChainId: 31337n,
  recoveryPortalL1Address: 0x1234567890abcdef1234567890abcdef12345678n,
  aztecProtocolVersion: 1n,
  aztecChainId: 31337n,
  issuerL2Address: 0x1111n,
  destination: 0x2222n,
  recoveryNonce: 0x3333n,
  messageSecretHash: 0x4444n,
};

describe("Magna recovery V3 protocol encodings", () => {
  it("uses the exact zkPassport 0.37.3 custom_data encoding", () => {
    const intent = computeRecoveryIntent(intentInput);
    const customData = formatRecoveryBindCustomData(intent);
    assert.match(customData, /^magna-recovery-v3:[0-9a-f]{64}$/);
    assert.equal(customData.length, MAGNA_RECOVERY_BIND_PREFIX.length + 64);

    const encoded = formatRecoveryBindData(intent);
    assert.deepEqual(encoded.slice(0, 3), [3, 0, customData.length]);
    assert.equal(new TextDecoder().decode(Uint8Array.from(encoded.slice(3))), customData);
  });

  it("matches the frozen TypeScript/Noir/Solidity integration vector", async () => {
    const vector = RECOVERY_V3_GOLDEN_VECTOR;
    const messageSecretHash = await computeRecoveryMessageSecretHash(vector.inputs.messageSecret);
    assert.equal(messageSecretHash, vector.outputs.messageSecretHash);
    const recoveryIntent = computeRecoveryIntent({
      ...vector.inputs,
      messageSecretHash,
    });
    assert.equal(recoveryIntent, vector.outputs.recoveryIntent);
    assert.equal(formatRecoveryBindCustomData(recoveryIntent), vector.outputs.bindCustomData);

    const claims = deriveRecoveryClaims({
      identityValue: vector.inputs.identityValue,
      recoveryNonce: vector.inputs.recoveryNonce,
      nationalityAlpha3: vector.inputs.nationalityAlpha3,
      minAgeProven: vector.inputs.minAgeProven,
      passportExpiry: vector.inputs.passportExpiry,
      proofCurrentDate: vector.inputs.proofCurrentDate,
    });
    assert.equal(claims.nationalityBlind, vector.outputs.nationalityBlind);
    assert.equal(claims.expiryBlind, vector.outputs.expiryBlind);
    assert.equal(claims.nationalityCommitment, vector.outputs.nationalityCommitment);
    assert.equal(claims.expiryCommitment, vector.outputs.expiryCommitment);
    assert.equal(claims.claimsHash, vector.outputs.claimsHash);
    assert.equal(claims.credentialValidUntil, vector.outputs.credentialValidUntil);
  });

  it("binds every pre-proof intent component", () => {
    const baseline = computeRecoveryIntent(intentInput);
    for (const [key, value] of Object.entries(intentInput)) {
      const changed = { ...intentInput, [key]: BigInt(value) + 1n };
      assert.notEqual(computeRecoveryIntent(changed), baseline, key);
    }
  });

  it("derives the official Aztec 5.1 secret hash", async () => {
    assert.equal(
      await computeRecoveryMessageSecretHash(8n),
      0x1848b066724ab0ffb50ecb0ee3398eb839f162823d262bad959721a9c13d1e96n,
    );
  });

  it("uses zkPassport's official domain and scope hash functions", () => {
    const first = deriveZkPassportServiceContext("example.com", "magna-recovery");
    const second = deriveZkPassportServiceContext("example.com", "magna-recovery-2");
    assert.notEqual(first.serviceScopeHash, 0n);
    assert.notEqual(first.serviceSubscopeHash, 0n);
    assert.equal(first.serviceScopeHash, second.serviceScopeHash);
    assert.notEqual(first.serviceSubscopeHash, second.serviceSubscopeHash);
  });

  it("binds every frozen trust-context field", () => {
    const service = deriveZkPassportServiceContext("example.com", "magna-recovery");
    const input = {
      ethereumChainId: 31337n,
      recoveryPortalL1Address: intentInput.recoveryPortalL1Address,
      aztecProtocolVersion: 1n,
      aztecChainId: 31337n,
      issuerL2Address: 0x1111n,
      serviceScopeHash: service.serviceScopeHash,
      serviceSubscopeHash: service.serviceSubscopeHash,
      nullifierType: 1n,
      oprfPublicKeyHash: 0x5555n,
      recoveryWrapperVersion: 1n,
    };
    const baseline = computeRecoveryTrustContext(input);
    for (const [key, value] of Object.entries(input)) {
      if (key === "nullifierType" || key === "oprfPublicKeyHash") continue;
      const changed = { ...input, [key]: BigInt(value) + 1n };
      assert.notEqual(computeRecoveryTrustContext(changed), baseline, key);
    }
    const developer = computeRecoveryTrustContext({
      ...input,
      nullifierType: 2n,
      oprfPublicKeyHash: 0n,
    });
    assert.notEqual(developer, baseline);
    assert.throws(
      () => computeRecoveryTrustContext({ ...input, nullifierType: 2n }),
      /NON_SALTED_MOCK/,
    );
    assert.throws(
      () => computeRecoveryTrustContext({ ...input, oprfPublicKeyHash: 0n }),
      /production SALTED/,
    );
  });

  it("derives claim blinds and caps credential validity at 30 days", () => {
    const proofCurrentDate = 1_800_000_000n;
    const claims = deriveRecoveryClaims({
      identityValue: 0x7777n,
      recoveryNonce: 0x3333n,
      nationalityAlpha3: "USA",
      minAgeProven: 18,
      passportExpiry: proofCurrentDate + 365n * 24n * 60n * 60n,
      proofCurrentDate,
    });
    assert.equal(claims.credentialValidUntil, proofCurrentDate + 30n * 24n * 60n * 60n);
    assert.notEqual(claims.nationalityBlind, claims.expiryBlind);
  });

  it("binds post-proof root, claims, and credential expiry", () => {
    const input = {
      recoveryIntent: computeRecoveryIntent(intentInput),
      rootCommitment: 0x5555n,
      claimsHash: 0x6666n,
      credentialValidUntil: 1_802_592_000n,
    };
    const baseline = computeRecoveryAuthorization(input);
    for (const [key, value] of Object.entries(input)) {
      const changed = { ...input, [key]: BigInt(value) + 1n };
      assert.notEqual(computeRecoveryAuthorization(changed), baseline, key);
    }
  });
});
