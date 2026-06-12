import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  computeInstagramClaimsHash,
  computeInstagramHandleHash,
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
