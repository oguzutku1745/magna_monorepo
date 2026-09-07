import { CredentialType } from "@magna-protocol/core";
import {
  MAGNA_ROOT_DS,
  computePassportCommittedClaimsHash,
  computePassportExpiryCommitment,
  computePassportNationalityCommitment,
  deriveRootCommitment,
  packAlpha3,
  poseidon2FieldHasher,
} from "@magna/wallet";
import {
  formatBoundData,
  getAgeParameterCommitment,
  getBindParameterCommitment,
  getDiscloseParameterCommitment,
  getFacematchParameterCommitment,
  getParamCommitmentsFromOuterProof,
} from "@zkpassport/utils";
import {
  PASSPORT_A2_INNER_NAME,
  PASSPORT_A2_INNER_VKEY_HASH,
  PASSPORT_A2_DEVELOPMENT_NULLIFIER_TYPE,
  PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH,
  PASSPORT_A2_OPRF_PUBLIC_KEY_HASH,
  PASSPORT_A2_PRODUCTION_NULLIFIER_TYPE,
} from "./types.js";
import type {
  BigintLike,
  BuildPassportWrapperInputsOptions,
  BuildPassportWrapperInputsResult,
  PassportA2Action,
  PassportA2CredentialMode,
  PassportA2NullifierType,
  PassportWrapperDeclaredPublicOutputs,
  PassportWrapperLocalWitness,
  PassportWrapperPublicOutputs,
  ZkPassportMrzLayout,
} from "./types.js";
import { resolveZkPassportRecursiveArtifacts } from "./zkpassport-recursive.js";

export const MAGNA_PASSPORT_A2_CONTEXT_DS = 0x4d413243n; // "MA2C"
const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MAX_U64 = (1n << 64n) - 1n;
const MRZ_LENGTH = 90;
const BIND_LENGTH = 509;
const MRZ_SUBTYPE_BYTES = Array.from("<ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", char =>
  char.charCodeAt(0),
);
const LAYOUTS: Record<ZkPassportMrzLayout, { nationality: number; expiry: number }> = {
  passport: { nationality: 54, expiry: 65 },
  id_card: { nationality: 45, expiry: 38 },
};
const ACTION_FIELDS: Record<PassportA2Action, bigint> = { issue: 1n, renew: 2n, recover: 3n };
const MODE_FIELDS: Record<PassportA2CredentialMode, bigint> = { rooted: 1n, passport: 2n };
const FACEMATCH_PRODUCTION = 1n;
const FACEMATCH_REGULAR = 1n;
const FACEMATCH_STRICT = 2n;
const APPLE_APP_ATTEST_ROOT_KEY_HASH =
  0x2532418a107c5306fa8308c22255792cf77e4a290cbce8a840a642a3e591340bn;
const GOOGLE_APP_ATTEST_RSA_ROOT_KEY_HASH =
  0x16700a2d9168a194fc85f237af5829b5a2be05b8ae8ac4879ada34cf54a9c211n;
const GOOGLE_APP_ATTEST_ECDSA_P384_ROOT_KEY_HASH =
  0x0e1889bec6c1d686abcf08360ff404f803ab345881ea8cba6aad33b7f7f7ffe0n;
const ZKPASSPORT_IOS_APP_ID_HASH =
  0x1fa73686cf510f8f85757b0602de0dd72a13e68ae2092462be8b72662e7f179bn;
const ZKPASSPORT_ANDROID_APP_ID_HASH =
  0x24d9929b248be7eeecaa98e105c034a50539610f3fdd4cb9c8983ef4100d615dn;
const GOOGLE_PLAY_INTEGRITY_PUBLIC_KEY_HASH =
  8544227306600425492560068004835614964118871262589609739238120993689090208159n;
const encoder = new TextEncoder();

function bigintFrom(value: BigintLike, label: string): bigint {
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(value);
    if (parsed < 0n || parsed >= FIELD_MODULUS) {
      throw new Error("range");
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a non-negative field value.`);
  }
}

function u64From(value: BigintLike, label: string): bigint {
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 0n || parsed > MAX_U64) {
    throw new Error(`${label} must fit in u64.`);
  }
  return parsed;
}

function u8From(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must fit in u8.`);
  }
  return value;
}

function nullifierTypeFrom(value: string): PassportA2NullifierType {
  const parsed = Number(BigInt(value));
  if (parsed !== 0 && parsed !== 1 && parsed !== 2 && parsed !== 3) {
    throw new Error("zkPassport outer proof has an invalid nullifier type.");
  }
  return parsed;
}

function expiryMrz(expiryTs: bigint): number[] {
  const milliseconds = expiryTs * 1000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("expiryTs is too large to convert to an MRZ date.");
  }
  const date = new Date(Number(milliseconds));
  const canonical = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    23,
    59,
    59,
  );
  if (canonical !== Number(milliseconds)) {
    throw new Error("expiryTs must be the canonical end-of-day UTC passport expiry.");
  }
  return Array.from(
    encoder.encode(
      `${String(date.getUTCFullYear() % 100).padStart(2, "0")}${String(
        date.getUTCMonth() + 1,
      ).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`,
    ),
  );
}

function buildDisclosure(
  layout: ZkPassportMrzLayout,
  documentType: number[],
  nationality: number[],
  expiry: number[],
): { mask: number[]; bytes: number[] } {
  const mask = Array<number>(MRZ_LENGTH).fill(0);
  const bytes = Array<number>(MRZ_LENGTH).fill(0);
  const offsets = LAYOUTS[layout];
  documentType.forEach((value, index) => {
    mask[index] = 1;
    bytes[index] = value;
  });
  nationality.forEach((value, index) => {
    mask[offsets.nationality + index] = 1;
    bytes[offsets.nationality + index] = value;
  });
  expiry.forEach((value, index) => {
    mask[offsets.expiry + index] = 1;
    bytes[offsets.expiry + index] = value;
  });
  return { mask, bytes };
}

function paddedBindData(customData: string): number[] {
  const data = formatBoundData({ custom_data: customData });
  if (data.length > BIND_LENGTH) {
    throw new Error("zkPassport bind data exceeds 509 bytes.");
  }
  return [...data, ...Array<number>(BIND_LENGTH - data.length).fill(0)];
}

function assertDeclared(
  declared: PassportWrapperDeclaredPublicOutputs | undefined,
  outputs: PassportWrapperPublicOutputs,
): void {
  if (!declared) return;
  const expected = [
    declared.claimsHash,
    declared.nationalityCommitment,
    declared.expiryCommitment,
    declared.minAgeProven,
    declared.credentialValidUntil,
    declared.rootCommitment,
    declared.requestContextHash,
    declared.proofCurrentDate,
  ];
  const actual = [
    outputs.claimsHash,
    outputs.nationalityCommitment,
    outputs.expiryCommitment,
    outputs.minAgeProven,
    outputs.credentialValidUntil,
    outputs.rootCommitment,
    outputs.requestContextHash,
    outputs.proofCurrentDate,
  ];
  expected.forEach((value, index) => {
    if (BigInt(value) !== BigInt(actual[index])) {
      throw new Error(`Declared Passport A2 public output ${index} does not match the witness.`);
    }
  });
}

export function computePassportA2RequestContextHash(input: {
  action: PassportA2Action;
  issuer: BigintLike;
  owner: BigintLike;
  ghostOwner: BigintLike;
  credentialMode: PassportA2CredentialMode;
  rootCommitment: BigintLike;
  credentialValidUntil: BigintLike;
  serviceScope: BigintLike;
  serviceSubscope: BigintLike;
  bindCommitment: BigintLike;
  certificateRegistryRoot: BigintLike;
  circuitRegistryRoot: BigintLike;
  nullifierType: BigintLike;
  oprfPublicKeyHash: BigintLike;
}): bigint {
  return poseidon2FieldHasher(MAGNA_PASSPORT_A2_CONTEXT_DS, [
    ACTION_FIELDS[input.action],
    bigintFrom(input.issuer, "issuer"),
    bigintFrom(input.owner, "owner"),
    bigintFrom(input.ghostOwner, "ghostOwner"),
    MODE_FIELDS[input.credentialMode],
    bigintFrom(input.rootCommitment, "rootCommitment"),
    u64From(input.credentialValidUntil, "credentialValidUntil"),
    bigintFrom(input.certificateRegistryRoot, "certificateRegistryRoot"),
    bigintFrom(input.circuitRegistryRoot, "circuitRegistryRoot"),
    bigintFrom(input.nullifierType, "nullifierType"),
    bigintFrom(input.oprfPublicKeyHash, "oprfPublicKeyHash"),
    bigintFrom(input.serviceScope, "serviceScope"),
    bigintFrom(input.serviceSubscope, "serviceSubscope"),
    bigintFrom(input.bindCommitment, "bindCommitment"),
  ]);
}

export async function buildPassportWrapperInputs(
  witness: PassportWrapperLocalWitness,
  options: BuildPassportWrapperInputsOptions = {},
): Promise<BuildPassportWrapperInputsResult> {
  if (witness.profile !== "development" && witness.profile !== "production") {
    throw new Error("Passport A2 proof profile must be explicitly development or production.");
  }
  const isDevelopment = witness.profile === "development";
  const expectedFacematchMode = isDevelopment ? "regular" : "strict";
  const expectedFacematchModeField = isDevelopment ? FACEMATCH_REGULAR : FACEMATCH_STRICT;
  const expectedNullifierType: PassportA2NullifierType = isDevelopment
    ? PASSPORT_A2_DEVELOPMENT_NULLIFIER_TYPE
    : PASSPORT_A2_PRODUCTION_NULLIFIER_TYPE;
  const expectedOprfPublicKeyHash = isDevelopment
    ? PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH
    : PASSPORT_A2_OPRF_PUBLIC_KEY_HASH;
  if (!/^[A-Z]{3}$/.test(witness.nationalityAlpha3)) {
    throw new Error("nationalityAlpha3 must be an uppercase ISO alpha-3 code.");
  }
  const nationalityBytes = Array.from(encoder.encode(witness.nationalityAlpha3));
  const minAgeProven = u8From(witness.minAgeProven, "minAgeProven");
  const minAge = u8From(witness.agePredicate.minAge, "agePredicate.minAge");
  const maxAge = u8From(witness.agePredicate.maxAge, "agePredicate.maxAge");
  if (minAgeProven !== minAge || (maxAge !== 0 && maxAge < minAge)) {
    throw new Error("minAgeProven must equal a valid zkPassport age lower bound.");
  }
  const expiryTs = u64From(witness.expiryTs, "expiryTs");
  const credentialValidUntil = u64From(witness.credentialValidUntil, "credentialValidUntil");
  if (credentialValidUntil > expiryTs) {
    throw new Error("credentialValidUntil must not exceed passport expiry.");
  }
  const nationalityBlind = bigintFrom(witness.nationalityBlind, "nationalityBlind");
  const expiryBlind = bigintFrom(witness.expiryBlind, "expiryBlind");
  const recursive = await resolveZkPassportRecursiveArtifacts(
    witness.zkPassportOuterProof,
    options.registryClient,
  );
  const outerProofData = { publicInputs: recursive.publicInputs } as Parameters<
    typeof getParamCommitmentsFromOuterProof
  >[0];
  const outerCommitments = new Set(
    getParamCommitmentsFromOuterProof(outerProofData).map(value => value.toString()),
  );
  const expiryBytes = expiryMrz(expiryTs);
  const documentTypeCandidates = (Object.keys(LAYOUTS) as ZkPassportMrzLayout[]).flatMap(layout => {
    const firstByte = layout === "passport" ? "P".charCodeAt(0) : "I".charCodeAt(0);
    return MRZ_SUBTYPE_BYTES.map(secondByte => ({ layout, bytes: [firstByte, secondByte] }));
  });
  const disclosureCandidates = await Promise.all(
    documentTypeCandidates.map(async candidate => {
      const disclosure = buildDisclosure(
        candidate.layout,
        candidate.bytes,
        nationalityBytes,
        expiryBytes,
      );
      const commitment = await getDiscloseParameterCommitment(disclosure.mask, disclosure.bytes);
      return { layout: candidate.layout, disclosure, commitment };
    }),
  );
  const disclosureMatch = disclosureCandidates.find(candidate =>
    outerCommitments.has(candidate.commitment.toString()),
  );
  if (!disclosureMatch) {
    throw new Error(
      "Document type, nationality, and expiry do not match the authenticated zkPassport disclosure.",
    );
  }
  const bindData = paddedBindData(witness.bind.customData);
  const [ageCommitment, bindCommitment] = await Promise.all([
    getAgeParameterCommitment(minAge, maxAge),
    getBindParameterCommitment(formatBoundData({ custom_data: witness.bind.customData })),
  ]);
  if (!outerCommitments.has(ageCommitment.toString())) {
    throw new Error("Age predicate does not match the authenticated zkPassport proof.");
  }
  if (!outerCommitments.has(bindCommitment.toString())) {
    throw new Error("Bind data does not match the authenticated zkPassport proof.");
  }

  const facematchRootKeyLeaf = bigintFrom(witness.facematch.rootKeyLeaf, "facematch.rootKeyLeaf");
  if (
    facematchRootKeyLeaf !== APPLE_APP_ATTEST_ROOT_KEY_HASH &&
    facematchRootKeyLeaf !== GOOGLE_APP_ATTEST_RSA_ROOT_KEY_HASH &&
    facematchRootKeyLeaf !== GOOGLE_APP_ATTEST_ECDSA_P384_ROOT_KEY_HASH
  ) {
    throw new Error("Facematch root key is not an official Apple or Google attestation root.");
  }
  const facematchAppIdHash = bigintFrom(witness.facematch.appIdHash, "facematch.appIdHash");
  if (
    facematchAppIdHash !== ZKPASSPORT_IOS_APP_ID_HASH &&
    facematchAppIdHash !== ZKPASSPORT_ANDROID_APP_ID_HASH
  ) {
    throw new Error("Facematch app ID is not the official zkPassport app.");
  }
  const facematchIntegrityPublicKeyHash = bigintFrom(
    witness.facematch.integrityPublicKeyHash,
    "facematch.integrityPublicKeyHash",
  );
  const expectedIntegrityPublicKeyHash =
    facematchAppIdHash === ZKPASSPORT_ANDROID_APP_ID_HASH
      ? GOOGLE_PLAY_INTEGRITY_PUBLIC_KEY_HASH
      : 0n;
  if (facematchIntegrityPublicKeyHash !== expectedIntegrityPublicKeyHash) {
    throw new Error("Facematch integrity public key does not match the official app platform.");
  }
  if (
    witness.facematch.environment !== "production" ||
    witness.facematch.mode !== expectedFacematchMode
  ) {
    throw new Error(
      `Facematch must use the production environment in ${expectedFacematchMode} mode for the ${witness.profile} profile.`,
    );
  }
  const facematchCommitment = await getFacematchParameterCommitment(
    facematchRootKeyLeaf,
    FACEMATCH_PRODUCTION,
    facematchAppIdHash,
    expectedFacematchModeField,
  );
  if (!outerCommitments.has(facematchCommitment.toString())) {
    throw new Error("Facematch parameters do not match the authenticated zkPassport proof.");
  }

  const nullifierType = nullifierTypeFrom(recursive.publicInputs[9]);
  if (nullifierType !== expectedNullifierType) {
    throw new Error(
      isDevelopment
        ? "Passport A2 development requires the official non-salted-mock zkPassport nullifier."
        : "Passport A2 production requires a production salted zkPassport nullifier.",
    );
  }
  if (BigInt(recursive.publicInputs[11]) !== BigInt(expectedOprfPublicKeyHash)) {
    throw new Error(
      isDevelopment
        ? "Passport A2 development requires a zero OPRF public-key hash."
        : "zkPassport outer proof uses an unpinned OPRF public key.",
    );
  }

  const scopedNullifier = BigInt(recursive.publicInputs[10]);
  const rootCommitment = deriveRootCommitment({
    uniqueIdentifier: scopedNullifier,
    domainSeparator: MAGNA_ROOT_DS,
  });
  const nationalityCommitment = computePassportNationalityCommitment(
    witness.nationalityAlpha3,
    nationalityBlind,
    poseidon2FieldHasher,
  );
  const expiryCommitment = computePassportExpiryCommitment(expiryTs, expiryBlind, poseidon2FieldHasher);
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
  const requestContextHash = computePassportA2RequestContextHash({
    ...witness.requestContext,
    rootCommitment,
    credentialValidUntil,
    serviceScope: recursive.publicInputs[3],
    serviceSubscope: recursive.publicInputs[4],
    bindCommitment,
    certificateRegistryRoot: recursive.publicInputs[0],
    circuitRegistryRoot: recursive.publicInputs[1],
    nullifierType: recursive.publicInputs[9],
    oprfPublicKeyHash: recursive.publicInputs[11],
  });
  const proofCurrentDate = BigInt(recursive.publicInputs[2]);
  const outputs: PassportWrapperPublicOutputs = {
    claimsHash: claimsHash.toString(),
    nationalityCommitment: nationalityCommitment.toString(),
    expiryCommitment: expiryCommitment.toString(),
    minAgeProven,
    credentialValidUntil: credentialValidUntil.toString(),
    rootCommitment: rootCommitment.toString(),
    requestContextHash: requestContextHash.toString(),
    proofCurrentDate: proofCurrentDate.toString(),
  };
  assertDeclared(options.declaredPublicOutputs, outputs);

  return {
    inputs: {
      zkpassport_outer_vkey: recursive.vkeyFields,
      zkpassport_outer_proof: recursive.proofFields,
      zkpassport_outer_public_inputs: recursive.publicInputs,
      disclose_mask: disclosureMatch.disclosure.mask.map(Boolean),
      disclosed_bytes: disclosureMatch.disclosure.bytes.map(String),
      nationality: nationalityBytes.map(String),
      expiry_mrz: expiryBytes.map(String),
      nationality_blind: nationalityBlind.toString(),
      expiry_ts: expiryTs.toString(),
      expiry_blind: expiryBlind.toString(),
      min_age_proven: String(minAgeProven),
      age_min_bound: String(minAge),
      age_max_bound: String(maxAge),
      bind_data: bindData.map(String),
      facematch_root_key_leaf: facematchRootKeyLeaf.toString(),
      facematch_environment: FACEMATCH_PRODUCTION.toString(),
      facematch_app_id_hash: facematchAppIdHash.toString(),
      facematch_integrity_public_key_hash: facematchIntegrityPublicKeyHash.toString(),
      facematch_mode: expectedFacematchModeField.toString(),
      credential_valid_until: credentialValidUntil.toString(),
      action: ACTION_FIELDS[witness.requestContext.action].toString(),
      issuer: bigintFrom(witness.requestContext.issuer, "issuer").toString(),
      owner: bigintFrom(witness.requestContext.owner, "owner").toString(),
      ghost_owner: bigintFrom(witness.requestContext.ghostOwner, "ghostOwner").toString(),
      credential_mode: MODE_FIELDS[witness.requestContext.credentialMode].toString(),
    },
    publicInputs: [
      outputs.claimsHash,
      outputs.nationalityCommitment,
      outputs.expiryCommitment,
      String(outputs.minAgeProven),
      outputs.credentialValidUntil,
      outputs.rootCommitment,
      outputs.requestContextHash,
      outputs.proofCurrentDate,
    ],
    outputs,
    metadata: {
      innerProofName: PASSPORT_A2_INNER_NAME,
      innerProofVersion: "0.20.0",
      innerVkeyHash: PASSPORT_A2_INNER_VKEY_HASH,
      mrzLayout: disclosureMatch.layout,
      nationalityAlpha3Packed: packAlpha3(witness.nationalityAlpha3),
      nationalityCommitment,
      expiryCommitment,
      claimsHash,
      rootCommitment,
      requestContextHash,
      minAgeProven,
      credentialValidUntil,
      proofCurrentDate,
      registryContext: {
        certificateRegistryRoot: recursive.publicInputs[0],
        circuitRegistryRoot: recursive.publicInputs[1],
        nullifierType,
        oprfPublicKeyHash: recursive.publicInputs[11],
      },
    },
  };
}
