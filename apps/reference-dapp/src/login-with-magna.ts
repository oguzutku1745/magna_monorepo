import {
  ClaimId,
  ConstraintOp,
  CredentialType,
  packAlpha3,
  type MagnaVerificationEngine,
  type Policy,
} from "@magna/wallet";

type Dependencies = {
  magnaClient: MagnaVerificationEngine;
  userAddress: string;
  hintedCredentialNote: unknown;
  hintedStatusNote: unknown;
  claimsWitness: {
    minAgeProven: number;
    nationalityAlpha3Packed: bigint;
  };
};

export async function loginWithMagnaExample(deps: Dependencies) {
  const policy: Policy = {
    credentialType: CredentialType.Passport,
    constraints: [
      { claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n },
      { claimId: ClaimId.NationalityAlpha3, op: ConstraintOp.Neq, value: packAlpha3("USA") },
    ],
  };

  return deps.magnaClient.loginWithMagna(
    {
      policy,
      hintedCredentialNote: deps.hintedCredentialNote,
      hintedStatusNote: deps.hintedStatusNote,
      claimsWitness: deps.claimsWitness,
    },
    deps.userAddress,
  );
}
