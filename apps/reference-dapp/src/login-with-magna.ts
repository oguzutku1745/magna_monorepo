import {
  ClaimId,
  ConstraintOp,
  CredentialType,
  MagnaClient,
  packAlpha3,
  type Policy,
} from "@magna/client";

type Dependencies = {
  magnaClient: MagnaClient;
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
