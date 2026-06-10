import test from "node:test";
import assert from "node:assert/strict";
import { Fr } from "@aztec/aztec.js/fields";
import { MagnaWebAuthnAccountContract } from "./account-contract.js";
import { FIXTURE } from "./generated-webauthn-fixtures.js";

test("auth witness provider builds a 387-field witness from an assertion", async () => {
  const contract = new MagnaWebAuthnAccountContract(
    {
      publicKey: { x: FIXTURE.publicKeyX, y: FIXTURE.publicKeyY },
      rpId: FIXTURE.rpId,
      rpIdHash: FIXTURE.authenticatorData.slice(0, 32),
      origin: FIXTURE.origin,
      credentialId: new Uint8Array([1, 2, 3]),
    },
    // assertion provider stub returning the fixture regardless of challenge
    async () => ({
      signatureDER: null,
      signatureRS: FIXTURE.signatureRS,
      authenticatorData: FIXTURE.authenticatorData,
      clientDataJSON: FIXTURE.clientDataJSON,
    }),
  );
  const provider = contract.getAuthWitnessProvider({} as never);
  const witness = await provider.createAuthWit(fakeFr32());
  assert.equal(witness.witness.length, 387);
});

function fakeFr32(): Fr {
  return Fr.fromBufferReduce(Buffer.alloc(32, 9));
}
