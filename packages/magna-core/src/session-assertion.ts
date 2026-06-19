import { bytesToHex, hexToBytes } from "./bytes.js";

export type SessionVerificationReceipt = {
  id: string;
  kind: string;
  receipt: string | null;
};

/** v1 session assertion: what the wallet attests to the dApp. */
export type SessionAssertion = {
  v: 1;
  clientId: string;
  origin: string;
  requestId: string;
  sessionChallenge: string;
  policyHash: string;
  verified: boolean;
  issuedAt: number;
  expiresAt: number;
  receipt: string | null;
  receipts?: SessionVerificationReceipt[];
};

export type SignedSessionAssertion = {
  assertion: SessionAssertion;
  signature: string;
};

/** Fixed key order: this exact serialization is what gets signed. */
export function sessionAssertionSigningBytes(a: SessionAssertion): Uint8Array {
  const canonicalAssertion: {
    domain: string;
    v: 1;
    clientId: string;
    origin: string;
    requestId: string;
    sessionChallenge: string;
    policyHash: string;
    verified: boolean;
    issuedAt: number;
    expiresAt: number;
    receipt: string | null;
    receipts?: SessionVerificationReceipt[];
  } = {
    domain: "magna:session-assertion:v1",
    v: a.v,
    clientId: a.clientId,
    origin: a.origin,
    requestId: a.requestId,
    sessionChallenge: a.sessionChallenge,
    policyHash: a.policyHash,
    verified: a.verified,
    issuedAt: a.issuedAt,
    expiresAt: a.expiresAt,
    receipt: a.receipt,
  };
  if (a.receipts !== undefined) {
    canonicalAssertion.receipts = a.receipts.map(receipt => ({
      id: receipt.id,
      kind: receipt.kind,
      receipt: receipt.receipt,
    }));
  }
  const canonical = JSON.stringify(canonicalAssertion);
  return new TextEncoder().encode(canonical);
}

const ALGO = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALGO = { name: "ECDSA", hash: "SHA-256" } as const;

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is unavailable");
  }
  return subtle;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

export async function generateSessionSigningKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}> {
  const subtle = subtleCrypto();
  const kp = await subtle.generateKey(ALGO, true, ["sign", "verify"]);
  const publicKeyJwk = await subtle.exportKey("jwk", kp.publicKey);
  const privateKeyJwk = await subtle.exportKey("jwk", kp.privateKey);
  const privateKey = await subtle.importKey("jwk", privateKeyJwk, ALGO, false, ["sign"]);
  return { privateKey, publicKeyJwk };
}

export async function signSessionAssertion(
  assertion: SessionAssertion,
  privateKey: CryptoKey,
): Promise<SignedSessionAssertion> {
  const signature = await subtleCrypto().sign(SIGN_ALGO, privateKey, toArrayBuffer(sessionAssertionSigningBytes(assertion)));
  return { assertion, signature: bytesToHex(new Uint8Array(signature)) };
}

export async function verifySessionAssertion(
  signed: SignedSessionAssertion,
  publicKeyJwk: JsonWebKey,
): Promise<boolean> {
  try {
    const subtle = subtleCrypto();
    const signature = hexToBytes(signed.signature);
    if (signature.length !== 64) {
      return false;
    }
    const key = await subtle.importKey("jwk", publicKeyJwk, ALGO, false, ["verify"]);
    return await subtle.verify(
      SIGN_ALGO,
      key,
      toArrayBuffer(signature),
      toArrayBuffer(sessionAssertionSigningBytes(signed.assertion)),
    );
  } catch {
    return false;
  }
}
