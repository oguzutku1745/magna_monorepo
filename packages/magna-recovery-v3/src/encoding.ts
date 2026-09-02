import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync";
import { Fr } from "@aztec/foundation/curves/bn254";
import { computeSecretHash } from "@aztec/stdlib/hash";
import {
  formatBoundData,
  getServiceScopeHash,
  getServiceSubscopeHash,
} from "@zkpassport/utils";
import {
  MAGNA_CLAIMS_DS,
  MAGNA_PASSPORT_COMMITTED_CLAIMS_SCHEMA,
  MAGNA_PASSPORT_CREDENTIAL_TYPE,
  MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
  MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
  MAGNA_RECOVERED_CREDENTIAL_MAX_AGE_SECONDS,
  MAGNA_RECOVERY_AUTH_V3_DS,
  MAGNA_RECOVERY_BIND_PREFIX,
  MAGNA_RECOVERY_BLIND_V3_DS,
  MAGNA_RECOVERY_INTENT_V3_DS,
  MAGNA_ROOT_DS,
  MAGNA_RECOVERY_TRUST_V3_DS,
  MAGNA_RECOVERY_V3_SCHEMA,
} from "./constants.js";

export type FieldLike = bigint | number | string | { toBigInt(): bigint };

export type RecoveryIdentityInput = {
  identityValue: FieldLike;
};

const MAX_U64 = (1n << 64n) - 1n;
const MAX_U8 = 255n;
const MAX_ETH_ADDRESS = (1n << 160n) - 1n;

export type RecoveryIntentInput = {
  ethereumChainId: FieldLike;
  recoveryPortalL1Address: FieldLike;
  aztecProtocolVersion: FieldLike;
  aztecChainId: FieldLike;
  issuerL2Address: FieldLike;
  destination: FieldLike;
  recoveryNonce: FieldLike;
  messageSecretHash: FieldLike;
};

export type RecoveryTrustContextInput = {
  ethereumChainId: FieldLike;
  recoveryPortalL1Address: FieldLike;
  aztecProtocolVersion: FieldLike;
  aztecChainId: FieldLike;
  issuerL2Address: FieldLike;
  serviceScopeHash: FieldLike;
  serviceSubscopeHash: FieldLike;
  nullifierType: FieldLike;
  oprfPublicKeyHash: FieldLike;
  recoveryWrapperVersion: FieldLike;
};

export type RecoveryClaimsInput = {
  identityValue: FieldLike;
  recoveryNonce: FieldLike;
  nationalityAlpha3: string;
  minAgeProven: number;
  passportExpiry: FieldLike;
  proofCurrentDate: FieldLike;
};

export type DerivedRecoveryClaims = {
  nationalityBlind: bigint;
  expiryBlind: bigint;
  nationalityCommitment: bigint;
  expiryCommitment: bigint;
  claimsHash: bigint;
  credentialValidUntil: bigint;
};

export function asField(value: FieldLike, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = typeof value === "object" ? value.toBigInt() : BigInt(value);
  } catch {
    throw new Error(`${label} must be a BN254 field value.`);
  }
  if (parsed < 0n || parsed >= Fr.MODULUS) {
    throw new Error(`${label} must be a BN254 field value.`);
  }
  return parsed;
}

function asNonZeroField(value: FieldLike, label: string): bigint {
  const parsed = asField(value, label);
  if (parsed === 0n) throw new Error(`${label} must be non-zero.`);
  return parsed;
}

function asU64(value: FieldLike, label: string): bigint {
  const parsed = asField(value, label);
  if (parsed > MAX_U64) throw new Error(`${label} must fit in u64.`);
  return parsed;
}

function asEthAddress(value: FieldLike): bigint {
  const parsed = asField(value, "recoveryPortalL1Address");
  if (parsed === 0n || parsed > MAX_ETH_ADDRESS) {
    throw new Error("recoveryPortalL1Address must be a non-zero 20-byte Ethereum address.");
  }
  return parsed;
}

function poseidon(separator: number, values: bigint[]): bigint {
  return poseidon2HashWithSeparator(values, separator).toBigInt();
}

export function recoveryIdentityPreimage(input: RecoveryIdentityInput): bigint[] {
  const identityValue = asNonZeroField(input.identityValue, "identityValue");
  return [identityValue];
}

export function computeRecoveryRootCommitmentField(input: RecoveryIdentityInput): bigint {
  return poseidon(MAGNA_ROOT_DS, recoveryIdentityPreimage(input));
}

export async function computeRecoveryMessageSecretHash(messageSecret: FieldLike): Promise<bigint> {
  return (await computeSecretHash(new Fr(asNonZeroField(messageSecret, "messageSecret")))).toBigInt();
}

export function computeRecoveryIntent(input: RecoveryIntentInput): bigint {
  return poseidon(MAGNA_RECOVERY_INTENT_V3_DS, [
    MAGNA_RECOVERY_V3_SCHEMA,
    asNonZeroField(input.ethereumChainId, "ethereumChainId"),
    asEthAddress(input.recoveryPortalL1Address),
    asNonZeroField(input.aztecProtocolVersion, "aztecProtocolVersion"),
    asNonZeroField(input.aztecChainId, "aztecChainId"),
    asNonZeroField(input.issuerL2Address, "issuerL2Address"),
    asNonZeroField(input.destination, "destination"),
    asNonZeroField(input.recoveryNonce, "recoveryNonce"),
    asNonZeroField(input.messageSecretHash, "messageSecretHash"),
  ]);
}

export function formatRecoveryBindCustomData(recoveryIntent: FieldLike): string {
  return `${MAGNA_RECOVERY_BIND_PREFIX}${asField(recoveryIntent, "recoveryIntent")
    .toString(16)
    .padStart(64, "0")}`;
}

export function formatRecoveryBindData(recoveryIntent: FieldLike): number[] {
  const customData = formatRecoveryBindCustomData(recoveryIntent);
  const encoded = formatBoundData({ custom_data: customData });
  if (encoded.length !== 3 + MAGNA_RECOVERY_BIND_PREFIX.length + 64) {
    throw new Error("Unexpected zkPassport 0.37.3 Bind encoding length.");
  }
  return encoded;
}

export function deriveZkPassportServiceContext(domain: string, scope?: string): {
  serviceScopeHash: bigint;
  serviceSubscopeHash: bigint;
} {
  if (!domain || domain !== domain.trim()) {
    throw new Error("zkPassport domain must be non-empty and contain no surrounding whitespace.");
  }
  const exactScope = scope ?? "";
  if (exactScope !== exactScope.trim()) {
    throw new Error("zkPassport scope must contain no surrounding whitespace.");
  }
  return {
    // Official terminology: outer service_scope is SHA-256(domain) >> 8.
    serviceScopeHash: getServiceScopeHash(domain),
    // outer service_subscope is SHA-256(the SDK request scope) >> 8, or zero.
    serviceSubscopeHash: exactScope ? getServiceSubscopeHash(exactScope) : 0n,
  };
}

export function computeRecoveryTrustContext(input: RecoveryTrustContextInput): bigint {
  const nullifierType = asField(input.nullifierType, "nullifierType");
  const oprfPublicKeyHash = asField(input.oprfPublicKeyHash, "oprfPublicKeyHash");
  const isProductionSalted = nullifierType === 1n && oprfPublicKeyHash !== 0n;
  const isDevelopmentNonSaltedMock = nullifierType === 2n && oprfPublicKeyHash === 0n;
  if (!isProductionSalted && !isDevelopmentNonSaltedMock) {
    throw new Error(
      "Recovery trust context must be production SALTED with a non-zero OPRF key hash or developer NON_SALTED_MOCK with a zero OPRF key hash.",
    );
  }
  return poseidon(MAGNA_RECOVERY_TRUST_V3_DS, [
    MAGNA_RECOVERY_V3_SCHEMA,
    asNonZeroField(input.ethereumChainId, "ethereumChainId"),
    asEthAddress(input.recoveryPortalL1Address),
    asNonZeroField(input.aztecProtocolVersion, "aztecProtocolVersion"),
    asNonZeroField(input.aztecChainId, "aztecChainId"),
    asNonZeroField(input.issuerL2Address, "issuerL2Address"),
    asField(input.serviceScopeHash, "serviceScopeHash"),
    asField(input.serviceSubscopeHash, "serviceSubscopeHash"),
    nullifierType,
    oprfPublicKeyHash,
    asNonZeroField(input.recoveryWrapperVersion, "recoveryWrapperVersion"),
  ]);
}

export function packAlpha3(alpha3: string): bigint {
  if (!/^[A-Z]{3}$/.test(alpha3)) {
    throw new Error("nationalityAlpha3 must be an uppercase ISO alpha-3 code.");
  }
  const bytes = new TextEncoder().encode(alpha3);
  return (BigInt(bytes[0]) << 16n) | (BigInt(bytes[1]) << 8n) | BigInt(bytes[2]);
}

export function deriveRecoveryClaims(input: RecoveryClaimsInput): DerivedRecoveryClaims {
  const identityValue = asNonZeroField(input.identityValue, "identityValue");
  const recoveryNonce = asNonZeroField(input.recoveryNonce, "recoveryNonce");
  const minAge = BigInt(input.minAgeProven);
  if (!Number.isInteger(input.minAgeProven) || minAge < 0n || minAge > MAX_U8) {
    throw new Error("minAgeProven must fit in u8.");
  }
  const passportExpiry = asU64(input.passportExpiry, "passportExpiry");
  const proofCurrentDate = asU64(input.proofCurrentDate, "proofCurrentDate");
  const policyExpiry = proofCurrentDate + MAGNA_RECOVERED_CREDENTIAL_MAX_AGE_SECONDS;
  if (policyExpiry > MAX_U64) throw new Error("credential policy expiry exceeds u64.");

  const nationalityBlind = poseidon(MAGNA_RECOVERY_BLIND_V3_DS, [
    MAGNA_RECOVERY_V3_SCHEMA,
    identityValue,
    recoveryNonce,
    1n,
  ]);
  const expiryBlind = poseidon(MAGNA_RECOVERY_BLIND_V3_DS, [
    MAGNA_RECOVERY_V3_SCHEMA,
    identityValue,
    recoveryNonce,
    2n,
  ]);
  const nationalityCommitment = poseidon(MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS, [
    packAlpha3(input.nationalityAlpha3),
    nationalityBlind,
  ]);
  const expiryCommitment = poseidon(MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS, [
    passportExpiry,
    expiryBlind,
  ]);
  const claimsHash = poseidon(MAGNA_CLAIMS_DS, [
    MAGNA_PASSPORT_COMMITTED_CLAIMS_SCHEMA,
    MAGNA_PASSPORT_CREDENTIAL_TYPE,
    nationalityCommitment,
    minAge,
    expiryCommitment,
  ]);

  return {
    nationalityBlind,
    expiryBlind,
    nationalityCommitment,
    expiryCommitment,
    claimsHash,
    credentialValidUntil: passportExpiry < policyExpiry ? passportExpiry : policyExpiry,
  };
}

export function computeRecoveryAuthorization(input: {
  recoveryIntent: FieldLike;
  rootCommitment: FieldLike;
  claimsHash: FieldLike;
  credentialValidUntil: FieldLike;
}): bigint {
  return poseidon(MAGNA_RECOVERY_AUTH_V3_DS, [
    MAGNA_RECOVERY_V3_SCHEMA,
    asNonZeroField(input.recoveryIntent, "recoveryIntent"),
    asNonZeroField(input.rootCommitment, "rootCommitment"),
    asNonZeroField(input.claimsHash, "claimsHash"),
    asNonZeroField(asU64(input.credentialValidUntil, "credentialValidUntil"), "credentialValidUntil"),
  ]);
}
