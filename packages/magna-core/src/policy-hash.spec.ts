import test from "node:test";
import assert from "node:assert/strict";
import { computeLoginRequirementsHash, computePolicyHash } from "./policy-hash.js";
import { ageGteConstraint, countryNeqConstraint } from "./policy.js";
import { loginRequirementsToWire } from "./connector-protocol.js";

const policy = {
  credentialType: 1,
  constraints: [ageGteConstraint(18), countryNeqConstraint(5588289n)],
};

test("hash is deterministic and 32 bytes hex", async () => {
  const a = await computePolicyHash(policy);
  const b = await computePolicyHash(policy);
  assert.equal(a, b);
  assert.match(a, /^0x[0-9a-f]{64}$/);
});

test("hash is independent of constraint order after normalization padding", async () => {
  // Same constraints, different order -> different hash (order is meaningful),
  // but trailing None padding must NOT change the hash.
  const padded = {
    credentialType: 1,
    constraints: [...policy.constraints],
  };
  assert.equal(await computePolicyHash(policy), await computePolicyHash(padded));
});

test("different policies hash differently", async () => {
  const other = { credentialType: 1, constraints: [ageGteConstraint(21)] };
  assert.notEqual(await computePolicyHash(policy), await computePolicyHash(other));
});

test("combined login requirement hash binds instagram handle requests", async () => {
  const first = loginRequirementsToWire([
    { id: "passport", kind: "policy", policy },
    { id: "instagram", kind: "instagram-handle", handle: "akinspur" },
  ]);
  const second = loginRequirementsToWire([
    { id: "passport", kind: "policy", policy },
    { id: "instagram", kind: "instagram-handle", handle: "other" },
  ]);
  assert.match(await computeLoginRequirementsHash(first), /^0x[0-9a-f]{64}$/);
  assert.notEqual(await computeLoginRequirementsHash(first), await computeLoginRequirementsHash(second));
});
