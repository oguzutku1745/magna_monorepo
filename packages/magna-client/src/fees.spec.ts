import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isVerificationSponsored } from "./fees.js";

describe("isVerificationSponsored", () => {
  it("returns true only when the credential type is explicitly allowed", () => {
    const policy = {
      allowCredentialTypes: [1, 4, 5],
      maxVerificationsPerEpoch: 5,
    };

    assert.equal(isVerificationSponsored(1, policy), true);
    assert.equal(isVerificationSponsored(5, policy), true);
    assert.equal(isVerificationSponsored(2, policy), false);
  });
});
