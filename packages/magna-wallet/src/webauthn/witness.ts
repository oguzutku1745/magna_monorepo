/**
 * Auth-witness field layout -- MUST match WEBAUTHN_WITNESS_LEN and the decode
 * loops in contracts/magna-webauthn-account/src/main.nr:
 *   [0..63] signature r||s, [64] adLen, [65..128] ad (zero-padded),
 *   [129] cdjLen, [130..385] cdj (zero-padded), [386] originIndex.
 */
export const WEBAUTHN_AD_MAX = 64;
export const WEBAUTHN_CDJ_MAX = 256;
export const WEBAUTHN_WITNESS_LEN = 64 + 1 + WEBAUTHN_AD_MAX + 1 + WEBAUTHN_CDJ_MAX + 1;

export type WebAuthnWitnessInput = {
  signatureRS: Uint8Array; // 64 bytes, low-s normalized
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  originIndex: number;
};

export function buildWebAuthnWitnessFields(input: WebAuthnWitnessInput): bigint[] {
  if (input.signatureRS.length !== 64) throw new Error("signature must be 64 bytes (r||s)");
  if (input.authenticatorData.length > WEBAUTHN_AD_MAX) {
    throw new Error(`authenticatorData exceeds ${WEBAUTHN_AD_MAX} bytes`);
  }
  if (input.clientDataJSON.length > WEBAUTHN_CDJ_MAX) {
    throw new Error(`clientDataJSON exceeds ${WEBAUTHN_CDJ_MAX} bytes`);
  }
  if (!Number.isInteger(input.originIndex) || input.originIndex < 0) {
    throw new Error("originIndex must be a non-negative integer");
  }
  const fields = new Array<bigint>(WEBAUTHN_WITNESS_LEN).fill(0n);
  for (let i = 0; i < 64; i++) fields[i] = BigInt(input.signatureRS[i]);
  fields[64] = BigInt(input.authenticatorData.length);
  for (let i = 0; i < input.authenticatorData.length; i++) {
    fields[65 + i] = BigInt(input.authenticatorData[i]);
  }
  fields[129] = BigInt(input.clientDataJSON.length);
  for (let i = 0; i < input.clientDataJSON.length; i++) {
    fields[130 + i] = BigInt(input.clientDataJSON[i]);
  }
  fields[386] = BigInt(input.originIndex);
  return fields;
}

/** Locate `"origin":"` in clientDataJSON; throws if absent or ambiguous. */
export function findOriginIndex(clientDataJSON: Uint8Array): number {
  const needle = new TextEncoder().encode('"origin":"');
  const first = indexOfBytes(clientDataJSON, needle, 0);
  if (first < 0) throw new Error("clientDataJSON has no origin field");
  if (indexOfBytes(clientDataJSON, needle, first + 1) >= 0) throw new Error("ambiguous origin field");
  return first;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, fromIndex: number): number {
  for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
    let matches = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return -1;
}
