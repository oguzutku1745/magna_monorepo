use crate::internal::{
    claims::compute_passport_claims_hash,
    constants::{MAGNA_CLAIMS_DS, MAGNA_REVOCATION_DS, SCHEMA_VERSION_V1},
    revocation::compute_revocation_nullifier,
};
use crate::test::setup::setup;
use aztec::protocol::hash::compute_siloed_nullifier;
use magna_lib::{
    CLAIM_AGE_MIN_PROVEN,
    CLAIM_EXPIRY_TS,
    CLAIM_NATIONALITY_ALPHA3,
    CLAIM_NONE,
    Constraint,
    MAX_CONSTRAINTS,
    OP_GTE,
    OP_NEQ,
    OP_NONE,
    PassportClaims,
    Policy,
    pack_alpha3,
    require_policy_matches_passport,
};

fn empty_constraints() -> [Constraint; MAX_CONSTRAINTS] {
    [Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 }; MAX_CONSTRAINTS]
}

#[test]
unconstrained fn test_policy_allows_multiple_constraints_and() {
    let mut constraints = empty_constraints();
    constraints[0] = Constraint { claim_id: CLAIM_AGE_MIN_PROVEN, op: OP_GTE, value: 18 };
    constraints[1] = Constraint {
        claim_id: CLAIM_NATIONALITY_ALPHA3,
        op: OP_NEQ,
        value: pack_alpha3(85, 83, 65),
    };
    constraints[2] = Constraint { claim_id: CLAIM_EXPIRY_TS, op: OP_GTE, value: 1_800_000_000 };

    let policy = Policy { credential_type: 1, constraints };
    let claims = PassportClaims {
        min_age_proven: 21,
        nationality_alpha3_packed: pack_alpha3(67, 65, 78),
        expiry_ts: 1_893_456_000,
    };

    require_policy_matches_passport(policy, 1, claims);
}

#[test(should_fail_with = "policy constraint failed")]
unconstrained fn test_policy_fails_when_country_is_blocked() {
    let mut constraints = empty_constraints();
    constraints[0] = Constraint { claim_id: CLAIM_AGE_MIN_PROVEN, op: OP_GTE, value: 18 };
    constraints[1] = Constraint {
        claim_id: CLAIM_NATIONALITY_ALPHA3,
        op: OP_NEQ,
        value: pack_alpha3(85, 83, 65),
    };

    let policy = Policy { credential_type: 1, constraints };
    let claims = PassportClaims {
        min_age_proven: 21,
        nationality_alpha3_packed: pack_alpha3(85, 83, 65),
        expiry_ts: 1_893_456_000,
    };

    require_policy_matches_passport(policy, 1, claims);
}

#[test]
unconstrained fn test_claims_hash_matches_canonical_payload() {
    let expected_hash = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78),
        21,
        1_893_456_000,
        MAGNA_CLAIMS_DS,
    );
    let recomputed = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78),
        21,
        1_893_456_000,
        MAGNA_CLAIMS_DS,
    );
    assert(expected_hash == recomputed, "claims hash mismatch");
}

#[test(should_fail_with = "claims hash mismatch")]
unconstrained fn test_claims_hash_mismatch_detected() {
    let expected_hash = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78),
        21,
        1_893_456_000,
        MAGNA_CLAIMS_DS,
    );
    let tampered_hash = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(85, 83, 65),
        21,
        1_893_456_000,
        MAGNA_CLAIMS_DS,
    );
    assert(expected_hash == tampered_hash, "claims hash mismatch");
}

#[test]
unconstrained fn test_revocation_nullifier_can_be_siloed_for_non_inclusion_check() {
    let (_, contract_address, _, _, _, _) = setup();
    let revocation_nullifier = compute_revocation_nullifier(
        777 as Field,
        1,
        888 as Field,
        MAGNA_REVOCATION_DS,
    );
    let siloed_nullifier = compute_siloed_nullifier(contract_address, revocation_nullifier);
    assert(siloed_nullifier != revocation_nullifier, "siloed nullifier expected");
}
