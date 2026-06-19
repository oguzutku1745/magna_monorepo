import {
  ClaimId,
  CredentialType,
  ConstraintOp,
  MagnaClient,
  ageGteConstraint,
  type MagnaLoginResult,
  type MagnaLoginRequirement,
  type Policy,
} from "@magna/client";

export type { MagnaLoginResult };

type ReferenceDappEnv = {
  VITE_MAGNA_WALLET_ORIGIN?: string;
  VITE_MAGNA_PUBLIC_KEY_JWK?: string;
};

function referenceEnv(): ReferenceDappEnv {
  return (import.meta as ImportMeta & { env?: ReferenceDappEnv }).env ?? {};
}

export function packAlpha3(alpha3: string): bigint {
  if (!/^[A-Z]{3}$/.test(alpha3)) {
    throw new Error(`invalid alpha3 country code: ${alpha3}`);
  }
  const [a, b, c] = alpha3.split("").map(character => character.charCodeAt(0));
  return (BigInt(a) << 16n) | (BigInt(b) << 8n) | BigInt(c);
}

export function countryEqConstraint(alpha3Packed: bigint) {
  return {
    claimId: ClaimId.NationalityAlpha3,
    op: ConstraintOp.Eq,
    value: alpha3Packed,
  };
}

export function passportAdultUsPolicy(): Policy {
  return {
    credentialType: CredentialType.Passport,
    constraints: [ageGteConstraint(18), countryEqConstraint(packAlpha3("ZKR"))],
  };
}

export function magnaSocialRequirements(instagramHandle: string): MagnaLoginRequirement[] {
  return [
    {
      id: "passport",
      kind: "policy",
      policy: passportAdultUsPolicy(),
    },
    {
      id: "instagram",
      kind: "instagram-handle",
      handle: instagramHandle,
    },
  ];
}

export function createReferenceMagnaClient(env: ReferenceDappEnv = referenceEnv()): MagnaClient {
  const publicKey = env.VITE_MAGNA_PUBLIC_KEY_JWK;
  if (!publicKey) {
    throw new Error("VITE_MAGNA_PUBLIC_KEY_JWK is required for Login with Magna");
  }
  return new MagnaClient({
    clientId: "dapp_reference",
    walletOrigin: env.VITE_MAGNA_WALLET_ORIGIN ?? "http://localhost:5174",
    magnaPublicKeyJwk: JSON.parse(publicKey) as JsonWebKey,
  });
}

export async function loginWithMagnaExample(
  magna: MagnaClient = createReferenceMagnaClient(),
): Promise<MagnaLoginResult> {
  return magna.login(passportAdultUsPolicy());
}

export async function loginWithMagnaSocial(
  instagramHandle: string,
  magna: MagnaClient = createReferenceMagnaClient(),
): Promise<MagnaLoginResult> {
  return magna.loginWithRequirements(magnaSocialRequirements(instagramHandle));
}

export function unlockAppIfVerified(result: MagnaLoginResult, unlockApp: () => void): boolean {
  if (!result.verified) return false;
  unlockApp();
  return true;
}
