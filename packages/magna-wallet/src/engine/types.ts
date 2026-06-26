import { CredentialType } from "@magna/core";
import type { Policy } from "@magna/core";

export { ClaimId, ConstraintOp, CredentialType } from "@magna/core";
export type { Constraint, Policy } from "@magna/core";

export type PassportCanonicalClaims = {
  schemaVersion: number;
  credentialType: CredentialType.Passport;
  nationalityAlpha3Packed: bigint;
  minAgeProven: number;
  expiryTs: bigint;
};

export type PassportCommittedClaims = {
  schemaVersion: 2;
  credentialType: CredentialType.Passport;
  nationalityCommitment: bigint;
  minAgeProven: number;
  expiryCommitment: bigint;
};

export type PassportCommittedClaimsWitness = {
  minAgeProven: number;
  nationalityAlpha3Packed: bigint;
  nationalityBlind: bigint;
  expiryTs: bigint;
  expiryBlind: bigint;
};

export type PassportCommittedClaimsWitnessInput = {
  claims: PassportCanonicalClaims;
  nationalityBlind: bigint;
  expiryBlind: bigint;
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

export type VerifyPassportV2Input = Omit<VerifyPassportInput, "claimsWitness"> & {
  claimsWitness: PassportCommittedClaimsWitness;
};

export type VerifyLinkedPassportInput = VerifyPassportInput & {
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
};

export type VerifyLinkedPassportV2Input = VerifyPassportV2Input & {
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
  derivationVersion?: GhostDerivationVersion;
  domainSeparator?: bigint;
};

export type RootCommitmentInput = {
  uniqueIdentifier: bigint | string;
  domainSeparator?: bigint;
};

export type GhostKeyMaterial = {
  scope: string;
  derivationVersion: GhostDerivationVersion;
  domainSeparator: bigint;
  seedField: bigint;
  saltHex: string;
  secretHex: string;
};

export type GhostDerivationVersion = "v1_legacy_unscoped" | "v2_scoped";

export type Hasher = (domainSeparator: bigint, fields: bigint[]) => bigint;
