import { signSessionAssertion, type SessionAssertion, type SignedSessionAssertion } from "@magna/core";

/**
 * v1 session signing key handling: PKCS8 P-256 private key, base64 in
 * VITE_MAGNA_SESSION_SIGNING_KEY (dev/local ONLY -- production must move this
 * server-side or into a KMS before launch; the wallet SPA must not ship a
 * production signing key).
 */
export async function loadSessionSigningKey(): Promise<CryptoKey> {
  const b64 = import.meta.env.VITE_MAGNA_SESSION_SIGNING_KEY;
  if (!b64) throw new Error("VITE_MAGNA_SESSION_SIGNING_KEY is not configured");
  const pkcs8 = Uint8Array.from(atob(b64), character => character.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export async function signAssertion(assertion: SessionAssertion): Promise<SignedSessionAssertion> {
  return signSessionAssertion(assertion, await loadSessionSigningKey());
}
