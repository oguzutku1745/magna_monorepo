import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync";
import { CredentialType } from "@magna/core";
import type { Hasher, InstagramCanonicalClaims, PassportCanonicalClaims } from "./types.js";

export const MAGNA_CLAIMS_DS = 0x4d414743n; // "MAGC"
export const MAGNA_REVOCATION_DS = 0x4d415247n; // "MARG"
export const MAGNA_ROOT_AUTHORITY_REVOCATION_DS = 0x4d415241n; // "MARA"
export const MAGNA_GHOST_DS = 0x4d414748n; // "MAGH"
export const MAGNA_INSTAGRAM_HANDLE_DS = 0x4d414948n; // "MAIH"
export const MAGNA_ROOT_DS = 0x4d414749n; // "MAGI"
// Backward-compatible alias.
export const MAGNA_RECOVERY_DS = MAGNA_GHOST_DS;
const textEncoder = new TextEncoder();

export function packAlpha3(alpha3: string): bigint {
  if (!/^[A-Z]{3}$/.test(alpha3)) {
    throw new Error(`invalid alpha3 country code: ${alpha3}`);
  }
  const [a, b, c] = alpha3.split("").map((ch) => ch.charCodeAt(0));
  return (BigInt(a) << 16n) | (BigInt(b) << 8n) | BigInt(c);
}

export const poseidon2FieldHasher: Hasher = (domainSeparator, fields) =>
  poseidon2HashWithSeparator(fields, Number(domainSeparator)).toBigInt();

export function computePassportClaimsHash(
  claims: PassportCanonicalClaims,
  hasher: Hasher,
): bigint {
  if (claims.credentialType !== CredentialType.Passport) {
    throw new Error("passport claims hash expects CredentialType.Passport");
  }
  return hasher(MAGNA_CLAIMS_DS, [
    BigInt(claims.schemaVersion),
    BigInt(claims.credentialType),
    claims.nationalityAlpha3Packed,
    BigInt(claims.minAgeProven),
    claims.expiryTs,
  ]);
}

export function computeInstagramHandleHash(handle: string): bigint {
  const bytes = textEncoder.encode(handle);
  if (bytes.length > 31) {
    throw new Error(
      `instagram handle does not fit in a single field: ${bytes.length} bytes (max 31)`,
    );
  }
  let packed = 0n;
  for (const byte of bytes) {
    packed = (packed << 8n) | BigInt(byte);
  }
  return poseidon2FieldHasher(MAGNA_INSTAGRAM_HANDLE_DS, [
    BigInt(bytes.length),
    packed,
  ]);
}

export function computeInstagramClaimsHash(
  claims: InstagramCanonicalClaims,
  hasher: Hasher,
): bigint {
  if (claims.credentialType !== CredentialType.Instagram) {
    throw new Error("instagram claims hash expects CredentialType.Instagram");
  }
  return hasher(MAGNA_CLAIMS_DS, [
    BigInt(claims.schemaVersion),
    BigInt(claims.credentialType),
    claims.handleHash,
    claims.expiryTs,
  ]);
}

export function computeRevocationNullifier(
  revocationSecret: bigint,
  credentialType: number,
  claimsHash: bigint,
  hasher: Hasher,
): bigint {
  return hasher(MAGNA_REVOCATION_DS, [revocationSecret, BigInt(credentialType), claimsHash]);
}

export function computeRootAuthorityRevocationNullifier(
  revocationSecret: bigint,
  rootCommitment: bigint,
  claimsHash: bigint,
  hasher: Hasher,
): bigint {
  return hasher(MAGNA_ROOT_AUTHORITY_REVOCATION_DS, [
    revocationSecret,
    rootCommitment,
    claimsHash,
  ]);
}
