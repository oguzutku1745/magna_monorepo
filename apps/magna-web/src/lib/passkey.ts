export type PasskeyCapability = {
  isSupported: boolean;
  hasConditionalUi: boolean;
  hasPlatformAuthenticator: boolean;
};

export type PasskeyCredentialRecord = {
  credentialId: string;
  rpId: string;
  userName: string;
  authenticatorAttachment?: string;
  publicKeyAlgorithm?: number;
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

function getWebCrypto(): Crypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API is not available in this runtime.");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  getWebCrypto().getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isIpLikeHost(hostname: string): boolean {
  if (!hostname) return false;
  const ipv4Pattern = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  if (ipv4Pattern.test(hostname)) {
    return true;
  }
  // Bracket-less IPv6 hostnames contain ":".
  return hostname.includes(":");
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

export async function createPasskeyCredential(label: string): Promise<PasskeyCredentialRecord> {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window) || !navigator.credentials?.create) {
    throw new Error("WebAuthn passkeys are not available in this browser context.");
  }

  const challenge = toArrayBuffer(randomBytes(32));
  const userId = toArrayBuffer(randomBytes(32));
  const hostname = window.location.hostname || "localhost";
  const rpId = hostname;
  const rpEntity: PublicKeyCredentialRpEntity = {
    name: "Magna",
  };
  if (!isIpLikeHost(hostname)) {
    rpEntity.id = hostname;
  }
  const response = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        ...rpEntity,
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
  const transports = typeof attestationResponse.getTransports === "function" ? attestationResponse.getTransports() : [];

  return {
    credentialId: base64UrlEncode(new Uint8Array(response.rawId)),
    rpId,
    userName: label,
    authenticatorAttachment: response.authenticatorAttachment ?? undefined,
    publicKeyAlgorithm: attestationResponse.getPublicKeyAlgorithm?.(),
    transports,
    createdAt: new Date().toISOString(),
  };
}

export async function assertPasskeyCredential(credentialId: string): Promise<void> {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window) || !navigator.credentials?.get) {
    throw new Error("WebAuthn passkeys are not available in this browser context.");
  }
  const rawCredentialId = base64UrlDecode(credentialId);
  const response = await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(randomBytes(32)),
      timeout: 60_000,
      userVerification: "preferred",
      allowCredentials: [
        {
          type: "public-key",
          id: toArrayBuffer(rawCredentialId),
        },
      ],
    },
  });
  if (!(response instanceof PublicKeyCredential)) {
    throw new Error("Passkey authentication did not return a public key credential.");
  }
}

// Backward-compatible alias kept for existing call sites.
export async function createPasskeySpikeCredential(label: string): Promise<PasskeyCredentialRecord> {
  return createPasskeyCredential(label);
}

export type PasskeySpikeResult = PasskeyCredentialRecord;

export const passkeyTestUtils = {
  base64UrlEncode,
  base64UrlDecode,
};
