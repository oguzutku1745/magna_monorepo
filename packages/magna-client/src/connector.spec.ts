import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { validateLoginResponse, MagnaClient } from "./connector.js";
import {
  computePolicyHash,
  generateSessionSigningKeyPair,
  signSessionAssertion,
  ageGteConstraint,
  type SessionAssertion,
} from "@magna/core";

(globalThis as Record<string, unknown>).crypto ??= webcrypto;

const policy = { credentialType: 1, constraints: [ageGteConstraint(18)] };

async function makeFixture() {
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const policyHash = await computePolicyHash(policy);
  const request = {
    clientId: "dapp_abc",
    origin: "http://localhost:5173",
    requestId: "11".repeat(16),
    sessionChallenge: "22".repeat(32),
    policyHash,
  };
  const now = Math.floor(Date.now() / 1000);
  const assertion: SessionAssertion = {
    v: 1,
    ...request,
    verified: true,
    issuedAt: now,
    expiresAt: now + 300,
    receipt: null,
  };
  return { request, privateKey, publicKeyJwk, assertion };
}

test("accepts a well-formed signed response", async () => {
  const { request, privateKey, publicKeyJwk, assertion } = await makeFixture();
  const signed = await signSessionAssertion(assertion, privateKey);
  const result = await validateLoginResponse(signed, request, publicKeyJwk);
  assert.equal(result.verified, true);
});

test("rejects a response signed by the wrong key", async () => {
  const { request, publicKeyJwk, assertion } = await makeFixture();
  const attacker = await generateSessionSigningKeyPair();
  const signed = await signSessionAssertion(assertion, attacker.privateKey);
  await assert.rejects(() => validateLoginResponse(signed, request, publicKeyJwk), /signature/);
});

const tamperCases: [string, RegExp, (a: SessionAssertion) => SessionAssertion][] = [
  ["wrong requestId", /requestId/, a => ({ ...a, requestId: "99".repeat(16) })],
  ["wrong sessionChallenge", /sessionChallenge/, a => ({ ...a, sessionChallenge: "98".repeat(32) })],
  ["wrong policyHash", /policyHash/, a => ({ ...a, policyHash: "0x" + "97".repeat(32) })],
  ["wrong clientId", /clientId/, a => ({ ...a, clientId: "dapp_evil" })],
  ["wrong origin", /origin/, a => ({ ...a, origin: "http://evil.example" })],
  ["expired", /expired/, a => ({ ...a, issuedAt: a.issuedAt - 9000, expiresAt: a.expiresAt - 9000 })],
];

for (const [name, pattern, mutate] of tamperCases) {
  test(`rejects ${name} even when signed with the real wallet key`, async () => {
    const { request, privateKey, publicKeyJwk, assertion } = await makeFixture();
    const signed = await signSessionAssertion(mutate(assertion), privateKey);
    await assert.rejects(() => validateLoginResponse(signed, request, publicKeyJwk), pattern);
  });
}

test("MagnaClient.login times out if popup never responds", async () => {
  const { publicKeyJwk } = await makeFixture();
  const client = new MagnaClient({
    clientId: "dapp_abc",
    walletOrigin: "http://localhost:5999",
    magnaPublicKeyJwk: publicKeyJwk,
    timeoutMs: 50,
    windowImpl: {
      open: () => ({ closed: false, postMessage: () => {}, close: () => {} }),
      addMessageListener: () => () => {},
      origin: "http://localhost:5173",
    },
  });
  await assert.rejects(() => client.login(policy), /timed out/);
});

test("MagnaClient.login ignores messages from the wrong origin", async () => {
  const { publicKeyJwk } = await makeFixture();
  let listener: ((e: { origin: string; data: unknown }) => void) | undefined;
  const client = new MagnaClient({
    clientId: "dapp_abc",
    walletOrigin: "http://localhost:5999",
    magnaPublicKeyJwk: publicKeyJwk,
    timeoutMs: 100,
    windowImpl: {
      open: () => ({ closed: false, postMessage: () => {}, close: () => {} }),
      addMessageListener: fn => {
        listener = fn;
        return () => {};
      },
      origin: "http://localhost:5173",
    },
  });
  const login = client.login(policy);
  // Forged messages from non-wallet origins must be ignored.
  listener?.({ origin: "http://evil.example", data: { kind: "magna:login-error", error: "x" } });
  await assert.rejects(() => login, /timed out/);
});

test("MagnaClient.login sends the request once for duplicate ready messages", async () => {
  const { publicKeyJwk } = await makeFixture();
  let listener: ((e: { origin: string; data: unknown }) => void) | undefined;
  let requestCount = 0;
  const popup = {
    closed: false,
    postMessage: () => {
      requestCount += 1;
    },
    close: () => {},
  };
  const client = new MagnaClient({
    clientId: "dapp_abc",
    walletOrigin: "http://localhost:5999",
    magnaPublicKeyJwk: publicKeyJwk,
    timeoutMs: 50,
    windowImpl: {
      open: () => popup,
      addMessageListener: fn => {
        listener = fn;
        return () => {};
      },
      origin: "http://localhost:5173",
    },
  });

  const login = client.login(policy);
  while (!listener) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  listener?.({ origin: "http://localhost:5999", data: { kind: "magna:ready" } });
  listener?.({ origin: "http://localhost:5999", data: { kind: "magna:ready" } });

  assert.equal(requestCount, 1);
  await assert.rejects(() => login, /timed out/);
});
