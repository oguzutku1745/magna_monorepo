import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ClaimId, ConstraintOp, CredentialType } from "@magna/core";
import { MAX_CONSTRAINTS, instagramHandleEqConstraint, normalizePolicy } from "./policy.js";

describe("policy normalization", () => {
  it("pads constraints up to MAX_CONSTRAINTS", () => {
    const normalized = normalizePolicy({
      credentialType: CredentialType.Passport,
      constraints: [{ claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n }],
    });
    assert.equal(normalized.constraints.length, MAX_CONSTRAINTS);
  });

  it("builds an instagram handle equality constraint", () => {
    assert.deepEqual(instagramHandleEqConstraint(123456n), {
      claimId: ClaimId.InstagramHandleHash,
      op: ConstraintOp.Eq,
      value: 123456n,
    });
  });
});
