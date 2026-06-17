import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  AZTEC_ACCOUNT_SALT_PRF_LABEL,
  AZTEC_ACCOUNT_SECRET_PRF_LABEL,
  discoverWebAuthnAccountPrf,
  evaluateWebAuthnAccountPrf,
  type WebAuthnRegistration,
} from "./ceremony.js";

test("evaluates credential-scoped PRF outputs for Aztec account material", async () => {
  const getCalls: PublicKeyCredentialRequestOptions[] = [];
  const secretOutput = new Uint8Array(32).fill(7);
  const saltOutput = new Uint8Array(32).fill(9);

  using _globals = installWebAuthnGlobals({
    get: async options => {
      getCalls.push(options.publicKey);
      return new FakePublicKeyCredential({
        prf: {
          results: {
            first: secretOutput.buffer,
            second: saltOutput.buffer,
          },
        },
      });
    },
  });

  const material = await evaluateWebAuthnAccountPrf(registrationFixture());

  assert.deepEqual(material.secret, secretOutput);
  assert.deepEqual(material.salt, saltOutput);
  assert.equal(getCalls.length, 1);
  const request = getCalls[0];
  assert.equal(request.rpId, "wallet.example");
  assert.deepEqual(new Uint8Array(request.allowCredentials![0].id as ArrayBuffer), new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(
    (request.extensions as WebAuthnPrfInputs).prf.evalByCredential.AQIDBA.first,
    new TextEncoder().encode(AZTEC_ACCOUNT_SECRET_PRF_LABEL),
  );
  assert.deepEqual(
    (request.extensions as WebAuthnPrfInputs).prf.evalByCredential.AQIDBA.second,
    new TextEncoder().encode(AZTEC_ACCOUNT_SALT_PRF_LABEL),
  );
});

test("discovers credential-scoped PRF outputs without a locally stored credential id", async () => {
  const getCalls: PublicKeyCredentialRequestOptions[] = [];
  const secretOutput = new Uint8Array(32).fill(13);
  const saltOutput = new Uint8Array(32).fill(17);

  using _globals = installWebAuthnGlobals({
    get: async options => {
      getCalls.push(options.publicKey);
      return new FakePublicKeyCredential({
        prf: {
          results: {
            first: secretOutput.buffer,
            second: saltOutput.buffer,
          },
        },
      });
    },
  });

  const material = await discoverWebAuthnAccountPrf("wallet.example");

  assert.deepEqual(material.credentialId, new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(material.secret, secretOutput);
  assert.deepEqual(material.salt, saltOutput);
  assert.equal(getCalls.length, 1);
  const request = getCalls[0];
  assert.equal(request.rpId, "wallet.example");
  assert.equal(request.allowCredentials, undefined);
  assert.deepEqual(
    (request.extensions as WebAuthnDiscoveryPrfInputs).prf.eval.first,
    new TextEncoder().encode(AZTEC_ACCOUNT_SECRET_PRF_LABEL),
  );
  assert.deepEqual(
    (request.extensions as WebAuthnDiscoveryPrfInputs).prf.eval.second,
    new TextEncoder().encode(AZTEC_ACCOUNT_SALT_PRF_LABEL),
  );
});

test("fails loudly when the authenticator does not return PRF account material", async () => {
  using _globals = installWebAuthnGlobals({
    get: async () => new FakePublicKeyCredential({ prf: {} }),
  });

  await assert.rejects(
    () => evaluateWebAuthnAccountPrf(registrationFixture()),
    /does not support WebAuthn PRF/,
  );
});

type WebAuthnPrfInputs = {
  prf: {
    evalByCredential: Record<string, { first: Uint8Array; second: Uint8Array }>;
  };
};

type WebAuthnDiscoveryPrfInputs = {
  prf: {
    eval: { first: Uint8Array; second: Uint8Array };
  };
};

type ExtensionResults = {
  prf?: {
    results?: {
      first?: ArrayBuffer;
      second?: ArrayBuffer;
    };
  };
};

class FakePublicKeyCredential {
  readonly rawId = new Uint8Array([1, 2, 3, 4]).buffer;
  readonly response = {};
  readonly authenticatorAttachment = "platform";
  readonly id = "AQIDBA";
  readonly type = "public-key";

  constructor(private readonly extensionResults: ExtensionResults) {}

  getClientExtensionResults(): ExtensionResults {
    return this.extensionResults;
  }
}

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

function installWebAuthnGlobals(implementation: {
  get: (options: { publicKey: PublicKeyCredentialRequestOptions }) => Promise<FakePublicKeyCredential>;
}) {
  const previousCrypto = globalThis.crypto;
  const previousNavigator = globalThis.navigator;
  const previousPublicKeyCredential = globalThis.PublicKeyCredential;

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      credentials: implementation,
    },
  });
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    value: FakePublicKeyCredential,
  });

  return {
    [Symbol.dispose]() {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: previousCrypto,
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: previousNavigator,
      });
      Object.defineProperty(globalThis, "PublicKeyCredential", {
        configurable: true,
        value: previousPublicKeyCredential,
      });
    },
  };
}
