import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { MagnaClient, validateLoginResponse, verifyAztecSessionAuthorization, type MagnaClientConfig, type SessionChainVerifier } from "./connector.js";
import { ageGteConstraint, computePolicyHash, CredentialType, MAGNA_SESSION_AUTHORIZATION_DS, sessionAuthorizationFields, type SessionAssertion } from "@magna-protocol/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { DomainSeparator } from "@aztec/constants";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync";

(globalThis as Record<string, unknown>).crypto ??= webcrypto;

const policy = { credentialType: CredentialType.Passport, constraints: [ageGteConstraint(18)] };
const gateway = `0x04${"00".repeat(31)}`;
const sponsor = `0x05${"00".repeat(31)}`;
const txHash = `0x00${"66".repeat(31)}`;

async function fixture() {
  const policyHash = await computePolicyHash(policy);
  const request = {
    clientId: "dapp_abc",
    origin: "http://localhost:5173",
    requestId: "11".repeat(16),
    sessionChallenge: `00${"22".repeat(31)}`,
    policyHash,
    consumerGatewayAddress: gateway,
    requirements: [{ id: "default", kind: "policy", policy }],
  };
  const now = Math.floor(Date.now() / 1000);
  const assertion: SessionAssertion = {
    v: 2,
    clientId: request.clientId,
    origin: request.origin,
    requestId: request.requestId,
    sessionChallenge: request.sessionChallenge,
    policyHash,
    verified: true,
    issuedAt: now,
    expiresAt: now + 300,
    authorizationContract: sponsor,
    receipt: txHash,
    receipts: [{ id: "default", kind: "policy", receipt: txHash }],
  };
  const calls: unknown[] = [];
  const chainVerifier: SessionChainVerifier = async input => { calls.push(input); };
  const config = {
    aztecNodeUrl: "http://localhost:8080",
    sessionAuthorizationAddress: sponsor,
    chainVerifier,
  };
  return { request, assertion, config, calls };
}

test("accepts only after validating the request-bound Aztec authorization", async () => {
  const { request, assertion, config, calls } = await fixture();
  const result = await validateLoginResponse(assertion, request, config);
  assert.equal(result.verified, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    aztecNodeUrl: "http://localhost:8080",
    authorizationContract: sponsor,
    consumerGatewayAddress: gateway,
    requestId: request.requestId,
    sessionChallenge: request.sessionChallenge,
    expiresAt: assertion.expiresAt,
    requirementIndex: 0,
    policy,
    txHash,
  });
});

for (const [name, mutate, pattern] of [
  ["requestId", (a: SessionAssertion) => ({ ...a, requestId: "99".repeat(16) }), /requestId/],
  ["challenge", (a: SessionAssertion) => ({ ...a, sessionChallenge: `00${"98".repeat(31)}` }), /sessionChallenge/],
  ["policy hash", (a: SessionAssertion) => ({ ...a, policyHash: `0x${"97".repeat(32)}` }), /policyHash/],
  ["origin", (a: SessionAssertion) => ({ ...a, origin: "http://evil.example" }), /origin/],
  ["authorization contract", (a: SessionAssertion) => ({ ...a, authorizationContract: gateway }), /authorization contract/],
] as const) {
  test(`rejects tampered ${name} before chain acceptance`, async () => {
    const { request, assertion, config } = await fixture();
    await assert.rejects(() => validateLoginResponse(mutate(assertion), request, config), pattern);
  });
}

test("rejects when the Aztec transaction lacks the exact authorization", async () => {
  const { request, assertion, config } = await fixture();
  config.chainVerifier = async () => { throw new Error("not bound"); };
  await assert.rejects(() => validateLoginResponse(assertion, request, config), /not bound/);
});

test("official Aztec receipt verification matches the Noir authorization vector", async () => {
  const input = {
    aztecNodeUrl: "http://unused.invalid",
    authorizationContract: sponsor,
    consumerGatewayAddress: gateway,
    requestId: "22".repeat(16),
    sessionChallenge: `00${"33".repeat(31)}`,
    expiresAt: 1_800_000_000,
    requirementIndex: 1,
    policy,
    txHash,
  };
  const inner = poseidon2HashWithSeparator(sessionAuthorizationFields(input), MAGNA_SESSION_AUTHORIZATION_DS);
  assert.equal(inner.toBigInt(), 17750339779338875618543372302299504726590070954394071976808203118234804546074n);
  const expected = poseidon2HashWithSeparator(
    [AztecAddress.fromStringUnsafe(sponsor), inner],
    DomainSeparator.SILOED_NULLIFIER,
  );
  assert.equal(expected.toBigInt(), 7108913328331415449662366580858494040522690686369701112510573469254538211157n);
  const receipt = {
    isMined: () => true,
    hasExecutionSucceeded: () => true,
    txEffect: { nullifiers: [expected] },
  };
  await verifyAztecSessionAuthorization(input, { getTxReceipt: async () => receipt } as never);
  for (const mutated of [
    { ...input, consumerGatewayAddress: `0x06${"00".repeat(31)}` },
    { ...input, requestId: "23".repeat(16) },
    { ...input, sessionChallenge: `00${"34".repeat(31)}` },
    { ...input, expiresAt: input.expiresAt + 1 },
    { ...input, requirementIndex: 2 },
    { ...input, policy: { credentialType: CredentialType.Passport, constraints: [ageGteConstraint(19)] } },
  ]) {
    await assert.rejects(
      () => verifyAztecSessionAuthorization(mutated, { getTxReceipt: async () => receipt } as never),
      /not bound/,
    );
  }
  await assert.rejects(() => verifyAztecSessionAuthorization(input, {
    getTxReceipt: async () => ({ ...receipt, isMined: () => false }),
  } as never), /not mined/);
  await assert.rejects(() => verifyAztecSessionAuthorization(input, {
    getTxReceipt: async () => ({ ...receipt, hasExecutionSucceeded: () => false }),
  } as never), /reverted/);
  await assert.rejects(() => verifyAztecSessionAuthorization(input, {
    getTxReceipt: async () => ({ ...receipt, txEffect: undefined }),
  } as never), /no transaction effect/);
  await assert.rejects(() => verifyAztecSessionAuthorization(input, {
    getTxReceipt: async () => ({ ...receipt, txEffect: { nullifiers: [] } }),
  } as never), /not bound/);
});

function popupConfig(overrides: Partial<MagnaClientConfig> = {}): MagnaClientConfig {
  return {
    clientId: "dapp_abc",
    walletOrigin: "http://localhost:5999",
    aztecNodeUrl: "http://localhost:8080",
    consumerGatewayAddress: gateway,
    sessionAuthorizationAddress: sponsor,
    chainVerifier: async () => undefined,
    ...overrides,
  };
}

test("MagnaClient.login times out if popup never responds", async () => {
  const client = new MagnaClient(popupConfig({
    timeoutMs: 25,
    windowImpl: {
      open: () => ({ closed: false, postMessage: () => {}, close: () => {} }),
      addMessageListener: () => () => {},
      origin: "http://localhost:5173",
    },
  }));
  await assert.rejects(() => client.login(policy), /timed out/);
});

test("MagnaClient ignores messages from the wrong origin", async () => {
  let listener: ((event: { origin: string; data: unknown }) => void) | undefined;
  const client = new MagnaClient(popupConfig({
    timeoutMs: 30,
    windowImpl: {
      open: () => ({ closed: false, postMessage: () => {}, close: () => {} }),
      addMessageListener: fn => { listener = fn; return () => {}; },
      origin: "http://localhost:5173",
    },
  }));
  const login = client.login(policy);
  while (!listener) await new Promise(resolve => setTimeout(resolve, 0));
  listener({ origin: "http://evil.example", data: { kind: "magna:login-error", error: "x" } });
  await assert.rejects(() => login, /timed out/);
});

test("MagnaClient sends one field-safe request for duplicate ready messages", async () => {
  let listener: ((event: { origin: string; data: unknown }) => void) | undefined;
  const posted: unknown[] = [];
  const client = new MagnaClient(popupConfig({
    timeoutMs: 30,
    windowImpl: {
      open: () => ({ closed: false, postMessage: message => posted.push(message), close: () => {} }),
      addMessageListener: fn => { listener = fn; return () => {}; },
      origin: "http://localhost:5173",
    },
  }));
  const login = client.login(policy);
  while (!listener) await new Promise(resolve => setTimeout(resolve, 0));
  listener({ origin: "http://localhost:5999", data: { kind: "magna:ready" } });
  listener({ origin: "http://localhost:5999", data: { kind: "magna:ready" } });
  assert.equal(posted.length, 1);
  assert.match((posted[0] as { sessionChallenge: string }).sessionChallenge, /^00[0-9a-f]{62}$/);
  await assert.rejects(() => login, /timed out/);
});
