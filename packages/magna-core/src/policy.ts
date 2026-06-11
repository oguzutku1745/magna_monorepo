import { ClaimId, ConstraintOp, type Constraint, type Policy } from "./types.js";

export const MAX_CONSTRAINTS = 8;

export function normalizePolicy(policy: Policy): Policy {
  if (policy.constraints.length > MAX_CONSTRAINTS) {
    throw new Error(`policy exceeds MAX_CONSTRAINTS=${MAX_CONSTRAINTS}`);
  }

  return {
    ...policy,
    constraints: padConstraints(policy.constraints, MAX_CONSTRAINTS),
  };
}

export function padConstraints(constraints: Constraint[], size: number): Constraint[] {
  const next = [...constraints];
  while (next.length < size) {
    next.push({
      claimId: ClaimId.None,
      op: ConstraintOp.None,
      value: 0n,
    });
  }
  return next;
}

export function ageGteConstraint(age: number): Constraint {
  return {
    claimId: ClaimId.AgeMinProven,
    op: ConstraintOp.Gte,
    value: BigInt(age),
  };
}

export function countryNeqConstraint(alpha3Packed: bigint): Constraint {
  return {
    claimId: ClaimId.NationalityAlpha3,
    op: ConstraintOp.Neq,
    value: alpha3Packed,
  };
}

export function expiryGteConstraint(unixTs: bigint): Constraint {
  return {
    claimId: ClaimId.ExpiryTs,
    op: ConstraintOp.Gte,
    value: unixTs,
  };
}

export function instagramHandleEqConstraint(handleHash: bigint): Constraint {
  return {
    claimId: ClaimId.InstagramHandleHash,
    op: ConstraintOp.Eq,
    value: handleHash,
  };
}
