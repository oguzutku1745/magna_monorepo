import test from "node:test";
import assert from "node:assert/strict";
import {
  generateSessionSigningKeyPair,
  signSessionAssertion,
  verifySessionAssertion,
  type SessionAssertion,
} from "./session-assertion.js";

function fixtureAssertion(): SessionAssertion {
  return {
    v: 1,
    clientId: "dapp_abc",
    origin: "http://localhost:5173",
    requestId: "11".repeat(16),
    sessionChallenge: "22".repeat(32),
    policyHash: "0x" + "33".repeat(32),
    verified: true,
    issuedAt: 1765400000,
    expiresAt: 1765400300,
    receipt: null,
  };
}

test("sign/verify round-trip", async () => {
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const signed = await signSessionAssertion(fixtureAssertion(), privateKey);
  assert.equal(await verifySessionAssertion(signed, publicKeyJwk), true);
});

test("any field mutation breaks the signature", async () => {
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const signed = await signSessionAssertion(fixtureAssertion(), privateKey);
  for (const [field, value] of [
    ["verified", false], ["clientId", "dapp_evil"], ["policyHash", "0x" + "44".repeat(32)],
    ["expiresAt", 9999999999], ["requestId", "55".repeat(16)],
  ] as const) {
    const tampered = { ...signed, assertion: { ...signed.assertion, [field]: value } };
    assert.equal(await verifySessionAssertion(tampered, publicKeyJwk), false, String(field));
  }
});

test("multi-verification receipts are covered by the signature", async () => {
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const signed = await signSessionAssertion(
    {
      ...fixtureAssertion(),
      receipt: "0xpassport",
      receipts: [
        { id: "passport", kind: "policy", receipt: "0xpassport" },
        { id: "instagram", kind: "instagram-handle", receipt: "0xinstagram" },
      ],
    },
    privateKey,
  );
  assert.equal(await verifySessionAssertion(signed, publicKeyJwk), true);
  assert.equal(
    await verifySessionAssertion(
      {
        ...signed,
        assertion: {
          ...signed.assertion,
          receipts: [
            { id: "passport", kind: "policy", receipt: "0xpassport" },
            { id: "instagram", kind: "instagram-handle", receipt: "0xtampered" },
          ],
        },
      },
      publicKeyJwk,
    ),
    false,
  );
});

test("verification fails with the wrong key", async () => {
  const { privateKey } = await generateSessionSigningKeyPair();
  const other = await generateSessionSigningKeyPair();
  const signed = await signSessionAssertion(fixtureAssertion(), privateKey);
  assert.equal(await verifySessionAssertion(signed, other.publicKeyJwk), false);
});

test("generated private key is non-extractable", async () => {
  const { privateKey } = await generateSessionSigningKeyPair();
  await assert.rejects(() => crypto.subtle.exportKey("jwk", privateKey));
});

test("malformed signature length fails verification", async () => {
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const signed = await signSessionAssertion(fixtureAssertion(), privateKey);
  assert.equal(await verifySessionAssertion({ ...signed, signature: "00" }, publicKeyJwk), false);
});
