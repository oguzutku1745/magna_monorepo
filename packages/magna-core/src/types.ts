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
