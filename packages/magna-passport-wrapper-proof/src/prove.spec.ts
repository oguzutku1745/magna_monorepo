import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { ProofData } from "@aztec/bb.js";
import { parsePassportWrapperPublicInputs, provePassportWrapper } from "./prove.js";
import { verifyPassportWrapperProof } from "./verify.js";
import type { PassportWrapperLocalWitness } from "./types.js";

describe("parsePassportWrapperPublicInputs", () => {
  it("parses the fixed passport wrapper public input order", () => {
    assert.deepEqual(
      parsePassportWrapperPublicInputs(["1", "2", "3", "18", "1893456000", "0"]),
      {
        claimsHash: "1",
        nationalityCommitment: "2",
        expiryCommitment: "3",
        minAgeProven: 18,
        credentialValidUntil: "1893456000",
        scopedNullifier: "0",
      },
    );
  });

  it("rejects malformed public input lengths", () => {
    assert.throws(
      () => parsePassportWrapperPublicInputs(["1", "2", "3", "18", "1893456000"]),
      /exactly 6 public inputs/,
    );
  });

  it("rejects malformed or unsafe minAgeProven public inputs", () => {
    for (const value of ["not-a-number", "-1", "18.5", "9007199254740992", "256"]) {
      assert.throws(
        () => parsePassportWrapperPublicInputs(["1", "2", "3", value, "1893456000", "0"]),
        /minAgeProven public input/,
      );
    }
  });
});

describe("Task 2 recursive zkPassport boundary", () => {
  it("does not prove until the caller explicitly acknowledges missing recursive verification", async () => {
    await assert.rejects(
      () => provePassportWrapper({} as PassportWrapperLocalWitness),
      /blocked until Task 3 wires recursive zkPassport outer proof verification/,
    );
  });

  it("does not verify until the caller explicitly acknowledges missing recursive verification", async () => {
    await assert.rejects(
      () => verifyPassportWrapperProof({} as ProofData),
      /blocked until Task 3 wires recursive zkPassport outer proof verification/,
    );
  });
});
