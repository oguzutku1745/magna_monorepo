export enum CredentialType {
  None = 0,
  Passport = 1,
  X = 2,
  Instagram = 3,
  StudentEmail = 4,
  WorkEmail = 5,
}

export enum ClaimId {
  None = 0,
  AgeMinProven = 1,
  NationalityAlpha3 = 2,
  ExpiryTs = 3,
  InstagramHandleHash = 4,
}

export enum ConstraintOp {
  None = 0,
  Eq = 1,
  Neq = 2,
  Gte = 3,
  Lte = 4,
}

export type Constraint = {
  claimId: ClaimId;
  op: ConstraintOp;
  value: bigint;
};

export type Policy = {
  credentialType: CredentialType;
  constraints: Constraint[];
};

export type PassportCanonicalClaims = {
  schemaVersion: number;
  credentialType: CredentialType.Passport;
  nationalityAlpha3Packed: bigint;
  minAgeProven: number;
  expiryTs: bigint;
};

export type InstagramCanonicalClaims = {
  schemaVersion: number;
  credentialType: CredentialType.Instagram;
  handleHash: bigint;
  expiryTs: bigint;
};

export type RegisterPassportInput = {
  activeOwner: string;
  ghostOwner: string;
  claims: PassportCanonicalClaims;
};

export type RegisterInstagramInput = {
  activeOwner: string;
  ghostOwner: string;
  claims: InstagramCanonicalClaims;
};

export type RegisterRootAuthorityInput = {
  activeOwner: string;
  rootCommitment: bigint;
  claims: PassportCanonicalClaims;
};

export type RegisterRootInput = {
  activeOwner: string;
  ghostOwner: string;
  rootCommitment: bigint;
};

export type RegisterRootedPassportInput = {
  activeOwner: string;
  ghostOwner: string;
  rootCommitment: bigint;
  claims: PassportCanonicalClaims;
};

export type RegisterLinkedPassportInput = {
  activeOwner: string;
  ghostOwner: string;
  rootCommitment: bigint;
  claims: PassportCanonicalClaims;
};

export type RegisterLinkedInstagramInput = {
  activeOwner: string;
  ghostOwner: string;
  rootCommitment: bigint;
  claims: InstagramCanonicalClaims;
};

export type VerifyPassportInput = {
  policy: Policy;
  hintedCredentialNote: unknown;
  hintedStatusNote: unknown;
  claimsWitness: {
    minAgeProven: number;
    nationalityAlpha3Packed: bigint;
  };
  sponsorSlot?: number;
};

export type VerifyLinkedPassportInput = VerifyPassportInput & {
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
};

export type VerifyInstagramInput = {
  policy: Policy;
  hintedCredentialNote: unknown;
  hintedStatusNote: unknown;
  claimsWitness: {
    handleHash: bigint;
  };
  sponsorSlot?: number;
};

export type VerifyLinkedInstagramInput = VerifyInstagramInput & {
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
};

export type RecoverInput = {
  hintedRecoveryNote: unknown;
  newActiveOwner: string;
  remintCredential: boolean;
};

export type RecoverRootInput = {
  hintedRootRecoveryNote: unknown;
  newActiveOwner: string;
};

export type RefreshRootAuthorityInput = {
  ghostOwner: string;
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
  claims: PassportCanonicalClaims;
};

export type RevokeLinkedCredentialInput = {
  hintedLinkedRecoveryNote: unknown;
};

export type GhostDerivationInput = {
  uniqueIdentifier: bigint | string;
  credentialType: CredentialType;
  domainSeparator?: bigint;
};

export type RootCommitmentInput = {
  uniqueIdentifier: bigint | string;
  domainSeparator?: bigint;
};

export type GhostKeyMaterial = {
  scope: string;
  domainSeparator: bigint;
  seedField: bigint;
  saltHex: string;
  secretHex: string;
};

export type Hasher = (domainSeparator: bigint, fields: bigint[]) => bigint;
