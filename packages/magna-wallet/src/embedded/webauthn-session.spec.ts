import test from "node:test";
import assert from "node:assert/strict";
import {
  getEmbeddedPxeDatabaseName,
  isAztecWorldStateAnchorError,
  getEmbeddedWalletDatabaseName,
} from "../browser/pxe-cache.js";
import {
  loadStoredWebAuthnAccounts,
  parseWebAuthnPublicKeyRecoveryBundle,
  rememberWebAuthnWalletSessionAccount,
  saveStoredWebAuthnAccount,
  selectStoredWebAuthnAccount,
  serializeWebAuthnPublicKeyRecoveryBundle,
  storedWebAuthnAccountFromRegistration,
  webAuthnPrfOutputsToAccountMaterial,
} from "./webauthn-session.js";
import type { WebAuthnRegistration } from "../webauthn/ceremony.js";

test("PRF-backed stored WebAuthn accounts do not persist raw wallet material", () => {
  const stored = storedWebAuthnAccountFromRegistration(
    registrationFixture(),
    "0xabc",
    "Magna wallet · 2026-08-27 17:04:12",
  );
  const serialized = JSON.stringify(stored);

  assert.equal(stored.walletMaterialSource, "webauthn-prf");
  assert.equal(stored.displayName, "Magna wallet · 2026-08-27 17:04:12");
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

test("saving WebAuthn accounts retains distinct named passkeys for the same wallet origin", () => {
  const storage = memoryStorage();
  const stale = storedWebAuthnAccountFromRegistration(registrationFixture(), "0xstale");
  const fresh = storedWebAuthnAccountFromRegistration(
    {
      ...registrationFixture(),
      credentialId: new Uint8Array([5, 6, 7, 8]),
    },
    "0xfresh",
  );

  saveStoredWebAuthnAccount(storage, stale);
  saveStoredWebAuthnAccount(storage, fresh);

  assert.deepEqual(loadStoredWebAuthnAccounts(storage), [stale, fresh]);
});

test("saving an updated WebAuthn account replaces only the same credential/address", () => {
  const storage = memoryStorage();
  const original = storedWebAuthnAccountFromRegistration(registrationFixture(), "0xwallet", "Old name");
  const updated = { ...original, displayName: "New name" };

  saveStoredWebAuthnAccount(storage, original);
  saveStoredWebAuthnAccount(storage, updated);

  assert.deepEqual(loadStoredWebAuthnAccounts(storage), [updated]);
});

test("an authenticated passkey session can restore an overwritten browser lookup record", async () => {
  const storage = memoryStorage();
  const remembered = await rememberWebAuthnWalletSessionAccount(
    {
      kind: "passkey",
      label: "WebAuthn source",
      wallet: {} as never,
      accounts: [{ alias: "source", address: "0xsource" }],
      activeAccount: { alias: "source", address: "0xsource" },
      disconnect: async () => undefined,
      metadata: {
        credentialId: "source-credential",
        passkeyName: "Magna wallet · source",
        publicKeyRecoveryBundle: `04${"01".repeat(32)}${"02".repeat(32)}`,
      },
    },
    {
      rpId: "wallet.example",
      origin: "https://wallet.example",
      storage,
    },
  );

  assert.equal(remembered.address, "0xsource");
  assert.equal(remembered.displayName, "Magna wallet · source");
  assert.equal(remembered.credentialId, "source-credential");
  assert.deepEqual(loadStoredWebAuthnAccounts(storage), [remembered]);
});

test("stored passkey selection uses the exact named credential instead of the first account", () => {
  const first = storedWebAuthnAccountFromRegistration(registrationFixture(), "0xold", "Magna wallet · old");
  const recovered = storedWebAuthnAccountFromRegistration(
    { ...registrationFixture(), credentialId: new Uint8Array([9, 8, 7, 6]) },
    "0xrecovered",
    "Magna recovery · new",
  );

  assert.equal(
    selectStoredWebAuthnAccount([first, recovered], {
      rpId: "wallet.example",
      origin: "https://wallet.example",
      credentialId: recovered.credentialId,
    }),
    recovered,
  );
  assert.throws(
    () => selectStoredWebAuthnAccount([first, recovered], {
      rpId: "wallet.example",
      origin: "https://wallet.example",
    }),
    /Multiple Magna passkeys/,
  );
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
  assert.equal(
    isAztecWorldStateAnchorError(new Error("Block hash not found for block number 24")),
    true,
  );
  assert.equal(isAztecWorldStateAnchorError(new Error("Invalid tx: Block header not found")), false);
});

test("embedded wallet store names match the Aztec 5.1 SQLite-OPFS identity layout", () => {
  const rollupAddress = "0x322813fd9a801c5507c9de605d63cea4f2ce6c44";

  assert.equal(getEmbeddedPxeDatabaseName(31337, rollupAddress), "pxe_data_31337-0x322813fd9a801c5507c9de605d63cea4f2ce6c44-v13");
  assert.equal(getEmbeddedWalletDatabaseName(31337, rollupAddress), "wallet_data_31337-0x322813fd9a801c5507c9de605d63cea4f2ce6c44-v1");
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
    transports: ["internal", "hybrid"],
  };
}

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}
