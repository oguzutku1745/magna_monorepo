import test from "node:test";
import assert from "node:assert/strict";
import { buildWebAuthnWitnessFields, findOriginIndex, WEBAUTHN_WITNESS_LEN } from "./witness.js";

const sig = new Uint8Array(64).fill(7);
const ad = new Uint8Array(37).fill(1);
const cdj = new TextEncoder().encode('{"type":"webauthn.get","challenge":"x"}');

test("witness layout matches the Noir contract", () => {
  const fields = buildWebAuthnWitnessFields({
    signatureRS: sig,
    authenticatorData: ad,
    clientDataJSON: cdj,
    originIndex: 81,
  });
  assert.equal(fields.length, WEBAUTHN_WITNESS_LEN);
  assert.equal(fields[0], 7n);                       // sig[0]
  assert.equal(fields[64], 37n);                     // ad length
  assert.equal(fields[65], 1n);                      // ad[0]
  assert.equal(fields[65 + 37], 0n);                 // ad zero padding
  assert.equal(fields[129], BigInt(cdj.length));     // cdj length
  assert.equal(fields[130], BigInt(cdj[0]));         // cdj[0] = '{'
  assert.equal(fields[130 + cdj.length], 0n);        // cdj zero padding
  assert.equal(fields[386], 81n);                    // origin index
});

test("rejects oversize inputs", () => {
  assert.throws(() => buildWebAuthnWitnessFields({
    signatureRS: sig,
    authenticatorData: new Uint8Array(65),
    clientDataJSON: cdj,
    originIndex: 0,
  }));
  assert.throws(() => buildWebAuthnWitnessFields({
    signatureRS: sig,
    authenticatorData: ad,
    clientDataJSON: new Uint8Array(257),
    originIndex: 0,
  }));
  assert.throws(() => buildWebAuthnWitnessFields({
    signatureRS: new Uint8Array(63),
    authenticatorData: ad,
    clientDataJSON: cdj,
    originIndex: 0,
  }));
});

test("findOriginIndex returns a byte offset", () => {
  const prefix = '{"type":"webauthn.get","display":"snowman ☃","origin":"';
  const clientDataJSON = new TextEncoder().encode(`${prefix}https://wallet.magna.xyz"}`);
  assert.equal(findOriginIndex(clientDataJSON), new TextEncoder().encode(prefix).length - '"origin":"'.length);
});

test("findOriginIndex rejects missing or ambiguous origin fields", () => {
  assert.throws(() => findOriginIndex(new TextEncoder().encode('{"type":"webauthn.get"}')));
  assert.throws(() => findOriginIndex(new TextEncoder().encode('{"origin":"a","origin":"b"}')));
});
