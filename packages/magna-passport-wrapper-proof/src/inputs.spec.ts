import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { describe, it } from "node:test";
import {
  formatBoundData,
  getAgeParameterCommitment,
  getBindParameterCommitment,
  getDiscloseParameterCommitment,
} from "@zkpassport/utils";
import { buildPassportWrapperInputs } from "./inputs.js";
import { parsePassportWrapperPublicInputs } from "./public-inputs.js";
import {
  PASSPORT_A2_INNER_PROOF_FIELD_COUNT,
  PASSPORT_A2_INNER_VKEY_FIELD_COUNT,
  PASSPORT_A2_INNER_VKEY_HASH,
  type PassportWrapperLocalWitness,
  type RegistryClientLike,
} from "./types.js";

const expiryTs = BigInt(Date.UTC(2031, 6, 20, 23, 59, 59) / 1000);

function fieldHex(value: bigint | number | string): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function replaceOuterPublicInput(
  witness: PassportWrapperLocalWitness,
  index: number,
  value: bigint,
): PassportWrapperLocalWitness {
  const fields = witness.zkPassportOuterProof.proof.replace(/^0x/, "").match(/.{64}/g) ?? [];
  fields[index] = fieldHex(value);
  return {
    ...witness,
    zkPassportOuterProof: { ...witness.zkPassportOuterProof, proof: fields.join("") },
  };
}

async function fixture(): Promise<{
  witness: PassportWrapperLocalWitness;
  registryClient: RegistryClientLike;
}> {
  const mask = Array<number>(90).fill(0);
  const bytes = Array<number>(90).fill(0);
  const nationality = Array.from(new TextEncoder().encode("TUR"));
  const expiry = Array.from(new TextEncoder().encode("310720"));
  nationality.forEach((value, index) => {
    mask[54 + index] = 1;
    bytes[54 + index] = value;
  });
  expiry.forEach((value, index) => {
    mask[65 + index] = 1;
    bytes[65 + index] = value;
  });
  const customData = "0x" + "12".repeat(32);
  const [disclose, age, bind] = await Promise.all([
    getDiscloseParameterCommitment(mask, bytes),
    getAgeParameterCommitment(18, 0),
    getBindParameterCommitment(formatBoundData({ custom_data: customData })),
  ]);
  const publicInputs = [
    11n,
    22n,
    1_900_000_000n,
    33n,
    44n,
    disclose,
    age,
    bind,
    0n,
    999n,
    0n,
  ];
  const proof = [
    ...publicInputs.map(fieldHex),
    ...Array<string>(PASSPORT_A2_INNER_PROOF_FIELD_COUNT).fill(fieldHex(0)),
  ].join("");
  const registryClient: RegistryClientLike = {
    getCircuitManifest: async () => ({ version: "0.20.0" }),
    getPackagedCircuit: async () => ({
      vkey: Buffer.alloc(PASSPORT_A2_INNER_VKEY_FIELD_COUNT * 32).toString("base64"),
      vkey_hash: PASSPORT_A2_INNER_VKEY_HASH,
    }),
  };
  return {
    witness: {
      zkPassportOuterProof: {
        proof,
        name: "outer_count_6",
        version: "0.20.0",
        vkeyHash: PASSPORT_A2_INNER_VKEY_HASH,
      },
      nationalityAlpha3: "TUR",
      expiryTs,
      minAgeProven: 18,
      agePredicate: { minAge: 18, maxAge: 0 },
      bind: { customData },
      credentialValidUntil: expiryTs - 86_400n,
      nationalityBlind: 111n,
      expiryBlind: 222n,
      requestContext: {
        action: "issue",
        issuer: 100n,
        owner: 101n,
        ghostOwner: 102n,
        credentialMode: "rooted",
      },
    },
    registryClient,
  };
}

describe("Passport A2 inputs", () => {
  it("keeps the inner proof and scoped nullifier private", async () => {
    const { witness, registryClient } = await fixture();
    const built = await buildPassportWrapperInputs(witness, { registryClient });

    assert.equal(
      (built.inputs.zkpassport_outer_proof as unknown[]).length,
      PASSPORT_A2_INNER_PROOF_FIELD_COUNT,
    );
    assert.equal(
      (built.inputs.zkpassport_outer_vkey as unknown[]).length,
      PASSPORT_A2_INNER_VKEY_FIELD_COUNT,
    );
    assert.equal(built.publicInputs.length, 8);
    assert.equal(built.publicInputs.includes("999"), false);
    assert.equal("scopedNullifier" in built.outputs, false);
    assert.equal("bindCommitment" in built.outputs, false);
    assert.equal(built.outputs.rootCommitment, built.metadata.rootCommitment.toString());
  });

  it("rejects fabricated nationality before proving", async () => {
    const { witness, registryClient } = await fixture();
    await assert.rejects(
      () => buildPassportWrapperInputs({ ...witness, nationalityAlpha3: "USA" }, { registryClient }),
      /do not match the authenticated zkPassport disclosure/,
    );
  });

  it("binds action and owner into the A2 request context", async () => {
    const { witness, registryClient } = await fixture();
    const issued = await buildPassportWrapperInputs(witness, { registryClient });
    const recovered = await buildPassportWrapperInputs(
      {
        ...witness,
        requestContext: { ...witness.requestContext, action: "recover", owner: 103n },
      },
      { registryClient },
    );
    assert.notEqual(issued.outputs.requestContextHash, recovered.outputs.requestContextHash);
  });

  it("binds registry roots and nullifier type without exposing them as public outputs", async () => {
    const { witness, registryClient } = await fixture();
    const baseline = await buildPassportWrapperInputs(witness, { registryClient });
    const changedRoot = await buildPassportWrapperInputs(
      replaceOuterPublicInput(witness, 0, 12n),
      { registryClient },
    );
    assert.notEqual(baseline.outputs.requestContextHash, changedRoot.outputs.requestContextHash);
    assert.equal(baseline.metadata.registryContext.certificateRegistryRoot, "11");
    assert.equal(baseline.publicInputs.includes("11"), false);

    await assert.rejects(
      () => buildPassportWrapperInputs(replaceOuterPublicInput(witness, 8, 4n), { registryClient }),
      /invalid nullifier type/,
    );
  });
});

describe("parsePassportWrapperPublicInputs", () => {
  it("parses the eight sanitized A2 outputs", () => {
    assert.deepEqual(parsePassportWrapperPublicInputs(["1", "2", "3", "18", "4", "5", "6", "7"]), {
      claimsHash: "1",
      nationalityCommitment: "2",
      expiryCommitment: "3",
      minAgeProven: 18,
      credentialValidUntil: "4",
      rootCommitment: "5",
      requestContextHash: "6",
      proofCurrentDate: "7",
    });
  });

  it("rejects the old A1 ten-field statement", () => {
    assert.throws(
      () => parsePassportWrapperPublicInputs(Array<string>(10).fill("0")),
      /exactly 8 public inputs/,
    );
  });
});
