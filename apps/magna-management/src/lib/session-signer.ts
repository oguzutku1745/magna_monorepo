import { signSessionAssertion, type SessionAssertion, type SignedSessionAssertion } from "@magna/core";

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
