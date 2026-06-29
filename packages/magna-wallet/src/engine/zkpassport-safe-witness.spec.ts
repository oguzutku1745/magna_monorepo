import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  assertNoPassportA1OrchestratorArtifacts,
  assertNoZkPassportPrivateArtifacts,
  buildMinimalZkPassportWitnessFromDisclosures,
  buildPassportWrapperWitnessFromZkPassportResult,
  computeZkPassportParameterCommitmentManifest,
  computeZkPassportParameterCommitmentManifestCandidates,
  extractZkPassportOuterProofArtifacts,
  extractZkPassportOuterProofUtilityMetadata,
  type MinimalZkPassportWitness,
} from "./zkpassport-safe-witness.js";

const validOuterPublicInputs = ["0", "1", "2", "33", "44", "555", "666", "777", "888", "1", "999", "1000"];

function fieldHex(value: string | number | bigint): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function packedOuterProof(publicInputs: readonly (string | number | bigint)[] = validOuterPublicInputs): string {
  return [...publicInputs.map(fieldHex), "aa".repeat(32), "bb".repeat(32)].join("");
}

function outerPublicInputsForManifest(
  manifest: Awaited<ReturnType<typeof computeZkPassportParameterCommitmentManifest>>,
  order: readonly (keyof typeof manifest)[] = [
    "nationalityDisclosureCommitment",
    "expiryDisclosureCommitment",
    "agePredicateCommitment",
    "bindCommitment",
  ],
): string[] {
  return [
    "0",
    "1",
    "2",
    "33",
    "44",
    ...order.map(key => manifest[key]),
    "1",
    "999",
    "1000",
  ];
}

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
    maxAge: 0,
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
    assert.equal(first.nationalityDisclosureCommitment, first.expiryDisclosureCommitment);
  });

  it("returns passport and ID-card MRZ disclosure layout candidates", async () => {
    const candidates = await computeZkPassportParameterCommitmentManifestCandidates(witness);
    const passport = candidates.find(candidate => candidate.layout === "passport");
    const idCard = candidates.find(candidate => candidate.layout === "id_card");

    assert.ok(passport);
    assert.ok(idCard);
    assert.notEqual(
      passport.manifest.nationalityDisclosureCommitment,
      idCard.manifest.nationalityDisclosureCommitment,
    );
    assert.notEqual(
      passport.manifest.expiryDisclosureCommitment,
      idCard.manifest.expiryDisclosureCommitment,
    );
    assert.equal(
      passport.manifest.nationalityDisclosureCommitment,
      passport.manifest.expiryDisclosureCommitment,
    );
    assert.equal(
      idCard.manifest.nationalityDisclosureCommitment,
      idCard.manifest.expiryDisclosureCommitment,
    );
    assert.equal(passport.manifest.agePredicateCommitment, idCard.manifest.agePredicateCommitment);
    assert.equal(passport.manifest.bindCommitment, idCard.manifest.bindCommitment);
  });
});

describe("buildMinimalZkPassportWitnessFromDisclosures", () => {
  it("encodes disclosed nationality, MRZ expiry date, age predicate, and bind data", () => {
    const minimalWitness = buildMinimalZkPassportWitnessFromDisclosures({
      nationalityAlpha3: "TUR",
      expiryTs: 1_942_358_399n,
      agePredicate: { minAge: 18, maxAge: 0 },
      bind: { customData: "magna-wrapper-bind" },
    });

    assert.deepEqual(minimalWitness.nationalityDisclosure, {
      discloseMask: [1, 1, 1],
      disclosedBytes: [84, 85, 82],
    });
    assert.deepEqual(minimalWitness.expiryDisclosure, {
      discloseMask: [1, 1, 1, 1, 1, 1],
      disclosedBytes: [51, 49, 48, 55, 50, 48],
    });
    assert.deepEqual(minimalWitness.agePredicate, { minAge: 18, maxAge: 0 });
    assert.deepEqual(minimalWitness.bind, { customData: "magna-wrapper-bind" });
  });
});

describe("extractZkPassportOuterProofArtifacts", () => {
  it("extracts outer proof artifacts from a compressed proofs entry", () => {
    const extracted = extractZkPassportOuterProofArtifacts({
      status: "verified",
      proofs: [
        {
          outerProof: { proof: "outer-proof-bytes", verificationKey: "vk" },
          outerPublicInputs: validOuterPublicInputs,
        },
      ],
    });

    assert.equal(extracted.outerProof.proof, "outer-proof-bytes");
    assert.equal(extracted.outerProof.verificationKey, "vk");
    assert.deepEqual(extracted.outerPublicInputs, validOuterPublicInputs);
    assert.deepEqual(extracted.shape, {
      proofPath: "proofs[0].outerProof.proof",
      publicInputsPath: "proofs[0].outerPublicInputs",
    });
  });

  it("extracts proof/public inputs from representative nested SDK result shapes", () => {
    const direct = extractZkPassportOuterProofArtifacts({
      proof: "direct-proof",
      publicInputs: validOuterPublicInputs,
    });
    assert.equal(direct.outerProof.proof, "direct-proof");
    assert.deepEqual(direct.outerPublicInputs, validOuterPublicInputs);
    assert.deepEqual(direct.shape, {
      proofPath: "proof",
      publicInputsPath: "publicInputs",
    });

    const nested = extractZkPassportOuterProofArtifacts({
      proofs: [
        {
          proof: {
            proof: Uint8Array.from([1, 2, 3]),
            publicInputs: validOuterPublicInputs,
          },
        },
      ],
    });
    assert(nested.outerProof.proof instanceof Uint8Array);
    assert.deepEqual(nested.outerPublicInputs, validOuterPublicInputs);
    assert.deepEqual(nested.shape, {
      proofPath: "proofs[0].proof.proof",
      publicInputsPath: "proofs[0].proof.publicInputs",
    });
  });

  it("derives public inputs from a live SDK-style outer EVM ProofResult without copying committedInputs", () => {
    const extracted = extractZkPassportOuterProofArtifacts({
      status: "verified",
      proofs: [
        {
          proof: packedOuterProof(),
          name: "outer_evm_7",
          vkeyHash: "0x1234",
          version: "0.15.1",
          index: 0,
          total: 1,
          committedInputs: { disclose_bytes_evm: { disclosedBytes: [84, 85, 82] } },
        },
      ],
    });

    assert.equal(extracted.outerProof.proof, packedOuterProof());
    assert.equal(extracted.outerProof.name, "outer_evm_7");
    assert.equal(extracted.outerProof.version, "0.15.1");
    assert.equal(extracted.outerProof.vkeyHash, "0x1234");
    assert.equal(extracted.outerProof.index, 0);
    assert.equal(extracted.outerProof.total, 1);
    assert.deepEqual(extracted.outerPublicInputs, validOuterPublicInputs.map(value => `0x${fieldHex(value)}`));
    assert.equal("committedInputs" in extracted.outerProof, false);
    assert.deepEqual(extracted.shape, {
      proofPath: "proofs[0].proof",
      publicInputsPath: "proofs[0].proof.derivedPublicInputs",
    });
  });

  it("rejects unsupported shapes instead of inventing recursive verification inputs", () => {
    assert.throws(
      () => extractZkPassportOuterProofArtifacts({ status: "verified", proofs: [{ proof: "missing-inputs" }] }),
      /Could not find zkPassport outer proof and public inputs/,
    );
  });

  it("rejects malformed SDK-style outer EVM ProofResults", () => {
    assert.throws(
      () =>
        extractZkPassportOuterProofArtifacts({
          status: "verified",
          proofs: [
            {
              proof: "outer-proof-with-packed-public-inputs",
              name: "outer_evm_5",
              vkeyHash: "0xvkey",
              committedInputs: { disclose_bytes_evm: { disclosedBytes: [84, 85, 82] } },
            },
          ],
        }),
      /version must be a non-empty string/,
    );
    assert.throws(
      () =>
        extractZkPassportOuterProofArtifacts({
          status: "verified",
          proofs: [
            {
              proof: "not-hex",
              name: "outer_evm_5",
              vkeyHash: "0xvkey",
              version: "0.15.1",
            },
          ],
        }),
      /proofs\[0\]\.proof must be an even-length hex string/,
    );
  });

  it("rejects missing, empty, and unsupported proof payloads", () => {
    for (const proof of [undefined, null, "", [], {}, { bytes: [] }, { unknown: "shape" }]) {
      assert.throws(
        () => extractZkPassportOuterProofArtifacts({ proof, publicInputs: validOuterPublicInputs }),
        /zkPassport outer proof/,
      );
    }
  });

  it("rejects negative, unsafe, and short outer public inputs", () => {
    assert.throws(
      () =>
        extractZkPassportOuterProofArtifacts({
          proof: "proof-bytes",
          publicInputs: ["0", -2, "2", "33", "44", "555", "666", "1", "999", "1000"],
        }),
      /publicInputs\[1\] must be non-negative/,
    );
    assert.throws(
      () =>
        extractZkPassportOuterProofArtifacts({
          proof: "proof-bytes",
          publicInputs: [
            Number.MAX_SAFE_INTEGER + 1,
            "1",
            "2",
            "33",
            "44",
            "555",
            "666",
            "1",
            "999",
            "1000",
          ],
        }),
      /publicInputs\[0\] must be a safe integer/,
    );
    assert.throws(
      () => extractZkPassportOuterProofArtifacts({ proof: "proof-bytes", publicInputs: ["1", "2"] }),
      /must contain at least 8 field values/,
    );
  });
});

describe("buildPassportWrapperWitnessFromZkPassportResult", () => {
  it("builds the local-only wrapper witness shape with a parity commitment manifest", async () => {
    const input = {
      nationalityAlpha3: "TUR",
      expiryTs: 1_942_358_399n,
      minAgeProven: 18,
      credentialValidUntil: 1_893_456_000n,
      agePredicate: { minAge: 18, maxAge: 0 },
      bind: { customData: "magna-wrapper-bind" },
      nationalityBlind: 111n,
      expiryBlind: 222n,
      scopedNullifier: 999n,
    };
    const expectedManifest = await computeZkPassportParameterCommitmentManifest(
      buildMinimalZkPassportWitnessFromDisclosures(input),
    );
    const shuffledOuterPublicInputs = outerPublicInputsForManifest(expectedManifest, [
      "agePredicateCommitment",
      "nationalityDisclosureCommitment",
      "bindCommitment",
      "expiryDisclosureCommitment",
    ]);
    const result = await buildPassportWrapperWitnessFromZkPassportResult(
      {
        status: "verified",
        outerProof: "outer-proof-bytes",
        outerPublicInputs: shuffledOuterPublicInputs,
      },
      input,
    );

    assert.equal(result.zkPassportOuterProof.proof, "outer-proof-bytes");
    assert.deepEqual(result.zkPassportOuterPublicInputs, shuffledOuterPublicInputs);
    assert.deepEqual(result.minimalZkPassportWitness.nationalityDisclosure.disclosedBytes, [84, 85, 82]);
    assert.deepEqual(result.minimalZkPassportWitness.expiryDisclosure.disclosedBytes, [51, 49, 48, 55, 50, 48]);
    assert.equal(result.nationalityAlpha3, "TUR");
    assert.equal(result.expiryTs, 1_942_358_399n);
    assert.equal(result.credentialValidUntil, 1_893_456_000n);
    assert.equal(result.nationalityBlind, 111n);
    assert.equal(result.expiryBlind, 222n);
    assert.equal(result.scopedNullifier, 999n);
    assert.deepEqual(result.expectedParameterCommitmentManifest, expectedManifest);
  });
});

describe("assertNoZkPassportPrivateArtifacts", () => {
  it("rejects queryResult, committedInputs, outer public inputs, parameter commitments, and raw PII keys", () => {
    for (const key of [
      "proofs",
      "queryResult",
      "committedInputs",
      "outerProof",
      "outerPublicInputs",
      "publicInputs",
      "paramCommitments",
      "parameterCommitments",
      "parameterCommitmentManifest",
      "nationalityDisclosureCommitment",
      "expiryDisclosureCommitment",
      "agePredicateCommitment",
      "bindCommitment",
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

describe("assertNoPassportA1OrchestratorArtifacts", () => {
  it("allows non-PII A1 proof artifacts and public inputs", () => {
    assert.doesNotThrow(() =>
      assertNoPassportA1OrchestratorArtifacts({
        schema: "passport-a1-v1",
        activeOwner: "0xactive",
        ghostOwner: "0xghost",
        rootCommitment: "456",
        credentialValidUntil: "1893456000",
        claimsHash: "123",
        wrapperProof: {
          proof: "wrapper-proof",
          publicInputs: ["1", "2", "3", "18", "1893456000", "999", "555", "666", "777", "888"],
        },
        wrapperPublicInputs: ["1", "2", "3", "18", "1893456000", "999", "555", "666", "777", "888"],
        zkPassportOuterProof: {
          proof: "outer-proof",
          verificationKey: "vk",
        },
        zkPassportOuterPublicInputs: validOuterPublicInputs,
      }),
    );
  });

  it("rejects cleartext passport PII and local A1 witness secrets", () => {
    for (const key of [
      "queryResult",
      "originalQuery",
      "committedInputs",
      "nationality",
      "nationalityAlpha3",
      "expiry_date",
      "passportExpiryDate",
      "expiryTs",
      "uniqueIdentifier",
      "nationalityBlind",
      "expiryBlind",
      "localWitness",
      "minimalZkPassportWitness",
    ]) {
      assert.throws(
        () => assertNoPassportA1OrchestratorArtifacts({ schema: "passport-a1-v1", [key]: "leak" }),
        /PII-bearing zkPassport artifact/,
      );
    }
  });
});

describe("extractZkPassportOuterProofUtilityMetadata", () => {
  it("matches installed @zkpassport/utils outer proof public input parsers", async () => {
    const utils = (await import("@zkpassport/utils")) as Record<string, unknown>;

    assert.equal(typeof utils.getDiscloseEVMParameterCommitment, "function");
    assert.equal(typeof utils.getAgeEVMParameterCommitment, "function");
    assert.equal(typeof utils.getBindEVMParameterCommitment, "function");
    assert.equal(typeof utils.getParamCommitmentsFromOuterProof, "function");
    assert.equal(typeof utils.getNullifierFromOuterProof, "function");
    assert.deepEqual(extractZkPassportOuterProofUtilityMetadata(validOuterPublicInputs), {
      parameterCommitments: ["555", "666", "777", "888"],
      scopedNullifier: "999",
      nullifierType: "1",
      scope: "33",
      subscope: "44",
    });
  });
});
