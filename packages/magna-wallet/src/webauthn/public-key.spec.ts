import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  p256PublicKeyFromAttestationObject,
  p256PublicKeyFromSpki,
  parseCoseP256PublicKey,
} from "./public-key.js";

test("extracts x/y from SPKI", async () => {
  const kp = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const spki = new Uint8Array(await webcrypto.subtle.exportKey("spki", kp.publicKey));
  const jwk = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
  const { x, y } = await p256PublicKeyFromSpki(spki);
  assert.equal(Buffer.from(x).toString("base64url"), jwk.x);
  assert.equal(Buffer.from(y).toString("base64url"), jwk.y);
});

test("parses COSE EC2 P-256 key from raw CBOR", async () => {
  // Minimal COSE_Key: {1: 2, 3: -7, -1: 1, -2: x(32), -3: y(32)}
  const { x, y } = await generatedPoint();
  const cose = coseKey(x, y);
  const key = parseCoseP256PublicKey(cose);
  assert.deepEqual(key.x, x);
  assert.deepEqual(key.y, y);
});

test("extracts COSE key from attestationObject authData", async () => {
  const { x, y } = await generatedPoint();
  const cose = coseKey(x, y);
  const authData = new Uint8Array([
    ...new Uint8Array(32), // rpIdHash
    0x40, // AT flag
    0, 0, 0, 0, // signCount
    ...new Uint8Array(16), // aaguid
    0, 0, // credential ID length
    ...cose,
  ]);
  const key = p256PublicKeyFromAttestationObject(cborMap([["authData", authData]]));
  assert.deepEqual(key.x, x);
  assert.deepEqual(key.y, y);
});

test("accepts well-formed extension data after attested COSE key", async () => {
  const { x, y } = await generatedPoint();
  const cose = coseKey(x, y);
  const authData = new Uint8Array([
    ...new Uint8Array(32),
    0xc0, // AT | ED flags
    0, 0, 0, 0,
    ...new Uint8Array(16),
    0, 0,
    ...cose,
    0xa0, // empty extensions map
  ]);
  const key = p256PublicKeyFromAttestationObject(cborMap([["authData", authData]]));
  assert.deepEqual(key.x, x);
  assert.deepEqual(key.y, y);
});

test("rejects malformed extension data after attested COSE key", async () => {
  const { x, y } = await generatedPoint();
  const authData = new Uint8Array([
    ...new Uint8Array(32),
    0xc0,
    0, 0, 0, 0,
    ...new Uint8Array(16),
    0, 0,
    ...coseKey(x, y),
    0xff,
  ]);
  assert.throws(() => p256PublicKeyFromAttestationObject(cborMap([["authData", authData]])));
});

test("rejects invalid COSE coordinates and duplicate labels", () => {
  const invalid = new Uint8Array(32).fill(1);
  assert.throws(() => parseCoseP256PublicKey(coseKey(invalid, invalid)), /P-256/);
  assert.throws(
    () => parseCoseP256PublicKey(Uint8Array.from([0xa2, 0x01, 0x02, 0x01, 0x02])),
    /duplicate/,
  );
});

async function generatedPoint(): Promise<{ x: Uint8Array; y: Uint8Array }> {
  const kp = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
  return {
    x: Uint8Array.from(Buffer.from(jwk.x!, "base64url")),
    y: Uint8Array.from(Buffer.from(jwk.y!, "base64url")),
  };
}

function coseKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  return Uint8Array.from([
    0xa5,             // map(5)
    0x01, 0x02,       // 1: 2 (kty EC2)
    0x03, 0x26,       // 3: -7 (alg ES256)
    0x20, 0x01,       // -1: 1 (crv P-256)
    0x21, 0x58, 0x20, ...x, // -2: bytes(32)
    0x22, 0x58, 0x20, ...y, // -3: bytes(32)
  ]);
}

function cborMap(entries: Array<[string, Uint8Array]>): Uint8Array {
  return Uint8Array.from([
    0xa0 + entries.length,
    ...entries.flatMap(([key, value]) => [...cborText(key), ...cborBytes(value)]),
  ]);
}

function cborText(value: string): number[] {
  const bytes = new TextEncoder().encode(value);
  return [0x60 + bytes.length, ...bytes];
}

function cborBytes(value: Uint8Array): number[] {
  if (value.length < 24) return [0x40 + value.length, ...value];
  if (value.length < 256) return [0x58, value.length, ...value];
  throw new Error("test helper supports only short byte strings");
}
