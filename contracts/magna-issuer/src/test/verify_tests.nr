use crate::MagnaIssuer;
use crate::internal::{
    claims::{
        compute_passport_claims_hash,
        compute_passport_claims_hash_v2,
        compute_passport_expiry_commitment,
        compute_passport_nationality_commitment,
    },
    constants::{
        MAGNA_CLAIMS_DS,
        MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
        MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
        MAGNA_REVOCATION_DS,
        SCHEMA_VERSION_V1,
        SCHEMA_VERSION_V2,
    },
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
    OP_EQ,
    OP_NEQ,
    OP_NONE,
    PassportCommittedClaimsWitness,
    PassportClaims,
    Policy,
    pack_alpha3,
    require_policy_matches_passport,
};

fn empty_constraints() -> [Constraint; MAX_CONSTRAINTS] {
    [Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 }; MAX_CONSTRAINTS]
}

global V2_ROOT_COMMITMENT: Field = 321;
global V2_NATIONALITY_BLIND: Field = 111;
global V2_EXPIRY_BLIND: Field = 222;
global V2_EXPIRY_TS: u64 = 1_893_456_000;
global V2_CREDENTIAL_VALID_UNTIL: u64 = 1_993_456_000;

fn v2_witness(min_age_proven: u8, nationality_blind: Field, expiry_blind: Field) -> PassportCommittedClaimsWitness {
    PassportCommittedClaimsWitness {
        min_age_proven,
        nationality_alpha3_packed: pack_alpha3(67, 65, 78), // "CAN"
        nationality_blind,
        expiry_ts: V2_EXPIRY_TS,
        expiry_blind,
    }
}

fn v2_claims_hash(witness: PassportCommittedClaimsWitness) -> Field {
    let nationality_commitment = compute_passport_nationality_commitment(
        witness.nationality_alpha3_packed,
        witness.nationality_blind,
        MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
    );
    let expiry_commitment = compute_passport_expiry_commitment(
        witness.expiry_ts,
        witness.expiry_blind,
        MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
    );
    compute_passport_claims_hash_v2(
        SCHEMA_VERSION_V2,
        1,
        nationality_commitment,
        witness.min_age_proven,
        expiry_commitment,
        MAGNA_CLAIMS_DS,
    )
}

fn v2_base_policy() -> Policy {
    let mut constraints = empty_constraints();
    constraints[0] = Constraint { claim_id: CLAIM_AGE_MIN_PROVEN, op: OP_GTE, value: 18 };
    constraints[1] = Constraint {
        claim_id: CLAIM_NATIONALITY_ALPHA3,
        op: OP_EQ,
        value: pack_alpha3(67, 65, 78), // "CAN"
    };
    constraints[2] = Constraint { claim_id: CLAIM_EXPIRY_TS, op: OP_GTE, value: 1_800_000_000 };
    Policy { credential_type: 1, constraints }
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

#[test]
unconstrained fn test_verify_linked_v2_accepts_committed_passport_claims() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let witness = v2_witness(21, V2_NATIONALITY_BLIND, V2_EXPIRY_BLIND);
    let claims_hash = v2_claims_hash(witness);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport_v2(
            active_owner,
            ghost_owner,
            V2_ROOT_COMMITMENT,
            claims_hash,
            V2_CREDENTIAL_VALID_UNTIL,
        ),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, V2_ROOT_COMMITMENT),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, V2_ROOT_COMMITMENT, claims_hash),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, V2_ROOT_COMMITMENT, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, V2_ROOT_COMMITMENT, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked_v2(
            v2_base_policy(),
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            witness,
            0,
        ),
    );
}

#[test(should_fail_with = "policy constraint failed")]
unconstrained fn test_verify_v2_rejects_nationality_inequality_mismatch() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let witness = v2_witness(21, V2_NATIONALITY_BLIND, V2_EXPIRY_BLIND);
    let claims_hash = v2_claims_hash(witness);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential_v2(
            active_owner,
            ghost_owner,
            claims_hash,
            1,
            V2_CREDENTIAL_VALID_UNTIL,
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );

    let mut constraints = empty_constraints();
    constraints[0] = Constraint {
        claim_id: CLAIM_NATIONALITY_ALPHA3,
        op: OP_NEQ,
        value: pack_alpha3(67, 65, 78), // "CAN"
    };
    let policy = Policy { credential_type: 1, constraints };

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_v2(
            policy,
            hinted_credential,
            hinted_status,
            witness,
            0,
        ),
    );
}

#[test(should_fail_with = "policy constraint failed")]
unconstrained fn test_verify_v2_rejects_min_age_policy_mismatch() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let witness = v2_witness(21, V2_NATIONALITY_BLIND, V2_EXPIRY_BLIND);
    let claims_hash = v2_claims_hash(witness);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential_v2(
            active_owner,
            ghost_owner,
            claims_hash,
            1,
            V2_CREDENTIAL_VALID_UNTIL,
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );

    let mut constraints = empty_constraints();
    constraints[0] = Constraint { claim_id: CLAIM_AGE_MIN_PROVEN, op: OP_GTE, value: 22 };
    let policy = Policy { credential_type: 1, constraints };

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_v2(
            policy,
            hinted_credential,
            hinted_status,
            witness,
            0,
        ),
    );
}

#[test(should_fail_with = "policy constraint failed")]
unconstrained fn test_verify_v2_rejects_expiry_policy_mismatch() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let witness = v2_witness(21, V2_NATIONALITY_BLIND, V2_EXPIRY_BLIND);
    let claims_hash = v2_claims_hash(witness);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential_v2(
            active_owner,
            ghost_owner,
            claims_hash,
            1,
            V2_CREDENTIAL_VALID_UNTIL,
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );

    let mut constraints = empty_constraints();
    constraints[0] = Constraint { claim_id: CLAIM_EXPIRY_TS, op: OP_GTE, value: 1_900_000_000 };
    let policy = Policy { credential_type: 1, constraints };

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_v2(
            policy,
            hinted_credential,
            hinted_status,
            witness,
            0,
        ),
    );
}

#[test(should_fail_with = "claims hash mismatch")]
unconstrained fn test_verify_v2_rejects_claims_hash_mismatch() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let witness = v2_witness(21, V2_NATIONALITY_BLIND, V2_EXPIRY_BLIND);
    let mismatched_hash = v2_claims_hash(v2_witness(22, V2_NATIONALITY_BLIND, V2_EXPIRY_BLIND));

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential_v2(
            active_owner,
            ghost_owner,
            mismatched_hash,
            1,
            V2_CREDENTIAL_VALID_UNTIL,
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, mismatched_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, mismatched_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_v2(
            v2_base_policy(),
            hinted_credential,
            hinted_status,
            witness,
            0,
        ),
    );
}

#[test(should_fail_with = "claims hash mismatch")]
unconstrained fn test_verify_v2_rejects_wrong_blind() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let witness = v2_witness(21, V2_NATIONALITY_BLIND, V2_EXPIRY_BLIND);
    let claims_hash = v2_claims_hash(witness);
    let wrong_blind_witness = v2_witness(21, V2_NATIONALITY_BLIND + 1, V2_EXPIRY_BLIND);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential_v2(
            active_owner,
            ghost_owner,
            claims_hash,
            1,
            V2_CREDENTIAL_VALID_UNTIL,
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_v2(
            v2_base_policy(),
            hinted_credential,
            hinted_status,
            wrong_blind_witness,
            0,
        ),
    );
}

#[test]
unconstrained fn test_verify_v1_passport_remains_compatible() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78),
        21,
        V2_EXPIRY_TS,
        MAGNA_CLAIMS_DS,
    );

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(
            active_owner,
            ghost_owner,
            claims_hash,
            1,
            V2_EXPIRY_TS,
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify(
            v2_base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}
