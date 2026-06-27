import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  buildPassportCommittedClaimsWitness,
  computeInstagramClaimsHash,
  computeInstagramHandleHash,
  computePassportClaimsHash,
  computePassportCommittedClaimsHash,
  computePassportCommittedClaimsHashFromWitness,
  computePassportExpiryCommitment,
  computePassportNationalityCommitment,
  packAlpha3,
  poseidon2FieldHasher,
} from "./encoding.js";
import { CredentialType } from "@magna/core";

describe("packAlpha3", () => {
  it("packs USA deterministically", () => {
    const packed = packAlpha3("USA");
    assert.equal(packed, (85n << 16n) | (83n << 8n) | 65n);
  });
});

describe("passport v2 hidden claims hashing", () => {
  it("commits nationality and passport expiry before hashing claims", () => {
    const nationalityBlind = 111n;
    const expiryBlind = 222n;
    const expiryTs = 1_932_249_599n;

    const nationalityCommitment = computePassportNationalityCommitment(
      "TUR",
      nationalityBlind,
      poseidon2FieldHasher,
    );
    const expiryCommitment = computePassportExpiryCommitment(
      expiryTs,
      expiryBlind,
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

    assert.notEqual(nationalityCommitment, packAlpha3("TUR"));
    assert.notEqual(expiryCommitment, expiryTs);
    assert.equal(typeof claimsHash, "bigint");
    assert(claimsHash > 0n);
  });

  it("does not collide with the v1 raw-passport claims hash for the same visible values", () => {
    const expiryTs = 1_932_249_599n;
    const v1 = computePassportClaimsHash(
      {
        schemaVersion: 1,
        credentialType: CredentialType.Passport,
        nationalityAlpha3Packed: packAlpha3("TUR"),
        minAgeProven: 18,
        expiryTs,
      },
      poseidon2FieldHasher,
    );
    const v2 = computePassportCommittedClaimsHash(
      {
        schemaVersion: 2,
        credentialType: CredentialType.Passport,
        nationalityCommitment: computePassportNationalityCommitment(
          "TUR",
          111n,
          poseidon2FieldHasher,
        ),
        minAgeProven: 18,
        expiryCommitment: computePassportExpiryCommitment(
          expiryTs,
          222n,
          poseidon2FieldHasher,
        ),
      },
      poseidon2FieldHasher,
    );

    assert.notEqual(v2, v1);
  });

  it("builds a v2 witness and hashes it with the same commitment formula", () => {
    const claims = {
      schemaVersion: 1,
      credentialType: CredentialType.Passport as const,
      nationalityAlpha3Packed: packAlpha3("CAN"),
      minAgeProven: 21,
      expiryTs: 1_893_456_000n,
    };
    const witness = buildPassportCommittedClaimsWitness({
      claims,
      nationalityBlind: 111n,
      expiryBlind: 222n,
    });

    const fromWitness = computePassportCommittedClaimsHashFromWitness(
      witness,
      poseidon2FieldHasher,
    );
    const manuallyComposed = computePassportCommittedClaimsHash(
      {
        schemaVersion: 2,
        credentialType: CredentialType.Passport,
        nationalityCommitment: poseidon2FieldHasher(
          0x4d414e43n,
          [packAlpha3("CAN"), 111n],
        ),
        minAgeProven: 21,
        expiryCommitment: poseidon2FieldHasher(0x4d414558n, [1_893_456_000n, 222n]),
      },
      poseidon2FieldHasher,
    );

    assert.deepEqual(witness, {
      minAgeProven: 21,
      nationalityAlpha3Packed: packAlpha3("CAN"),
      nationalityBlind: 111n,
      expiryTs: 1_893_456_000n,
      expiryBlind: 222n,
    });
    assert.equal(fromWitness, manuallyComposed);
  });
});

describe("instagram hashing", () => {
  it("matches zkPoke username hashing for deterministic handle binding", () => {
    assert.equal(
      computeInstagramHandleHash("denemedeneme581"),
      21800137438672550822996462157901125537325126536773334526859055600762133677092n,
    );
  });

  it("changes claims hash when the handle hash changes", () => {
    const first = computeInstagramClaimsHash(
      {
        schemaVersion: 1,
        credentialType: CredentialType.Instagram,
        handleHash: computeInstagramHandleHash("denemedeneme581"),
        expiryTs: 1_893_456_000n,
      },
      poseidon2FieldHasher,
    );
    const second = computeInstagramClaimsHash(
      {
        schemaVersion: 1,
        credentialType: CredentialType.Instagram,
        handleHash: computeInstagramHandleHash("denemedeneme582"),
        expiryTs: 1_893_456_000n,
      },
      poseidon2FieldHasher,
    );

    assert.notEqual(first, second);
  });
});
