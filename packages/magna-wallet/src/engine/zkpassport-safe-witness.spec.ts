import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  assertNoZkPassportPrivateArtifacts,
  computeZkPassportParameterCommitmentManifest,
  type MinimalZkPassportWitness,
} from "./zkpassport-safe-witness.js";

const witness: MinimalZkPassportWitness = {
  nationalityDisclosure: {
    discloseMask: [1, 1, 1],
    disclosedBytes: [84, 85, 82],
  },
  expiryDisclosure: {
    discloseMask: [1, 1, 1, 1, 1, 1],
    disclosedBytes: [51, 49, 48, 55, 50, 48],
  },
  agePredicate: {
    minAge: 18,
    maxAge: 255,
  },
  bind: {
    customData: "123456789",
  },
};

describe("computeZkPassportParameterCommitmentManifest", () => {
  it("returns deterministic decimal string commitments", async () => {
    const first = await computeZkPassportParameterCommitmentManifest(witness);
    const second = await computeZkPassportParameterCommitmentManifest(witness);

    assert.deepEqual(second, first);
    assert.match(first.nationalityDisclosureCommitment, /^[0-9]+$/);
    assert.match(first.expiryDisclosureCommitment, /^[0-9]+$/);
    assert.match(first.agePredicateCommitment, /^[0-9]+$/);
    assert.match(first.bindCommitment, /^[0-9]+$/);
  });
});

describe("assertNoZkPassportPrivateArtifacts", () => {
  it("rejects queryResult, committedInputs, outer public inputs, and raw PII keys", () => {
    for (const key of [
      "queryResult",
      "committedInputs",
      "outerPublicInputs",
      "expiryTs",
      "nationalityAlpha3",
      "uniqueIdentifier",
    ]) {
      assert.throws(
        () => assertNoZkPassportPrivateArtifacts({ [key]: "leak" }),
        /PII-bearing zkPassport artifact/,
      );
    }
  });

  it("allows the B pilot public payload shape", () => {
    assert.doesNotThrow(() =>
      assertNoZkPassportPrivateArtifacts({
        pilotSchema: "passport-pii-blind-v0",
        activeOwner: "0xactive",
        claimsHash: "123",
        ghostOwner: "0xghost",
        rootCommitment: "456",
        credentialValidUntil: "1893456000",
      }),
    );
  });
});
