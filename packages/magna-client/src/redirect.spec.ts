import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { completeRedirectLogin, loginWithRedirect } from "./redirect.js";
import {
  computePolicyHash,
  generateSessionSigningKeyPair,
  signSessionAssertion,
  ageGteConstraint,
  type SessionAssertion,
} from "@magna/core";

(globalThis as Record<string, unknown>).crypto ??= webcrypto;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: key => void map.delete(key),
    clear: () => map.clear(),
    key: index => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const policy = { credentialType: 1, constraints: [ageGteConstraint(18)] };

async function signedForPending(
  privateKey: CryptoKey,
  pending: { requestId: string; sessionChallenge: string; policyHash: string },
  overrides: Partial<SessionAssertion> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const assertion: SessionAssertion = {
    v: 1,
    clientId: "dapp_abc",
    origin: "http://localhost:5173",
    requestId: pending.requestId,
    sessionChallenge: pending.sessionChallenge,
    policyHash: pending.policyHash,
    verified: true,
    issuedAt: now,
    expiresAt: now + 300,
    receipt: null,
    ...overrides,
  };
  return signSessionAssertion(assertion, privateKey);
}

async function startRedirect(storage: Storage, publicKeyJwk: JsonWebKey) {
  const config = {
    clientId: "dapp_abc",
    walletOrigin: "http://localhost:5999",
    magnaPublicKeyJwk: publicKeyJwk,
    redirectUri: "http://localhost:5173/cb",
  };
  let navigatedTo = "";
  await loginWithRedirect(
    config,
    policy,
    storage,
    url => {
      navigatedTo = url;
    },
    "http://localhost:5173",
  );
  const pending = JSON.parse(storage.getItem("magna-pending-login-v1")!) as {
    requestId: string;
    sessionChallenge: string;
    policyHash: string;
  };
  return { config, pending, navigatedTo };
}

test("redirect round trip validates exchanged assertion", async () => {
  const storage = memoryStorage();
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const { config, pending, navigatedTo } = await startRedirect(storage, publicKeyJwk);
  assert.ok(navigatedTo.startsWith("http://localhost:5999/authorize?request="));
  const signed = await signedForPending(privateKey, pending);
  const fetchStub = (async () =>
    new Response(JSON.stringify({ assertion: signed }), { status: 200 })) as unknown as typeof fetch;
  const result = await completeRedirectLogin(
    { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
    "http://localhost:5173/cb?magna_code=onetimecode",
    storage,
    fetchStub,
  );
  assert.equal(result?.verified, true);
});

test("completeRedirectLogin returns null when no code is present", async () => {
  const { publicKeyJwk } = await generateSessionSigningKeyPair();
  const result = await completeRedirectLogin(
    {
      clientId: "dapp_abc",
      walletOrigin: "http://localhost:5999",
      magnaPublicKeyJwk: publicKeyJwk,
      exchangeUrl: "http://localhost:5999/api/session/exchange",
    },
    "http://localhost:5173/cb",
    memoryStorage(),
  );
  assert.equal(result, null);
});

test("completeRedirectLogin rejects missing pending state", async () => {
  const { publicKeyJwk } = await generateSessionSigningKeyPair();
  await assert.rejects(
    () =>
      completeRedirectLogin(
        {
          clientId: "dapp_abc",
          walletOrigin: "http://localhost:5999",
          magnaPublicKeyJwk: publicKeyJwk,
          exchangeUrl: "http://localhost:5999/api/session/exchange",
        },
        "http://localhost:5173/cb?magna_code=onetimecode",
        memoryStorage(),
      ),
    /no pending/,
  );
});

test("pending redirect state is single-use", async () => {
  const storage = memoryStorage();
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const { config, pending } = await startRedirect(storage, publicKeyJwk);
  const signed = await signedForPending(privateKey, pending);
  const fetchStub = (async () =>
    new Response(JSON.stringify({ assertion: signed }), { status: 200 })) as unknown as typeof fetch;
  await completeRedirectLogin(
    { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
    "http://localhost:5173/cb?magna_code=onetimecode",
    storage,
    fetchStub,
  );
  await assert.rejects(
    () =>
      completeRedirectLogin(
        { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
        "http://localhost:5173/cb?magna_code=onetimecode",
        storage,
        fetchStub,
      ),
    /no pending/,
  );
});

test("non-OK code exchange response rejects", async () => {
  const storage = memoryStorage();
  const { publicKeyJwk } = await generateSessionSigningKeyPair();
  const { config } = await startRedirect(storage, publicKeyJwk);
  const fetchStub = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      completeRedirectLogin(
        { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
        "http://localhost:5173/cb?magna_code=onetimecode",
        storage,
        fetchStub,
      ),
    /code exchange failed/,
  );
});

test("redirect exchange rejects assertion bound to a different requestId", async () => {
  const storage = memoryStorage();
  const { privateKey, publicKeyJwk } = await generateSessionSigningKeyPair();
  const { config, pending } = await startRedirect(storage, publicKeyJwk);
  const signed = await signedForPending(privateKey, pending, { requestId: "99".repeat(16) });
  const fetchStub = (async () =>
    new Response(JSON.stringify({ assertion: signed }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      completeRedirectLogin(
        { ...config, exchangeUrl: "http://localhost:5999/api/session/exchange" },
        "http://localhost:5173/cb?magna_code=onetimecode",
        storage,
        fetchStub,
      ),
    /requestId/,
  );
});

test("redirect request stores the canonical policy hash", async () => {
  const storage = memoryStorage();
  const { publicKeyJwk } = await generateSessionSigningKeyPair();
  const { pending } = await startRedirect(storage, publicKeyJwk);
  assert.equal(pending.policyHash, await computePolicyHash(policy));
});
