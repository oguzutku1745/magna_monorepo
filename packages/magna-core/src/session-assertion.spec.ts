import test from "node:test";
import assert from "node:assert/strict";
import { ageGteConstraint, CredentialType } from "./index.js";
import { sessionAuthorizationFields } from "./session-assertion.js";

test("session authorization fields bind gateway, request, challenge, expiry, index, and normalized policy", () => {
  const fields = sessionAuthorizationFields({
    consumerGatewayAddress: `0x${"11".repeat(32)}`,
    requestId: "22".repeat(16),
    sessionChallenge: `00${"33".repeat(31)}`,
    expiresAt: 1_800_000_000,
    requirementIndex: 1,
    policy: { credentialType: CredentialType.Passport, constraints: [ageGteConstraint(18)] },
  });
  assert.equal(fields.length, 31);
  assert.equal(fields[0], 2n);
  assert.equal(fields[5], 1n);
  assert.equal(fields[6], BigInt(CredentialType.Passport));
  assert.deepEqual(fields.slice(7, 10), [1n, 3n, 18n]);
  assert.deepEqual(fields.slice(-3), [0n, 0n, 0n]);
});

test("session authorization rejects non-field hex and invalid requirement indexes", () => {
  const base = {
    consumerGatewayAddress: `0x${"11".repeat(32)}`,
    requestId: "22".repeat(16),
    sessionChallenge: `00${"33".repeat(31)}`,
    expiresAt: 1_800_000_000,
    requirementIndex: 0,
    policy: { credentialType: CredentialType.Passport, constraints: [] },
  };
  assert.throws(() => sessionAuthorizationFields({ ...base, requestId: "GG" }), /hexadecimal/);
  assert.throws(
    () => sessionAuthorizationFields({ ...base, sessionChallenge: "ff".repeat(32) }),
    /field modulus/,
  );
  assert.throws(() => sessionAuthorizationFields({ ...base, requirementIndex: 256 }), /u8/);
});
