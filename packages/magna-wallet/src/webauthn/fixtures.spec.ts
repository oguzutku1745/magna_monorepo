import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { FIXTURE } from "./generated-webauthn-fixtures.js";
import { buildWebAuthnWitnessFields, findOriginIndex } from "./witness.js";
import { normalizeSToLow } from "./der.js";

test("generated fixture is internally consistent", async () => {
  assert.equal(findOriginIndex(FIXTURE.clientDataJSON), FIXTURE.originIndex);
  // s is already low-s: normalization is a no-op
  assert.deepEqual(
    normalizeSToLow(FIXTURE.signatureRS.slice(32)),
    FIXTURE.signatureRS.slice(32),
  );
  // signature verifies over ad || sha256(cdj) with the fixture key
  const key = await webcrypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256",
      x: Buffer.from(FIXTURE.publicKeyX).toString("base64url"),
      y: Buffer.from(FIXTURE.publicKeyY).toString("base64url"),
    },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
  );
  const cdjHash = new Uint8Array(await webcrypto.subtle.digest("SHA-256", FIXTURE.clientDataJSON));
  const payload = new Uint8Array([...FIXTURE.authenticatorData, ...cdjHash]);
  const ok = await webcrypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, FIXTURE.signatureRS, payload,
  );
  assert.equal(ok, true);
  // and the witness builder accepts it
  const fields = buildWebAuthnWitnessFields({
    signatureRS: FIXTURE.signatureRS,
    authenticatorData: FIXTURE.authenticatorData,
    clientDataJSON: FIXTURE.clientDataJSON,
    originIndex: FIXTURE.originIndex,
  });
  assert.equal(fields.length, 387);
});
