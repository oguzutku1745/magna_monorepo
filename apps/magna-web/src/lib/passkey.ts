export type PasskeyCapability = {
  isSupported: boolean;
  hasConditionalUi: boolean;
  hasPlatformAuthenticator: boolean;
};

export type PasskeySpikeResult = {
  credentialId: string;
  rpId: string;
  userName: string;
  authenticatorAttachment?: string;
  publicKeyAlgorithm?: number;
  publicKeySpki?: string;
  transports: string[];
  createdAt: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function getPasskeyCapability(): Promise<PasskeyCapability> {
  const supported =
    typeof window !== "undefined" &&
    "PublicKeyCredential" in window &&
    typeof navigator.credentials?.create === "function";

  if (!supported) {
    return {
      isSupported: false,
      hasConditionalUi: false,
      hasPlatformAuthenticator: false,
    };
  }

  const PublicKeyCredentialCtor = window.PublicKeyCredential;
  const [hasConditionalUi, hasPlatformAuthenticator] = await Promise.all([
    typeof PublicKeyCredentialCtor.isConditionalMediationAvailable === "function"
      ? PublicKeyCredentialCtor.isConditionalMediationAvailable()
      : Promise.resolve(false),
    typeof PublicKeyCredentialCtor.isUserVerifyingPlatformAuthenticatorAvailable === "function"
      ? PublicKeyCredentialCtor.isUserVerifyingPlatformAuthenticatorAvailable()
      : Promise.resolve(false),
  ]);

  return {
    isSupported: true,
    hasConditionalUi,
    hasPlatformAuthenticator,
  };
}

export async function createPasskeySpikeCredential(label: string): Promise<PasskeySpikeResult> {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window) || !navigator.credentials?.create) {
    throw new Error("WebAuthn passkeys are not available in this browser context.");
  }

  const challenge = randomBytes(32) as BufferSource;
  const userId = randomBytes(32) as BufferSource;
  const rpId = window.location.hostname || "localhost";
  const response = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: "Magna",
        id: rpId,
      },
      user: {
        id: userId,
        name: label,
        displayName: label,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  });

  if (!(response instanceof PublicKeyCredential)) {
    throw new Error("Browser returned an unexpected credential type.");
  }

  const attestationResponse = response.response as AuthenticatorAttestationResponse;
  const publicKey = attestationResponse.getPublicKey?.();
  const transports = typeof attestationResponse.getTransports === "function" ? attestationResponse.getTransports() : [];

  return {
    credentialId: base64UrlEncode(new Uint8Array(response.rawId)),
    rpId,
    userName: label,
    authenticatorAttachment: response.authenticatorAttachment ?? undefined,
    publicKeyAlgorithm: attestationResponse.getPublicKeyAlgorithm?.(),
    publicKeySpki: publicKey ? base64UrlEncode(new Uint8Array(publicKey)) : undefined,
    transports,
    createdAt: new Date().toISOString(),
  };
}

export const passkeyTestUtils = {
  base64UrlEncode,
};
