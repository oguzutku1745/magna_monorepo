import test from "node:test";
import assert from "node:assert/strict";
import {
  getEmbeddedPxeDatabaseName,
  isAztecWorldStateAnchorError,
} from "../browser/pxe-cache.js";
import {
  parseWebAuthnPublicKeyRecoveryBundle,
  serializeWebAuthnPublicKeyRecoveryBundle,
  storedWebAuthnAccountFromRegistration,
  webAuthnPrfOutputsToAccountMaterial,
} from "./webauthn-session.js";
import type { WebAuthnRegistration } from "../webauthn/ceremony.js";

test("PRF-backed stored WebAuthn accounts do not persist raw wallet material", () => {
  const stored = storedWebAuthnAccountFromRegistration(registrationFixture(), "0xabc");
  const serialized = JSON.stringify(stored);

  assert.equal(stored.walletMaterialSource, "webauthn-prf");
  assert.equal("secretKey" in stored, false);
  assert.equal("salt" in stored, false);
  assert.equal(serialized.includes("secretKey"), false);
  assert.equal(serialized.includes("salt\""), false);
});

test("public key recovery value serializes as uncompressed P-256 public key hex", () => {
  const stored = storedWebAuthnAccountFromRegistration(registrationFixture(), "0xabc");
  const publicKey = serializeWebAuthnPublicKeyRecoveryBundle(stored);
  const parsed = parseWebAuthnPublicKeyRecoveryBundle(publicKey);

  assert.equal(parsed.kind, "magna-webauthn-public-key");
  assert.equal(parsed.version, 1);
  assert.equal(publicKey, `04${"01".repeat(32)}${"02".repeat(32)}`);
  assert.equal(parsed.publicKeyX, "01".repeat(32));
  assert.equal(parsed.publicKeyY, "02".repeat(32));
  assert.equal(parsed.rpId, undefined);
  assert.equal(parsed.origin, undefined);
  assert.equal(parsed.address, undefined);
  assert.equal(publicKey.includes("secretKey"), false);
  assert.equal(publicKey.includes("salt\""), false);
  assert.equal(publicKey.includes(stored.credentialId), false);
});

test("public key recovery parser accepts the previous metadata bundle format", () => {
  const parsed = parseWebAuthnPublicKeyRecoveryBundle(JSON.stringify({
    kind: "magna-webauthn-public-key",
    version: 1,
    publicKeyX: "01".repeat(32),
    publicKeyY: "02".repeat(32),
    rpId: "wallet.example",
    origin: "https://wallet.example",
    address: "0xabc",
  }));

  assert.equal(parsed.publicKeyX, "01".repeat(32));
  assert.equal(parsed.publicKeyY, "02".repeat(32));
  assert.equal(parsed.rpId, "wallet.example");
  assert.equal(parsed.origin, "https://wallet.example");
  assert.equal(parsed.address, "0xabc");
});

test("public key recovery parser rejects malformed coordinates", () => {
  assert.throws(
    () =>
      parseWebAuthnPublicKeyRecoveryBundle(JSON.stringify({
        kind: "magna-webauthn-public-key",
        version: 1,
        publicKeyX: "01",
        publicKeyY: "02".repeat(32),
        rpId: "wallet.example",
        origin: "https://wallet.example",
      })),
    /publicKeyX/,
  );
});

test("PRF outputs convert to deterministic Aztec account material", () => {
  const outputs = {
    secret: new Uint8Array(32).fill(11),
    salt: new Uint8Array(32).fill(12),
  };

  const first = webAuthnPrfOutputsToAccountMaterial(outputs);
  const second = webAuthnPrfOutputsToAccountMaterial(outputs);

  assert.equal(first.secret.toString(), second.secret.toString());
  assert.equal(first.salt.toString(), second.salt.toString());
});

test("Aztec world-state anchor errors are recognized without matching unrelated block errors", () => {
  assert.equal(
    isAztecWorldStateAnchorError(
      new Error(
        "Block hash 0x23f446977622ea28c317876ef49c6780f41156a87c8defca8e8629fe6e5be87b not found when querying world state. If the node API has been queried with anchor block hash possibly a reorg has occurred.",
      ),
    ),
    true,
  );
  assert.equal(isAztecWorldStateAnchorError(new Error("Invalid tx: Block header not found")), false);
});

test("embedded PXE cache reset targets only the PXE IndexedDB database", () => {
  const rollupAddress = "0x322813fd9a801c5507c9de605d63cea4f2ce6c44";

  assert.equal(getEmbeddedPxeDatabaseName(rollupAddress), "pxe_data_0x322813fd9a801c5507c9de605d63cea4f2ce6c44/pxe_data");
});

function registrationFixture(): WebAuthnRegistration {
  return {
    credentialId: new Uint8Array([1, 2, 3, 4]),
    publicKey: {
      x: new Uint8Array(32).fill(1),
      y: new Uint8Array(32).fill(2),
    },
    rpId: "wallet.example",
    rpIdHash: new Uint8Array(32).fill(3),
    origin: "https://wallet.example",
  };
}
