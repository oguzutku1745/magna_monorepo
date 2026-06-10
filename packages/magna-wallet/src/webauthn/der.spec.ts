import test from "node:test";
import assert from "node:assert/strict";
import { decodeEcdsaDerSignature, normalizeSToLow, P256_ORDER } from "./der.js";

function hex(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s.replace(/\s/g, ""), "hex"));
}

// Build a syntactically valid DER ECDSA-Sig-Value from raw r/s bigints.
function derFromRs(r: bigint, s: bigint): Uint8Array {
  const int = (v: bigint) => {
    const h = v.toString(16).padStart(2, "0");
    let b = Buffer.from(h.length % 2 ? "0" + h : h, "hex");
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return Buffer.concat([Buffer.from([0x02, b.length]), b]);
  };
  const body = Buffer.concat([int(r), int(s)]);
  return Uint8Array.from(Buffer.concat([Buffer.from([0x30, body.length]), body]));
}

test("decodes DER with leading-zero-padded r", () => {
  const r = BigInt("0x" + "80".padEnd(64, "1")); // high bit set -> DER pads with 0x00
  const s = 7n;
  const { r: r32, s: s32 } = decodeEcdsaDerSignature(derFromRs(r, s));
  assert.equal(r32.length, 32);
  assert.equal(s32.length, 32);
  assert.equal(BigInt("0x" + Buffer.from(r32).toString("hex")), r);
  assert.equal(BigInt("0x" + Buffer.from(s32).toString("hex")), s);
});

test("rejects non-sequence input", () => {
  assert.throws(() => decodeEcdsaDerSignature(hex("31 06 02 01 01 02 01 01")), /malformed DER/);
});

test("rejects trailing garbage", () => {
  const der = Buffer.concat([derFromRs(5n, 6n), Buffer.from([0x00])]);
  assert.throws(() => decodeEcdsaDerSignature(Uint8Array.from(der)), /malformed DER/);
});

test("rejects negative integers", () => {
  // INTEGER with high bit set and no 0x00 pad = negative in DER
  assert.throws(
    () => decodeEcdsaDerSignature(hex("30 06 02 01 81 02 01 01")),
    /malformed DER/,
  );
});

test("rejects non-minimal integer encoding", () => {
  // 0x00 pad before a byte without high bit set is non-minimal
  assert.throws(
    () => decodeEcdsaDerSignature(hex("30 07 02 02 00 01 02 01 01")),
    /malformed DER/,
  );
});

test("rejects zero r or s", () => {
  assert.throws(() => decodeEcdsaDerSignature(derFromRs(0n, 5n)), /malformed DER|zero/);
});

test("rejects r or s wider than 32 bytes", () => {
  const tooBig = (1n << 256n) + 5n;
  assert.throws(() => decodeEcdsaDerSignature(derFromRs(tooBig, 5n)), /malformed DER|too large/);
});

test("rejects r or s outside the P-256 scalar range", () => {
  assert.throws(() => decodeEcdsaDerSignature(derFromRs(P256_ORDER, 5n)), /malformed DER|out of range/);
  assert.throws(() => decodeEcdsaDerSignature(derFromRs(5n, P256_ORDER)), /malformed DER|out of range/);
});

test("normalizeSToLow leaves low s unchanged", () => {
  const low = P256_ORDER / 2n - 1n;
  const out = normalizeSToLow(to32(low));
  assert.equal(fromBytes(out), low);
});

test("normalizeSToLow maps high s to n - s", () => {
  const high = P256_ORDER / 2n + 12345n;
  const out = normalizeSToLow(to32(high));
  assert.equal(fromBytes(out), P256_ORDER - high);
});

test("normalizeSToLow rejects s = 0 and s >= n", () => {
  assert.throws(() => normalizeSToLow(to32(0n)));
  assert.throws(() => normalizeSToLow(to32(P256_ORDER)));
});

test("normalizeSToLow rejects non-canonical byte lengths", () => {
  assert.throws(() => normalizeSToLow(Uint8Array.from([1])));
});

function to32(v: bigint): Uint8Array {
  return Uint8Array.from(Buffer.from(v.toString(16).padStart(64, "0"), "hex"));
}
function fromBytes(b: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(b).toString("hex"));
}
