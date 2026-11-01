import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { MagnaClient, validateLoginResponse, verifyAztecSessionAuthorization, type MagnaClientConfig, type SessionChainVerifier, type WindowImpl } from "./connector.js";
import { ageGteConstraint, computePolicyHash, CredentialType, MAGNA_SESSION_AUTHORIZATION_DS, sessionAuthorizationFields, type SessionAssertion } from "@magna-protocol/core";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { DomainSeparator } from "@aztec-labs/constants";
import { poseidon2HashWithSeparator } from "@aztec-labs/foundation/crypto/sync";

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

function popupHarness(overrides: Partial<MagnaClientConfig> = {}) {
  type Event = { origin: string; data: unknown; source: unknown };
  let listener: ((event: Event) => void) | undefined;
  const opened: { url: string; popup: ReturnType<typeof makePopup> }[] = [];
  const posted: Record<string, unknown>[] = [];
  const navigated: string[] = [];
  let removed = 0;
  const makePopup = () => ({
    closed: false,
    closes: 0,
    location: { replace: (url: string) => { navigated.push(url); } },
    postMessage: (message: unknown, origin: string) => {
      assert.equal(origin, "http://localhost:5999");
      posted.push(message as Record<string, unknown>);
    },
    close() { this.closed = true; this.closes++; },
  });
  const windowImpl: WindowImpl = {
    origin: "http://localhost:5173",
    open: url => {
      const popup = makePopup();
      opened.push({ url, popup });
      return popup;
    },
    addMessageListener: fn => {
      listener = fn;
      return () => { listener = undefined; removed++; };
    },
  };
  const client = new MagnaClient(popupConfig({ timeoutMs: 100, windowImpl, ...overrides }));
  const emit = (data: unknown, source: unknown = opened.at(-1)?.popup, origin = "http://localhost:5999") => {
    listener?.({ origin, source, data });
  };
  const ready = async () => {
    for (let i = 0; i < 100 && !(navigated.length || (opened.length && opened[0].url !== "about:blank" && listener)); i++) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    emit({ kind: "magna:ready" });
  };
  const start = () => {
    const result = client.login(policy);
    void result.catch(() => undefined);
    return result;
  };
  const response = () => {
    const request = posted.at(-1)!;
    const now = Math.floor(Date.now() / 1000);
    return {
      kind: "magna:login-response", requestId: request.requestId,
      assertion: {
        v: 2, clientId: request.clientId, origin: request.origin,
        requestId: request.requestId, sessionChallenge: request.sessionChallenge,
        policyHash: request.policyHash, verified: true, issuedAt: now, expiresAt: now + 300,
        authorizationContract: sponsor, receipt: txHash,
        receipts: [{ id: "default", kind: "policy", receipt: txHash }],
      },
    };
  };
  return { client, opened, posted, navigated, emit, ready, start, response, get removed() { return removed; } };
}

for (const mode of ["policy", "requirements"] as const) {
  test(`MagnaClient reserves the ${mode} login window during the initiating gesture`, async () => {
    const h = popupHarness();
    const result = mode === "policy" ? h.start()
      : h.client.loginWithRequirements([{ id: "default", kind: "policy", policy }]);
    void result.catch(() => undefined);
    const openedSynchronously = h.opened.length;
    await assert.rejects(result, /timed out/);
    assert.equal(openedSynchronously, 1);
    assert.equal(h.opened[0].url, "about:blank");
    assert.deepEqual(h.navigated, ["http://localhost:5999/authorize"]);
  });
}

test("MagnaClient closes the owned window and removes listeners on timeout", async () => {
  const h = popupHarness();
  await assert.rejects(h.start(), /timed out/);
  assert.equal(h.opened[0].popup.closed, true);
  assert.equal(h.removed, 1);
});

test("MagnaClient rejects overlapping calls without opening another window", async () => {
  const h = popupHarness();
  const first = h.start();
  const second = h.start();
  await assert.rejects(second, /already in progress/);
  await assert.rejects(first, /timed out/);
  assert.equal(h.opened.length, 1);
});

test("MagnaClient ignores wrong origin and same-origin messages from another window", async () => {
  const h = popupHarness();
  const result = h.start();
  await h.ready();
  h.posted.length = 0;
  // Start another request so the first ready message cannot mask source filtering.
  h.emit({ kind: "magna:login-error", requestId: "unknown", error: "x" }, {}, "http://evil.example");
  await assert.rejects(result, /timed out/);
  const retry = h.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  h.emit({ kind: "magna:ready" }, {}, "http://evil.example");
  h.emit({ kind: "magna:ready" }, {});
  assert.equal(h.posted.length, 0);
  h.emit({ kind: "magna:ready" });
  h.emit({ kind: "magna:ready" });
  assert.equal(h.posted.length, 1);
  assert.match(h.posted[0].sessionChallenge as string, /^00[0-9a-f]{62}$/);
  h.emit({ kind: "magna:login-error", requestId: h.posted[0].requestId, error: "denied" });
  await assert.rejects(retry, /denied/);
});

test("MagnaClient closes an authorization error and allows a clean retry", async () => {
  const h = popupHarness();
  const first = h.start();
  await h.ready();
  h.emit({ kind: "magna:login-error", requestId: h.posted[0].requestId, error: "denied" });
  await assert.rejects(first, /denied/);
  assert.equal(h.opened[0].popup.closed, true);
  const retry = h.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  h.emit({ kind: "magna:ready" });
  h.emit(h.response());
  assert.equal((await retry).verified, true);
  assert.equal(h.opened.length, 2);
  assert.equal(h.opened[1].popup.closed, true);
  assert.equal(h.removed, 2);
});

test("MagnaClient accepts only its window response and stays busy until chain validation settles", async () => {
  let release!: () => void;
  let entered = false;
  const h = popupHarness({ timeoutMs: 1000, chainVerifier: async () => {
    entered = true;
    await new Promise<void>(resolve => { release = resolve; });
  } });
  const result = h.start();
  await h.ready();
  h.emit({ kind: "magna:login-error", requestId: h.posted[0].requestId, error: "wrong window" }, {});
  h.emit(h.response());
  for (let i = 0; i < 100 && !entered; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(entered, true);
  const overlap = h.start();
  release();
  await assert.rejects(overlap, /already in progress/);
  assert.equal((await result).verified, true);
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].popup.closes, 1);
});

test("MagnaClient detects cancellation and permits retry", async () => {
  const h = popupHarness({ timeoutMs: 2000 });
  const result = h.start();
  await h.ready();
  h.opened[0].popup.closed = true;
  await assert.rejects(result, /window was closed/);
  const retry = h.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  h.emit({ kind: "magna:ready" });
  h.emit(h.response());
  assert.equal((await retry).verified, true);
  assert.equal(h.removed, 2);
});

test("MagnaClient can retry after a browser blocks the window", async () => {
  let calls = 0;
  const client = new MagnaClient(popupConfig({ windowImpl: {
    origin: "http://localhost:5173",
    open: () => { calls++; return null; },
    addMessageListener: () => { throw new Error("unexpected listener"); },
  } }));
  await assert.rejects(client.login(policy), /popup blocked/);
  await assert.rejects(client.login(policy), /popup blocked/);
  assert.equal(calls, 2);
});

test("MagnaClient times out stalled chain validation and allows a successful retry", async () => {
  let calls = 0;
  const h = popupHarness({ chainVerifier: async () => {
    if (++calls === 1) await new Promise<void>(() => {});
  } });
  const first = h.start();
  await h.ready();
  h.emit(h.response());
  const outcome = await Promise.race([
    first.then(() => "unexpected success", error => String(error.message)),
    new Promise<string>(resolve => setTimeout(() => resolve("deadline missing"), 250)),
  ]);
  assert.match(outcome, /timed out/);
  const retry = h.start();
  await new Promise(resolve => setTimeout(resolve, 10));
  h.emit({ kind: "magna:ready" });
  h.emit(h.response());
  assert.equal((await retry).verified, true);
  assert.equal(calls, 2);
  assert.equal(h.removed, 2);
});

for (const lateOutcome of ["resolve", "reject"] as const) {
  test(`late validation ${lateOutcome} cannot settle or unlock a retry`, async () => {
    let completeFirst!: () => void;
    let completeRetry!: () => void;
    let calls = 0;
    const h = popupHarness({ timeoutMs: 150, chainVerifier: async () => {
      if (++calls === 1) {
        await new Promise<void>((resolve, reject) => {
          completeFirst = lateOutcome === "resolve" ? resolve : () => reject(new Error("late RPC failure"));
        });
      } else {
        await new Promise<void>(resolve => { completeRetry = resolve; });
      }
    } });
    const first = h.start();
    await h.ready();
    h.emit(h.response());
    try {
      const outcome = await Promise.race([
        first.then(() => "unexpected success", error => String(error.message)),
        new Promise<string>(resolve => setTimeout(() => resolve("deadline missing"), 300)),
      ]);
      assert.match(outcome, /timed out/);
      const retry = h.start();
      let retrySettled = false;
      void retry.then(() => { retrySettled = true; }, () => { retrySettled = true; });
      await new Promise(resolve => setTimeout(resolve, 10));
      h.emit({ kind: "magna:ready" });
      h.emit(h.response());
      completeFirst();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.equal(retrySettled, false);
      const overlap = h.start();
      completeRetry();
      await assert.rejects(overlap, /already in progress/);
      assert.equal((await retry).verified, true);
      assert.equal(h.opened.length, 2);
    } finally {
      completeFirst?.();
      completeRetry?.();
    }
  });
}
