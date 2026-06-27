import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildPassportWrapperWitnessFromZkPassportResult } from "@magna/wallet";
import { parsePassportWrapperPublicInputs, provePassportWrapper } from "./prove.js";
import { verifyPassportWrapperProof } from "./verify.js";

describe("parsePassportWrapperPublicInputs", () => {
  it("parses the fixed passport wrapper public input order", () => {
    assert.deepEqual(
      parsePassportWrapperPublicInputs(["1", "2", "3", "18", "1893456000", "0", "11", "12", "13", "14"]),
      {
        claimsHash: "1",
        nationalityCommitment: "2",
        expiryCommitment: "3",
        minAgeProven: 18,
        credentialValidUntil: "1893456000",
        scopedNullifier: "0",
        nationalityDisclosureCommitment: "11",
        expiryDisclosureCommitment: "12",
        agePredicateCommitment: "13",
        bindCommitment: "14",
      },
    );
  });

  it("rejects malformed public input lengths", () => {
    assert.throws(
      () => parsePassportWrapperPublicInputs(["1", "2", "3", "18", "1893456000", "0"]),
      /exactly 10 public inputs/,
    );
  });

  it("rejects malformed or unsafe minAgeProven public inputs", () => {
    for (const value of ["not-a-number", "-1", "18.5", "9007199254740992", "256"]) {
      assert.throws(
        () => parsePassportWrapperPublicInputs(["1", "2", "3", value, "1893456000", "0", "11", "12", "13", "14"]),
        /public input/,
      );
    }
  });
});

describe("passport wrapper proving", () => {
  it("generates and verifies a real wrapper proof with proof-bound public inputs", async () => {
    const witness = await buildPassportWrapperWitnessFromZkPassportResult(
      {
        outerProof: { proof: { bytes: [1, 2, 3] }, verificationKey: { key: "vk" } },
        outerPublicInputs: ["0", "1", "2", "33", "44", "555", "666", "1", "999", "1000"],
      },
      {
        nationalityAlpha3: "TUR",
        expiryTs: 1_942_358_399n,
        minAgeProven: 18,
        credentialValidUntil: 1_893_456_000n,
        agePredicate: { minAge: 18, maxAge: 255 },
        bind: { customData: "magna-wrapper-bind" },
        nationalityBlind: 111n,
        expiryBlind: 222n,
        scopedNullifier: 999n,
      },
    );

    const artifact = await provePassportWrapper(witness);

    assert.equal(artifact.publicInputs.length, 10);
    assert.equal(await verifyPassportWrapperProof(artifact.proof), true);
  });
});
