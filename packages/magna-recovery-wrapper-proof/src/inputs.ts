import {
  PASSPORT_A2_DEVELOPMENT_NULLIFIER_TYPE,
  PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH,
  resolveZkPassportRecursiveArtifacts,
  type BigintLike,
} from "@magna/passport-wrapper-proof/recursive";
import {
  MAGNA_RECOVERY_V3_SCHEMA,
  computeRecoveryAuthorization,
  computeRecoveryIntent,
  computeRecoveryRootCommitmentField,
  computeRecoveryTrustContext,
  deriveRecoveryClaims,
  formatRecoveryBindCustomData,
} from "@magna/recovery-v3/protocol";
import {
  formatBoundData,
  getAgeParameterCommitment,
  getBindParameterCommitment,
  getDiscloseParameterCommitment,
  getFacematchParameterCommitment,
  getParamCommitmentsFromOuterProof,
} from "@zkpassport/utils";
import type {
  BuildRecoveryWrapperInputsOptions,
  BuildRecoveryWrapperInputsResult,
  RecoveryWrapperLocalWitness,
  RecoveryWrapperPublicOutputs,
} from "./types.js";
import { RECOVERY_WRAPPER_VERSION } from "./types.js";

const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MAX_U64 = (1n << 64n) - 1n;
const MRZ_LENGTH = 90;
const FACEMATCH_PRODUCTION = 1n;
const FACEMATCH_REGULAR = 1n;
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
const MRZ_SUBTYPE_BYTES = Array.from("<ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", character =>
  character.charCodeAt(0),
);
const LAYOUTS = {
  passport: { nationality: 54, expiry: 65, documentType: "P".charCodeAt(0) },
  id_card: { nationality: 45, expiry: 38, documentType: "I".charCodeAt(0) },
} as const;
const encoder = new TextEncoder();

function field(value: BigintLike, label: string, nonZero = false): bigint {
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(value);
    if (parsed < 0n || parsed >= FIELD_MODULUS || (nonZero && parsed === 0n)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be ${nonZero ? "a non-zero " : "a "}BN254 field value.`);
  }
}

function u8(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${label} must fit in u8.`);
  return value;
}

function u64(value: BigintLike, label: string): bigint {
  const parsed = field(value, label);
  if (parsed > MAX_U64) throw new Error(`${label} must fit in u64.`);
  return parsed;
}

function expiryMrz(expiryTs: bigint): number[] {
  const milliseconds = expiryTs * 1000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("expiryTs is too large for an MRZ date.");
  const date = new Date(Number(milliseconds));
  const canonical = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59);
  if (canonical !== Number(milliseconds)) {
    throw new Error("expiryTs must be the canonical end-of-day UTC passport expiry.");
  }
  return Array.from(
    encoder.encode(
      `${String(date.getUTCFullYear() % 100).padStart(2, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`,
    ),
  );
}

function disclosure(layout: keyof typeof LAYOUTS, subtype: number, nationality: number[], expiry: number[]) {
  const mask = Array<number>(MRZ_LENGTH).fill(0);
  const bytes = Array<number>(MRZ_LENGTH).fill(0);
  const selected = LAYOUTS[layout];
  mask[0] = mask[1] = 1;
  bytes[0] = selected.documentType;
  bytes[1] = subtype;
  nationality.forEach((value, index) => {
    mask[selected.nationality + index] = 1;
    bytes[selected.nationality + index] = value;
  });
  expiry.forEach((value, index) => {
    mask[selected.expiry + index] = 1;
    bytes[selected.expiry + index] = value;
  });
  return { mask, bytes };
}

function assertNonZeroOutputs(outputs: RecoveryWrapperPublicOutputs): void {
  for (const [label, value] of Object.entries(outputs)) {
    if (label !== "schema" && BigInt(value) === 0n) throw new Error(`Derived recovery ${label} must be non-zero.`);
  }
}

export async function buildRecoveryWrapperInputs(
  witness: RecoveryWrapperLocalWitness,
  options: BuildRecoveryWrapperInputsOptions = {},
): Promise<BuildRecoveryWrapperInputsResult> {
  if (!/^[A-Z]{3}$/.test(witness.nationalityAlpha3)) {
    throw new Error("nationalityAlpha3 must be an uppercase ISO alpha-3 code.");
  }
  const nationality = Array.from(encoder.encode(witness.nationalityAlpha3));
  const minAge = u8(witness.agePredicate.minAge, "agePredicate.minAge");
  const maxAge = u8(witness.agePredicate.maxAge, "agePredicate.maxAge");
  const minAgeProven = u8(witness.minAgeProven, "minAgeProven");
  if (minAgeProven !== minAge || (maxAge !== 0 && maxAge < minAge)) {
    throw new Error("minAgeProven must equal a valid zkPassport age lower bound.");
  }
  const expiryTs = u64(witness.expiryTs, "expiryTs");
  const expiry = expiryMrz(expiryTs);

  const recursive = await resolveZkPassportRecursiveArtifacts(
    witness.zkPassportOuterProof,
    options.registryClient,
  );
  const commitments = new Set(
    getParamCommitmentsFromOuterProof({ publicInputs: recursive.publicInputs } as Parameters<
      typeof getParamCommitmentsFromOuterProof
    >[0]).map(value => value.toString()),
  );
  const candidates = await Promise.all(
    (Object.keys(LAYOUTS) as Array<keyof typeof LAYOUTS>).flatMap(layout =>
      MRZ_SUBTYPE_BYTES.map(async subtype => {
        const value = disclosure(layout, subtype, nationality, expiry);
        const commitment = await getDiscloseParameterCommitment(value.mask, value.bytes);
        return { layout, value, commitment };
      }),
    ),
  );
  const disclosureMatch = candidates.find(candidate => commitments.has(candidate.commitment.toString()));
  if (!disclosureMatch) {
    throw new Error("Nationality and expiry do not match the authenticated zkPassport disclosure.");
  }

  const recovery = {
    ethereumChainId: field(witness.recovery.ethereumChainId, "ethereumChainId", true),
    recoveryPortalL1Address: field(witness.recovery.recoveryPortalL1Address, "recoveryPortalL1Address", true),
    aztecProtocolVersion: field(witness.recovery.aztecProtocolVersion, "aztecProtocolVersion", true),
    aztecChainId: field(witness.recovery.aztecChainId, "aztecChainId", true),
    issuerL2Address: field(witness.recovery.issuerL2Address, "issuerL2Address", true),
    destination: field(witness.recovery.destination, "destination", true),
    recoveryNonce: field(witness.recovery.recoveryNonce, "recoveryNonce", true),
    messageSecretHash: field(witness.recovery.messageSecretHash, "messageSecretHash", true),
  };
  const recoveryIntent = computeRecoveryIntent(recovery);
  const bindCustomData = formatRecoveryBindCustomData(recoveryIntent);
  const [ageCommitment, bindCommitment] = await Promise.all([
    getAgeParameterCommitment(minAge, maxAge),
    getBindParameterCommitment(formatBoundData({ custom_data: bindCustomData })),
  ]);
  if (!commitments.has(ageCommitment.toString())) {
    throw new Error("Age predicate does not match the authenticated zkPassport proof.");
  }
  if (!commitments.has(bindCommitment.toString())) {
    throw new Error("The proof is not bound to this exact Recovery V3 destination, nonce, portal, and Inbox secret.");
  }

  const rootKey = field(witness.facematch.rootKeyLeaf, "facematch.rootKeyLeaf");
  if (![APPLE_APP_ATTEST_ROOT_KEY_HASH, GOOGLE_APP_ATTEST_RSA_ROOT_KEY_HASH, GOOGLE_APP_ATTEST_ECDSA_P384_ROOT_KEY_HASH].includes(rootKey)) {
    throw new Error("Facematch root key is not an official Apple or Google attestation root.");
  }
  const appId = field(witness.facematch.appIdHash, "facematch.appIdHash");
  if (appId !== ZKPASSPORT_IOS_APP_ID_HASH && appId !== ZKPASSPORT_ANDROID_APP_ID_HASH) {
    throw new Error("Facematch app ID is not the official zkPassport app.");
  }
  const integrityKey = field(witness.facematch.integrityPublicKeyHash, "facematch.integrityPublicKeyHash");
  const expectedIntegrity = appId === ZKPASSPORT_ANDROID_APP_ID_HASH ? GOOGLE_PLAY_INTEGRITY_PUBLIC_KEY_HASH : 0n;
  if (integrityKey !== expectedIntegrity) throw new Error("Facematch integrity key does not match the platform.");
  if (witness.facematch.environment !== "production" || witness.facematch.mode !== "regular") {
    throw new Error("Recovery V3 development requires official production-environment regular FaceMatch.");
  }
  const facematchCommitment = await getFacematchParameterCommitment(
    rootKey,
    FACEMATCH_PRODUCTION,
    appId,
    FACEMATCH_REGULAR,
  );
  if (!commitments.has(facematchCommitment.toString())) {
    throw new Error("Facematch parameters do not match the authenticated zkPassport proof.");
  }

  if (BigInt(recursive.publicInputs[9]) !== BigInt(PASSPORT_A2_DEVELOPMENT_NULLIFIER_TYPE)) {
    throw new Error("Recovery V3 development requires the official NON_SALTED_MOCK identifier.");
  }
  if (BigInt(recursive.publicInputs[11]) !== BigInt(PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH)) {
    throw new Error("Recovery V3 development requires OPRF disabled and a zero OPRF key hash.");
  }
  const proofCurrentDate = u64(recursive.publicInputs[2], "proofCurrentDate");
  const identityValue = field(recursive.publicInputs[10], "identityValue", true);
  const rootCommitment = computeRecoveryRootCommitmentField({
    identityValue,
  });
  const claims = deriveRecoveryClaims({
    identityValue,
    recoveryNonce: recovery.recoveryNonce,
    nationalityAlpha3: witness.nationalityAlpha3,
    minAgeProven,
    passportExpiry: expiryTs,
    proofCurrentDate,
  });
  const authorization = computeRecoveryAuthorization({
    recoveryIntent,
    rootCommitment,
    claimsHash: claims.claimsHash,
    credentialValidUntil: claims.credentialValidUntil,
  });
  const trustContext = computeRecoveryTrustContext({
    ethereumChainId: recovery.ethereumChainId,
    recoveryPortalL1Address: recovery.recoveryPortalL1Address,
    aztecProtocolVersion: recovery.aztecProtocolVersion,
    aztecChainId: recovery.aztecChainId,
    issuerL2Address: recovery.issuerL2Address,
    serviceScopeHash: recursive.publicInputs[3],
    serviceSubscopeHash: recursive.publicInputs[4],
    nullifierType: recursive.publicInputs[9],
    oprfPublicKeyHash: recursive.publicInputs[11],
    recoveryWrapperVersion: RECOVERY_WRAPPER_VERSION,
  });
  const outputs: RecoveryWrapperPublicOutputs = {
    schema: MAGNA_RECOVERY_V3_SCHEMA.toString(),
    authorization: authorization.toString(),
    messageSecretHash: recovery.messageSecretHash.toString(),
    proofCurrentDate: proofCurrentDate.toString(),
    certificateRegistryRoot: field(recursive.publicInputs[0], "certificateRegistryRoot", true).toString(),
    circuitRegistryRoot: field(recursive.publicInputs[1], "circuitRegistryRoot", true).toString(),
    trustContext: trustContext.toString(),
  };
  assertNonZeroOutputs(outputs);
  const publicInputs = Object.values(outputs);

  return {
    inputs: {
      zkpassport_outer_vkey: recursive.vkeyFields,
      zkpassport_outer_proof: recursive.proofFields,
      zkpassport_outer_public_inputs: recursive.publicInputs,
      disclose_mask: disclosureMatch.value.mask.map(Boolean),
      disclosed_bytes: disclosureMatch.value.bytes.map(String),
      nationality: nationality.map(String),
      expiry_mrz: expiry.map(String),
      min_age_proven: String(minAgeProven),
      age_min_bound: String(minAge),
      age_max_bound: String(maxAge),
      facematch_root_key_leaf: rootKey.toString(),
      facematch_environment: FACEMATCH_PRODUCTION.toString(),
      facematch_app_id_hash: appId.toString(),
      facematch_integrity_public_key_hash: integrityKey.toString(),
      facematch_mode: FACEMATCH_REGULAR.toString(),
      ethereum_chain_id: recovery.ethereumChainId.toString(),
      recovery_portal_l1_address: recovery.recoveryPortalL1Address.toString(),
      aztec_protocol_version: recovery.aztecProtocolVersion.toString(),
      aztec_chain_id: recovery.aztecChainId.toString(),
      issuer_l2_address: recovery.issuerL2Address.toString(),
      destination: recovery.destination.toString(),
      recovery_nonce: recovery.recoveryNonce.toString(),
      message_secret_hash: recovery.messageSecretHash.toString(),
      recovery_wrapper_version: RECOVERY_WRAPPER_VERSION.toString(),
    },
    publicInputs,
    outputs,
    metadata: {
      recoveryIntent,
      bindCustomData,
      identityValue,
      rootCommitment,
      nationalityBlind: claims.nationalityBlind,
      expiryBlind: claims.expiryBlind,
      nationalityCommitment: claims.nationalityCommitment,
      expiryCommitment: claims.expiryCommitment,
      claimsHash: claims.claimsHash,
      credentialValidUntil: claims.credentialValidUntil,
      authorization,
      trustContext,
      mrzLayout: disclosureMatch.layout,
    },
  };
}
