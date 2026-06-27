import { CredentialType } from "@magna/core";
import {
  computePassportCommittedClaimsHash,
  computePassportExpiryCommitment,
  computePassportNationalityCommitment,
  computeZkPassportParameterCommitmentManifest,
  packAlpha3,
  poseidon2FieldHasher,
} from "@magna/wallet";
import type {
  BigintLike,
  BuildPassportWrapperInputsOptions,
  BuildPassportWrapperInputsResult,
  PassportWrapperDeclaredPublicOutputs,
  PassportWrapperLocalWitness,
  PassportWrapperPublicOutputs,
} from "./types.js";

const MAX_U8 = 255;
const MAX_U64 = (1n << 64n) - 1n;
const textDecoder = new TextDecoder("ascii", { fatal: true });

function bigintFrom(value: BigintLike, label: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a safe integer.`);
    }
    return BigInt(value);
  }
  if (!/^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)) {
    throw new Error(`${label} must be an unsigned bigint string.`);
  }
  return BigInt(value);
}

function assertUnsigned(value: bigint, label: string): void {
  if (value < 0n) {
    throw new Error(`${label} must be non-negative.`);
  }
}

function u8From(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U8) {
    throw new Error(`${label} must be an integer in [0, 255].`);
  }
  return value;
}

function u64From(value: BigintLike, label: string): bigint {
  const parsed = bigintFrom(value, label);
  assertUnsigned(parsed, label);
  if (parsed > MAX_U64) {
    throw new Error(`${label} must fit in u64.`);
  }
  return parsed;
}

function fieldString(value: bigint): string {
  assertUnsigned(value, "field input");
  return value.toString();
}

function assertMatchingField(actual: bigint, expected: BigintLike, label: string): void {
  const parsedExpected = bigintFrom(expected, label);
  assertUnsigned(parsedExpected, label);
  if (actual !== parsedExpected) {
    throw new Error(`${label} does not match the wrapper witness.`);
  }
}

function disclosureAscii(bytes: number[], label: string): string {
  try {
    return textDecoder.decode(Uint8Array.from(bytes));
  } catch {
    throw new Error(`${label} must be ASCII disclosure bytes.`);
  }
}

function assertDisclosureMaskCovers(bytes: number[], mask: number[], label: string): void {
  if (mask.length !== bytes.length || mask.some((value) => value !== 1)) {
    throw new Error(`${label} must disclose exactly the local committed value.`);
  }
}

function assertNationalityDisclosureMatches(witness: PassportWrapperLocalWitness): void {
  const disclosure = witness.minimalZkPassportWitness.nationalityDisclosure;
  assertDisclosureMaskCovers(
    disclosure.disclosedBytes,
    disclosure.discloseMask,
    "nationality disclosure",
  );
  const disclosedNationality = disclosureAscii(
    disclosure.disclosedBytes,
    "nationality disclosure",
  );
  if (disclosedNationality !== witness.nationalityAlpha3) {
    throw new Error("nationalityAlpha3 does not match the minimal zkPassport nationality disclosure.");
  }
}

function mrzExpiryFromTimestamp(expiryTs: bigint): string {
  const expiryMs = expiryTs * 1000n;
  if (expiryMs > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("expiryTs is too large to convert to a UTC disclosure date.");
  }
  const date = new Date(Number(expiryMs));
  if (Number.isNaN(date.getTime())) {
    throw new Error("expiryTs must be a valid UTC timestamp.");
  }
  const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function canonicalExpiryTimestampFromMrz(mrzExpiry: string): bigint {
  if (!/^[0-9]{6}$/.test(mrzExpiry)) {
    throw new Error("expiry disclosure must be an MRZ YYMMDD date.");
  }
  const year = 2000 + Number(mrzExpiry.slice(0, 2));
  const month = Number(mrzExpiry.slice(2, 4));
  const day = Number(mrzExpiry.slice(4, 6));
  const ms = Date.UTC(year, month - 1, day, 23, 59, 59, 0);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("expiry disclosure must be a valid MRZ YYMMDD date.");
  }
  return BigInt(Math.floor(ms / 1000));
}

function assertExpiryDisclosureMatches(
  witness: PassportWrapperLocalWitness,
  expiryTs: bigint,
): void {
  const disclosure = witness.minimalZkPassportWitness.expiryDisclosure;
  assertDisclosureMaskCovers(
    disclosure.disclosedBytes,
    disclosure.discloseMask,
    "expiry disclosure",
  );
  const disclosedExpiry = disclosureAscii(disclosure.disclosedBytes, "expiry disclosure");
  const expectedExpiryTs = canonicalExpiryTimestampFromMrz(disclosedExpiry);
  if (expiryTs !== expectedExpiryTs || mrzExpiryFromTimestamp(expiryTs) !== disclosedExpiry) {
    throw new Error("expiryTs does not match the minimal zkPassport expiry disclosure.");
  }
}

function normalizeDeclaredOutputs(
  declared: PassportWrapperDeclaredPublicOutputs | undefined,
  computed: {
    claimsHash: bigint;
    nationalityCommitment: bigint;
    expiryCommitment: bigint;
    minAgeProven: number;
    credentialValidUntil: bigint;
    scopedNullifier: bigint;
    nationalityDisclosureCommitment: bigint;
    expiryDisclosureCommitment: bigint;
    agePredicateCommitment: bigint;
    bindCommitment: bigint;
  },
): PassportWrapperPublicOutputs {
  if (declared) {
    assertMatchingField(computed.claimsHash, declared.claimsHash, "claimsHash");
    assertMatchingField(
      computed.nationalityCommitment,
      declared.nationalityCommitment,
      "nationalityCommitment",
    );
    assertMatchingField(computed.expiryCommitment, declared.expiryCommitment, "expiryCommitment");
    assertMatchingField(
      BigInt(computed.minAgeProven),
      declared.minAgeProven,
      "minAgeProven",
    );
    assertMatchingField(
      computed.credentialValidUntil,
      declared.credentialValidUntil,
      "credentialValidUntil",
    );
    assertMatchingField(
      computed.scopedNullifier,
      declared.scopedNullifier ?? 0n,
      "scopedNullifier",
    );
    assertMatchingField(
      computed.nationalityDisclosureCommitment,
      declared.nationalityDisclosureCommitment,
      "nationalityDisclosureCommitment",
    );
    assertMatchingField(
      computed.expiryDisclosureCommitment,
      declared.expiryDisclosureCommitment,
      "expiryDisclosureCommitment",
    );
    assertMatchingField(
      computed.agePredicateCommitment,
      declared.agePredicateCommitment,
      "agePredicateCommitment",
    );
    assertMatchingField(computed.bindCommitment, declared.bindCommitment, "bindCommitment");
  }

  return {
    claimsHash: computed.claimsHash.toString(),
    nationalityCommitment: computed.nationalityCommitment.toString(),
    expiryCommitment: computed.expiryCommitment.toString(),
    minAgeProven: computed.minAgeProven,
    credentialValidUntil: computed.credentialValidUntil.toString(),
    scopedNullifier: computed.scopedNullifier.toString(),
    nationalityDisclosureCommitment: computed.nationalityDisclosureCommitment.toString(),
    expiryDisclosureCommitment: computed.expiryDisclosureCommitment.toString(),
    agePredicateCommitment: computed.agePredicateCommitment.toString(),
    bindCommitment: computed.bindCommitment.toString(),
  };
}

function assertWitnessConsistency(witness: PassportWrapperLocalWitness): void {
  if (!witness.zkPassportOuterProof || typeof witness.zkPassportOuterProof !== "object") {
    throw new Error("zkPassport outer proof artifact is required for the local witness.");
  }
  if (!Array.isArray(witness.zkPassportOuterPublicInputs)) {
    throw new Error("zkPassport outer public inputs are required for the local witness.");
  }
  const agePredicate = witness.agePredicate;
  u8From(agePredicate.minAge, "agePredicate.minAge");
  u8From(agePredicate.maxAge, "agePredicate.maxAge");
  if (agePredicate.maxAge < agePredicate.minAge) {
    throw new Error("agePredicate.maxAge must be greater than or equal to agePredicate.minAge.");
  }
  if (witness.minAgeProven < agePredicate.minAge || witness.minAgeProven > agePredicate.maxAge) {
    throw new Error("minAgeProven must satisfy the local age predicate bounds.");
  }
  if (
    witness.minimalZkPassportWitness.agePredicate.minAge !== agePredicate.minAge ||
    witness.minimalZkPassportWitness.agePredicate.maxAge !== agePredicate.maxAge
  ) {
    throw new Error("minimal zkPassport age predicate does not match local age predicate.");
  }
  if (witness.minimalZkPassportWitness.bind.customData !== witness.bind.customData) {
    throw new Error("minimal zkPassport bind data does not match local bind data.");
  }
}

export async function buildPassportWrapperInputs(
  witness: PassportWrapperLocalWitness,
  options: BuildPassportWrapperInputsOptions = {},
): Promise<BuildPassportWrapperInputsResult> {
  assertWitnessConsistency(witness);

  const minAgeProven = u8From(witness.minAgeProven, "minAgeProven");
  const nationalityAlpha3Packed = packAlpha3(witness.nationalityAlpha3);
  const expiryTs = u64From(witness.expiryTs, "expiryTs");
  assertNationalityDisclosureMatches(witness);
  assertExpiryDisclosureMatches(witness, expiryTs);
  const credentialValidUntil = u64From(
    witness.credentialValidUntil,
    "credentialValidUntil",
  );
  const nationalityBlind = bigintFrom(witness.nationalityBlind, "nationalityBlind");
  const expiryBlind = bigintFrom(witness.expiryBlind, "expiryBlind");
  const scopedNullifier =
    witness.scopedNullifier === undefined || witness.scopedNullifier === null
      ? 0n
      : bigintFrom(witness.scopedNullifier, "scopedNullifier");
  assertUnsigned(nationalityBlind, "nationalityBlind");
  assertUnsigned(expiryBlind, "expiryBlind");
  assertUnsigned(scopedNullifier, "scopedNullifier");

  const parameterCommitmentManifest = await computeZkPassportParameterCommitmentManifest(
    witness.minimalZkPassportWitness,
  );
  if (witness.expectedParameterCommitmentManifest) {
    for (const key of Object.keys(parameterCommitmentManifest) as Array<
      keyof typeof parameterCommitmentManifest
    >) {
      if (parameterCommitmentManifest[key] !== witness.expectedParameterCommitmentManifest[key]) {
        throw new Error(`${key} does not match the local zkPassport witness.`);
      }
    }
  }

  const nationalityCommitment = computePassportNationalityCommitment(
    witness.nationalityAlpha3,
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
      minAgeProven,
      expiryCommitment,
    },
    poseidon2FieldHasher,
  );

  const outputs = normalizeDeclaredOutputs(options.declaredPublicOutputs, {
    claimsHash,
    nationalityCommitment,
    expiryCommitment,
    minAgeProven,
    credentialValidUntil,
    scopedNullifier,
    nationalityDisclosureCommitment: BigInt(parameterCommitmentManifest.nationalityDisclosureCommitment),
    expiryDisclosureCommitment: BigInt(parameterCommitmentManifest.expiryDisclosureCommitment),
    agePredicateCommitment: BigInt(parameterCommitmentManifest.agePredicateCommitment),
    bindCommitment: BigInt(parameterCommitmentManifest.bindCommitment),
  });
  const publicInputs = [
    outputs.claimsHash,
    outputs.nationalityCommitment,
    outputs.expiryCommitment,
    String(outputs.minAgeProven),
    outputs.credentialValidUntil,
    outputs.scopedNullifier,
    outputs.nationalityDisclosureCommitment,
    outputs.expiryDisclosureCommitment,
    outputs.agePredicateCommitment,
    outputs.bindCommitment,
  ];

  return {
    inputs: {
      nationality_alpha3_packed: fieldString(nationalityAlpha3Packed),
      nationality_blind: fieldString(nationalityBlind),
      expiry_ts: fieldString(expiryTs),
      expiry_blind: fieldString(expiryBlind),
      min_age_proven: String(minAgeProven),
      age_min_bound: String(witness.agePredicate.minAge),
      age_max_bound: String(witness.agePredicate.maxAge),
      credential_valid_until: fieldString(credentialValidUntil),
      scoped_nullifier: fieldString(scopedNullifier),
      expected_claims_hash: outputs.claimsHash,
      expected_nationality_commitment: outputs.nationalityCommitment,
      expected_expiry_commitment: outputs.expiryCommitment,
      expected_min_age_proven: String(outputs.minAgeProven),
      expected_credential_valid_until: outputs.credentialValidUntil,
      expected_scoped_nullifier: outputs.scopedNullifier,
      expected_nationality_disclosure_commitment: outputs.nationalityDisclosureCommitment,
      expected_expiry_disclosure_commitment: outputs.expiryDisclosureCommitment,
      expected_age_predicate_commitment: outputs.agePredicateCommitment,
      expected_bind_commitment: outputs.bindCommitment,
    },
    publicInputs,
    outputs,
    metadata: {
      nationalityAlpha3Packed,
      nationalityCommitment,
      expiryCommitment,
      claimsHash,
      minAgeProven,
      credentialValidUntil,
      scopedNullifier,
      agePredicate: { ...witness.agePredicate },
      parameterCommitmentManifest,
      zkPassportOuterPublicInputsCount: witness.zkPassportOuterPublicInputs.length,
      outerProofVerification: "not_implemented_task_3",
    },
  };
}
