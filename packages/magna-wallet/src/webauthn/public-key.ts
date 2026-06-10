import { decodeCbor } from "./cbor.js";

export type P256PublicKey = { x: Uint8Array; y: Uint8Array };

const P256_P = BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff");
const P256_B = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");

async function cryptoApi(): Promise<Crypto> {
  if (typeof globalThis.crypto?.subtle !== "undefined") return globalThis.crypto;
  try {
    const { webcrypto } = await import("node:crypto");
    return webcrypto as Crypto;
  } catch {
    // Fall through to the uniform error below.
  }
  throw new Error("WebCrypto is not available in this runtime");
}

function base64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = typeof atob === "function"
    ? atob(padded)
    : Buffer.from(padded, "base64").toString("binary");
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

/** Parse a DER SubjectPublicKeyInfo (getPublicKey() output) into raw x/y. */
export async function p256PublicKeyFromSpki(spki: Uint8Array): Promise<P256PublicKey> {
  const crypto = await cryptoApi();
  const key = await crypto.subtle.importKey(
    "spki", toArrayBuffer(spki), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.x || !jwk.y) throw new Error("SPKI did not contain a P-256 public key");
  return { x: base64urlToBytes(jwk.x), y: base64urlToBytes(jwk.y) };
}

/** Parse a COSE_Key (EC2, P-256) CBOR map into raw x/y. */
export function parseCoseP256PublicKey(coseKeyBytes: Uint8Array): P256PublicKey {
  return parseCoseP256PublicKeyInternal(coseKeyBytes, false).key;
}

function parseCoseP256PublicKeyInternal(
  coseKeyBytes: Uint8Array,
  allowTrailingBytes: boolean,
): { key: P256PublicKey; bytesRead: number } {
  const { value, bytesRead } = decodeCbor(coseKeyBytes);
  if (!allowTrailingBytes && bytesRead !== coseKeyBytes.length) throw new Error("COSE key has trailing bytes");
  if (!(value instanceof Map)) throw new Error("COSE key is not a CBOR map");
  if (value.get(1) !== 2) throw new Error("COSE kty is not EC2");
  if (value.get(3) !== -7) throw new Error("COSE alg is not ES256");
  if (value.get(-1) !== 1) throw new Error("COSE crv is not P-256");
  const x = value.get(-2);
  const y = value.get(-3);
  if (!(x instanceof Uint8Array) || x.length !== 32) throw new Error("bad COSE x");
  if (!(y instanceof Uint8Array) || y.length !== 32) throw new Error("bad COSE y");
  assertP256Point(x, y);
  return { key: { x, y }, bytesRead };
}

/**
 * Fallback for browsers/responses where getPublicKey() returns null (allowed
 * by spec): parse attestationObject -> authData -> attested credential data
 * -> COSE key. authData layout (WebAuthn L3 section 6.1 / section 6.5.1):
 * rpIdHash(32) | flags(1) | signCount(4) | aaguid(16) | credIdLen(2) | credId | COSE key
 */
export function p256PublicKeyFromAttestationObject(attestationObject: Uint8Array): P256PublicKey {
  const { value, bytesRead } = decodeCbor(attestationObject);
  if (bytesRead !== attestationObject.length) throw new Error("attestationObject has trailing bytes");
  if (!(value instanceof Map)) throw new Error("attestationObject is not a CBOR map");
  const authData = value.get("authData");
  if (!(authData instanceof Uint8Array)) throw new Error("attestationObject missing authData");
  if (authData.length < 55) throw new Error("authData too short");
  const flags = authData[32];
  if (!(flags & 0x40)) throw new Error("authData has no attested credential data (AT flag)");
  const hasExtensions = (flags & 0x80) !== 0;
  const credIdLen = (authData[53] << 8) | authData[54];
  const coseStart = 55 + credIdLen;
  if (coseStart >= authData.length) throw new Error("authData missing COSE key");
  const parsed = parseCoseP256PublicKeyInternal(authData.slice(coseStart), hasExtensions);
  const trailingStart = coseStart + parsed.bytesRead;
  if (hasExtensions) {
    const trailing = authData.slice(trailingStart);
    const extensions = decodeCbor(trailing);
    if (extensions.bytesRead !== trailing.length) throw new Error("authData extension data has trailing bytes");
    if (!(extensions.value instanceof Map)) throw new Error("authData extension data is not a CBOR map");
  } else if (trailingStart !== authData.length) {
    throw new Error("authData has trailing bytes after COSE key");
  }
  return parsed.key;
}

/**
 * Primary extraction path for registration: SPKI via getPublicKey() when
 * available (Chrome 85+/Firefox 119+/Safari 16+; may still return null per
 * spec), otherwise the CBOR attestationObject fallback. Never derive anything
 * from the credential ID.
 */
export async function extractP256PublicKey(
  response: AuthenticatorAttestationResponse,
): Promise<P256PublicKey> {
  const spki = typeof response.getPublicKey === "function" ? response.getPublicKey() : null;
  if (spki) return p256PublicKeyFromSpki(new Uint8Array(spki));
  return p256PublicKeyFromAttestationObject(new Uint8Array(response.attestationObject));
}

function assertP256Point(xBytes: Uint8Array, yBytes: Uint8Array): void {
  const x = bytesToBigInt(xBytes);
  const y = bytesToBigInt(yBytes);
  if (x >= P256_P || y >= P256_P) throw new Error("COSE point coordinate out of range");
  const lhs = mod(y * y);
  const rhs = mod((x * x * x) - (3n * x) + P256_B);
  if (lhs !== rhs) throw new Error("COSE point is not on P-256");
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function mod(value: bigint): bigint {
  const result = value % P256_P;
  return result >= 0n ? result : result + P256_P;
}
