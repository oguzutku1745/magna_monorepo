/**
 * Strict ASN.1 DER decoding for WebAuthn ES256 assertion signatures
 * (Ecdsa-Sig-Value per RFC 3279 section 2.2.3, mandated by WebAuthn L3 section 6.5.5)
 * and BIP-0062 low-s normalization required by Noir/barretenberg.
 */

export const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);

export function decodeEcdsaDerSignature(der: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  let offset = 0;
  const fail = (why: string): never => {
    throw new Error(`malformed DER signature: ${why}`);
  };
  if (der.length < 8 || der[offset++] !== 0x30) fail("not a SEQUENCE");
  const seqLen = der[offset++];
  if (seqLen & 0x80) fail("long-form length not allowed for P-256 signatures");
  if (seqLen !== der.length - 2) fail("sequence length mismatch / trailing bytes");

  const readInteger = (): Uint8Array => {
    if (der[offset++] !== 0x02) fail("expected INTEGER");
    const len = der[offset++];
    if (len === 0 || len & 0x80) fail("bad INTEGER length");
    if (offset + len > der.length) fail("INTEGER overruns buffer");
    const bytes = der.slice(offset, offset + len);
    offset += len;
    if (bytes[0] & 0x80) fail("negative INTEGER");
    if (bytes.length > 1 && bytes[0] === 0x00 && !(bytes[1] & 0x80)) {
      fail("non-minimal INTEGER encoding");
    }
    const stripped = bytes[0] === 0x00 ? bytes.slice(1) : bytes;
    if (stripped.length > 32) fail("INTEGER too large for P-256");
    if (stripped.every(b => b === 0)) fail("zero INTEGER");
    if (bytesToBigInt(stripped) >= P256_ORDER) fail("INTEGER out of range for P-256");
    const out = new Uint8Array(32);
    out.set(stripped, 32 - stripped.length);
    return out;
  };

  const r = readInteger();
  const s = readInteger();
  if (offset !== der.length) fail("trailing bytes after INTEGERs");
  return { r, s };
}

/**
 * Noir/barretenberg reject high-s signatures (BIP-0062), and authenticators
 * are not required to emit low-s, so the wallet must NORMALIZE (s := n - s),
 * never reject: rejecting would fail roughly half of genuine assertions.
 */
export function normalizeSToLow(s: Uint8Array): Uint8Array {
  if (s.length !== 32) {
    throw new Error("signature s must be 32 bytes");
  }
  const value = bytesToBigInt(s);
  if (value === 0n || value >= P256_ORDER) {
    throw new Error("signature s out of range for P-256");
  }
  if (value <= P256_ORDER >> 1n) return s;
  return bigIntTo32Bytes(P256_ORDER - value);
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bigIntTo32Bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
