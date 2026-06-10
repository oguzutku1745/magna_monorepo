import { extractP256PublicKey, type P256PublicKey } from "./public-key.js";
import { decodeEcdsaDerSignature, normalizeSToLow } from "./der.js";

export type WebAuthnRegistration = {
  credentialId: Uint8Array;
  publicKey: P256PublicKey;
  rpId: string;
  rpIdHash: Uint8Array;
  origin: string;
};

export type WebAuthnAssertionResult = {
  signatureDER?: Uint8Array | null;
  signatureRS: Uint8Array; // 64 bytes, low-s
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
};

export type WebAuthnAsserter = (challenge: Uint8Array) => Promise<WebAuthnAssertionResult>;

/** Registration ceremony. Must run on the wallet origin, top-level context. */
export async function registerWebAuthnCredential(userName: string, rpId: string): Promise<WebAuthnRegistration> {
  assertTopLevelContext();
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "Magna", id: rpId },
      user: {
        id: crypto.getRandomValues(new Uint8Array(32)),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      timeout: 60_000,
      attestation: "none",
    },
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("registration did not return a PublicKeyCredential");
  }
  const response = credential.response as AuthenticatorAttestationResponse;
  assertRegistrationClientData(response.clientDataJSON);
  const publicKey = await extractP256PublicKey(response);
  const rpIdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId)));
  return {
    credentialId: new Uint8Array(credential.rawId),
    publicKey,
    rpId,
    rpIdHash,
    origin: window.location.origin,
  };
}

/** Per-transaction assertion: challenge = authwit outer hash bytes. */
export function makeBrowserAsserter(registration: WebAuthnRegistration): WebAuthnAsserter {
  return async (challenge: Uint8Array): Promise<WebAuthnAssertionResult> => {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: toArrayBuffer(challenge),
        rpId: registration.rpId,
        userVerification: "required",
        allowCredentials: [{ type: "public-key", id: toArrayBuffer(registration.credentialId) }],
        timeout: 60_000,
      },
    });
    if (!(credential instanceof PublicKeyCredential)) {
      throw new Error("assertion did not return a PublicKeyCredential");
    }
    const response = credential.response as AuthenticatorAssertionResponse;
    const { r, s } = decodeEcdsaDerSignature(new Uint8Array(response.signature));
    const lowS = normalizeSToLow(s);
    const signatureRS = new Uint8Array(64);
    signatureRS.set(r, 0);
    signatureRS.set(lowS, 32);
    return {
      signatureRS,
      signatureDER: new Uint8Array(response.signature),
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON),
    };
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

function assertTopLevelContext(): void {
  if (window.self !== window.top) {
    throw new Error("WebAuthn registration must run in the top-level wallet context");
  }
}

function assertRegistrationClientData(clientDataJSON: ArrayBuffer): void {
  let parsed: {
    type?: unknown;
    origin?: unknown;
    crossOrigin?: unknown;
  };
  try {
    const value = JSON.parse(new TextDecoder().decode(clientDataJSON)) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("invalid clientDataJSON shape");
    }
    parsed = value as typeof parsed;
  } catch {
    throw new Error("registration clientDataJSON is malformed");
  }
  if (parsed.type !== "webauthn.create") {
    throw new Error("registration clientDataJSON has unexpected type");
  }
  if (parsed.origin !== window.location.origin) {
    throw new Error("registration origin does not match wallet origin");
  }
  if (parsed.crossOrigin === true) {
    throw new Error("cross-origin WebAuthn registration is not supported");
  }
}
