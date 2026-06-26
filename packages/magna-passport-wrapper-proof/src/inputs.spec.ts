import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { CredentialType } from "@magna/core";
import {
  computePassportCommittedClaimsHash,
  computePassportExpiryCommitment,
  computePassportNationalityCommitment,
  computeZkPassportParameterCommitmentManifest,
  buildPassportWrapperWitnessFromZkPassportResult,
  poseidon2FieldHasher,
  type MinimalZkPassportWitness,
} from "@magna/wallet";
import { buildPassportWrapperInputs } from "./inputs.js";
import type { PassportWrapperLocalWitness } from "./types.js";

const minimalZkPassportWitness: MinimalZkPassportWitness = {
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
    customData: "magna-wrapper-bind",
  },
};

const normalizedOuterPublicInputs = ["0", "1", "2", "33", "44", "555", "666", "1", "999", "1000"];

function validWitness(): PassportWrapperLocalWitness {
  return {
    zkPassportOuterProof: {
      proof: { placeholder: "task-3-recursive-proof" },
      metadata: { source: "fixture" },
    },
    zkPassportOuterPublicInputs: ["101", "202"],
    minimalZkPassportWitness,
    nationalityAlpha3: "TUR",
    expiryTs: 1_942_358_399n,
    minAgeProven: 18,
    credentialValidUntil: 1_893_456_000n,
    agePredicate: {
      minAge: 18,
      maxAge: 255,
    },
    bind: {
      customData: "magna-wrapper-bind",
    },
    nationalityBlind: 111n,
    expiryBlind: 222n,
  };
}

describe("buildPassportWrapperInputs", () => {
  it("builds fixed-order public inputs from wallet passport commitment helpers", async () => {
    const witness = validWitness();
    const result = await buildPassportWrapperInputs(witness);
    const nationalityCommitment = computePassportNationalityCommitment(
      "TUR",
      111n,
      poseidon2FieldHasher,
    );
    const expiryCommitment = computePassportExpiryCommitment(
      1_942_358_399n,
      222n,
      poseidon2FieldHasher,
    );
    const claimsHash = computePassportCommittedClaimsHash(
      {
        schemaVersion: 2,
        credentialType: CredentialType.Passport,
        nationalityCommitment,
        minAgeProven: 18,
        expiryCommitment,
      },
      poseidon2FieldHasher,
    );

    assert.deepEqual(result.publicInputs, [
      claimsHash.toString(),
      nationalityCommitment.toString(),
      expiryCommitment.toString(),
      "18",
      "1893456000",
      "0",
    ]);
    assert.equal(result.outputs.claimsHash, claimsHash.toString());
    assert.equal(result.outputs.nationalityCommitment, nationalityCommitment.toString());
    assert.equal(result.outputs.expiryCommitment, expiryCommitment.toString());
    assert.equal(result.outputs.minAgeProven, 18);
    assert.equal(result.outputs.credentialValidUntil, "1893456000");
    assert.equal(result.outputs.scopedNullifier, "0");
    assert.equal(result.inputs.expected_claims_hash, claimsHash.toString());
    assert.equal(result.metadata.outerProofVerification, "not_implemented_task_3");
  });

  it("preserves an accepted scoped nullifier as fixed public input six", async () => {
    const result = await buildPassportWrapperInputs({
      ...validWitness(),
      scopedNullifier: 999n,
    });

    assert.equal(result.publicInputs[5], "999");
    assert.equal(result.outputs.scopedNullifier, "999");
    assert.equal(result.inputs.expected_scoped_nullifier, "999");
  });

  it("rejects declared public outputs that do not match the local witness", async () => {
    const result = await buildPassportWrapperInputs(validWitness());
    await assert.rejects(
      () =>
        buildPassportWrapperInputs(validWitness(), {
          declaredPublicOutputs: {
            ...result.outputs,
            nationalityCommitment: (BigInt(result.outputs.nationalityCommitment) + 1n).toString(),
          },
        }),
      /nationalityCommitment does not match/,
    );
    await assert.rejects(
      () =>
        buildPassportWrapperInputs(validWitness(), {
          declaredPublicOutputs: {
            ...result.outputs,
            expiryCommitment: (BigInt(result.outputs.expiryCommitment) + 1n).toString(),
          },
        }),
      /expiryCommitment does not match/,
    );
  });

  it("rejects age and bind witnesses that do not match local structured inputs", async () => {
    await assert.rejects(
      () =>
        buildPassportWrapperInputs({
          ...validWitness(),
          minAgeProven: 17,
        }),
      /minAgeProven must satisfy/,
    );
    await assert.rejects(
      () =>
        buildPassportWrapperInputs({
          ...validWitness(),
          bind: { customData: "different-bind" },
        }),
      /bind data does not match/,
    );
  });

  it("rejects nationality disclosures that do not match local committed nationality", async () => {
    await assert.rejects(
      () =>
        buildPassportWrapperInputs({
          ...validWitness(),
          minimalZkPassportWitness: {
            ...minimalZkPassportWitness,
            nationalityDisclosure: {
              discloseMask: [1, 1, 1],
              disclosedBytes: [85, 83, 65],
            },
          },
        }),
      /nationalityAlpha3 does not match/,
    );
  });

  it("rejects expiry disclosures that do not match local committed expiry timestamp", async () => {
    await assert.rejects(
      () =>
        buildPassportWrapperInputs({
          ...validWitness(),
          minimalZkPassportWitness: {
            ...minimalZkPassportWitness,
            expiryDisclosure: {
              discloseMask: [1, 1, 1, 1, 1, 1],
              disclosedBytes: [51, 49, 48, 55, 50, 49],
            },
          },
        }),
      /expiryTs does not match/,
    );
  });

  it("rejects stale zkPassport parameter commitment metadata", async () => {
    const expectedParameterCommitmentManifest =
      await computeZkPassportParameterCommitmentManifest(minimalZkPassportWitness);

    await assert.rejects(
      () =>
        buildPassportWrapperInputs({
          ...validWitness(),
          expectedParameterCommitmentManifest: {
            ...expectedParameterCommitmentManifest,
            bindCommitment: (
              BigInt(expectedParameterCommitmentManifest.bindCommitment) + 1n
            ).toString(),
          },
        }),
      /bindCommitment does not match/,
    );
  });

  it("accepts a wrapper witness normalized by the wallet safe-witness helper", async () => {
    const walletWitness = await buildPassportWrapperWitnessFromZkPassportResult(
      {
        outerProof: { proof: { bytes: [1, 2, 3] }, verificationKey: { key: "vk" } },
        outerPublicInputs: normalizedOuterPublicInputs,
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

    const result = await buildPassportWrapperInputs(walletWitness);

    assert.equal(result.outputs.minAgeProven, 18);
    assert.equal(result.outputs.credentialValidUntil, "1893456000");
    assert.equal(result.outputs.scopedNullifier, "999");
    assert.equal(result.metadata.zkPassportOuterPublicInputsCount, normalizedOuterPublicInputs.length);
    assert.deepEqual(
      result.metadata.parameterCommitmentManifest,
      walletWitness.expectedParameterCommitmentManifest,
    );
  });
});
