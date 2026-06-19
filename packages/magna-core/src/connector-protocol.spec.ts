import test from "node:test";
import assert from "node:assert/strict";
import { ageGteConstraint, countryNeqConstraint } from "./policy.js";
import {
  assertLoginRequest,
  loginRequirementsToWire,
  policyFromWire,
  policyToWire,
  randomHex,
  type LoginRequest,
} from "./connector-protocol.js";

const policy = {
  credentialType: 1,
  constraints: [ageGteConstraint(18), countryNeqConstraint(5588289n)],
};

function request(overrides: Partial<LoginRequest> = {}): LoginRequest {
  return {
    v: 1,
    kind: "magna:login-request",
    clientId: "dapp_abc",
    origin: "http://localhost:5173",
    requestId: "11".repeat(16),
    sessionChallenge: "22".repeat(32),
    policy: policyToWire(policy),
    policyHash: "0x" + "33".repeat(32),
    responseMode: "postMessage",
    ...overrides,
  };
}

test("policy wire conversion round-trips bigint values as decimal strings", () => {
  const wire = policyToWire(policy);
  assert.equal(wire.constraints[0]?.value, "18");
  assert.deepEqual(policyFromWire(wire), policy);
});

test("policyFromWire rejects invalid or unbounded values", () => {
  assert.throws(() => policyFromWire({ credentialType: 999, constraints: [] } as never), /credentialType/);
  assert.throws(
    () => policyFromWire({ credentialType: 1, constraints: [{ claimId: 1, op: 3, value: "01" }] } as never),
    /canonical bounded decimal/,
  );
  assert.throws(
    () =>
      policyFromWire({
        credentialType: 1,
        constraints: Array.from({ length: 9 }, () => ({ claimId: 1, op: 3, value: "1" })),
      } as never),
    /at most 8/,
  );
});

test("assertLoginRequest validates request envelope shape", () => {
  assert.doesNotThrow(() => assertLoginRequest(request()));
  assert.throws(() => assertLoginRequest(request({ requestId: "zz".repeat(16) })), /requestId/);
  assert.throws(() => assertLoginRequest(request({ responseMode: "redirectCode" })), /redirectUri/);
});

test("assertLoginRequest accepts mixed login requirements", () => {
  const requirements = loginRequirementsToWire([
    { id: "passport", kind: "policy", policy },
    { id: "instagram", kind: "instagram-handle", handle: "akinspur" },
  ]);
  assert.doesNotThrow(() => assertLoginRequest(request({ requirements })));
  assert.throws(
    () => assertLoginRequest(request({ requirements: [{ id: "Instagram!", kind: "instagram-handle", handle: "akinspur" }] })),
    /requirement id/,
  );
  assert.throws(
    () => assertLoginRequest(request({ requirements: [{ id: "instagram", kind: "instagram-handle", handle: "@akinspur" }] })),
    /instagram handle/,
  );
});

test("randomHex returns lowercase hex of requested byte length", () => {
  assert.match(randomHex(16), /^[0-9a-f]{32}$/);
  assert.throws(() => randomHex(-1), /byteLength/);
});
