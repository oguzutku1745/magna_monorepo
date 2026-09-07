import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { completeRedirectLogin, loginWithRedirect } from "./redirect.js";
import { ageGteConstraint, computePolicyHash, CredentialType, type SessionAssertion } from "@magna-protocol/core";
import type { MagnaClientConfig } from "./connector.js";

(globalThis as Record<string, unknown>).crypto ??= webcrypto;

const gateway = `0x04${"00".repeat(31)}`;
const sponsor = `0x05${"00".repeat(31)}`;
const txHash = `0x00${"66".repeat(31)}`;
const policy = { credentialType: CredentialType.Passport, constraints: [ageGteConstraint(18)] };

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: key => void map.delete(key),
    clear: () => map.clear(),
    key: index => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  } as Storage;
}

function baseConfig(): MagnaClientConfig {
  return {
    clientId: "dapp_abc",
    walletOrigin: "http://localhost:5999",
    aztecNodeUrl: "http://localhost:8080",
    consumerGatewayAddress: gateway,
    sessionAuthorizationAddress: sponsor,
    chainVerifier: async () => undefined,
  };
}

async function startRedirect(storage: Storage) {
  const config = { ...baseConfig(), redirectUri: "http://localhost:5173/cb" };
  let navigatedTo = "";
  await loginWithRedirect(config, policy, storage, url => { navigatedTo = url; }, "http://localhost:5173");
  const pending = JSON.parse(storage.getItem("magna-pending-login-v1")!) as {
    requestId: string;
    sessionChallenge: string;
    policyHash: string;
    policy: unknown;
  };
  return { config, pending, navigatedTo };
}

function assertionFor(pending: { requestId: string; sessionChallenge: string; policyHash: string }, overrides: Partial<SessionAssertion> = {}): SessionAssertion {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 2,
    clientId: "dapp_abc",
    origin: "http://localhost:5173",
    requestId: pending.requestId,
    sessionChallenge: pending.sessionChallenge,
    policyHash: pending.policyHash,
    verified: true,
    issuedAt: now,
    expiresAt: now + 300,
    authorizationContract: sponsor,
    receipt: txHash,
    receipts: [{ id: "default", kind: "policy", receipt: txHash }],
    ...overrides,
  };
}

test("redirect round trip validates the exchanged Aztec authorization", async () => {
  const storage = memoryStorage();
  const { config, pending, navigatedTo } = await startRedirect(storage);
  assert.ok(navigatedTo.startsWith("http://localhost:5999/authorize?request="));
  const fetchStub = (async () => new Response(JSON.stringify({ assertion: assertionFor(pending) }), { status: 200 })) as typeof fetch;
  const result = await completeRedirectLogin(
    { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
    "http://localhost:5173/cb?magna_code=onetimecode",
    storage,
    fetchStub,
  );
  assert.equal(result?.verified, true);
});

test("completeRedirectLogin returns null when no code is present", async () => {
  const result = await completeRedirectLogin(
    { ...baseConfig(), exchangeUrl: "http://localhost:5999/api/session/exchange" },
    "http://localhost:5173/cb",
    memoryStorage(),
  );
  assert.equal(result, null);
});

test("completeRedirectLogin rejects missing pending state", async () => {
  await assert.rejects(() => completeRedirectLogin(
    { ...baseConfig(), exchangeUrl: "http://localhost:5999/api/session/exchange" },
    "http://localhost:5173/cb?magna_code=onetimecode",
    memoryStorage(),
  ), /no pending/);
});

test("pending redirect state is single-use", async () => {
  const storage = memoryStorage();
  const { config, pending } = await startRedirect(storage);
  const fetchStub = (async () => new Response(JSON.stringify({ assertion: assertionFor(pending) }), { status: 200 })) as typeof fetch;
  const complete = () => completeRedirectLogin(
    { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
    "http://localhost:5173/cb?magna_code=onetimecode",
    storage,
    fetchStub,
  );
  await complete();
  await assert.rejects(complete, /no pending/);
});

test("redirect exchange rejects assertion bound to a different request", async () => {
  const storage = memoryStorage();
  const { config, pending } = await startRedirect(storage);
  const bad = assertionFor(pending, { requestId: "99".repeat(16) });
  const fetchStub = (async () => new Response(JSON.stringify({ assertion: bad }), { status: 200 })) as typeof fetch;
  await assert.rejects(() => completeRedirectLogin(
    { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
    "http://localhost:5173/cb?magna_code=onetimecode",
    storage,
    fetchStub,
  ), /requestId/);
});

test("redirect request stores the canonical policy and hash", async () => {
  const storage = memoryStorage();
  const { pending } = await startRedirect(storage);
  assert.ok(pending.policy);
  assert.equal(pending.policyHash, await computePolicyHash(policy));
  assert.match(pending.sessionChallenge, /^00[0-9a-f]{62}$/);
});
