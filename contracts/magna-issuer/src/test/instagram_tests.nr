use crate::MagnaIssuer;
use crate::internal::{
    claims::{compute_instagram_claims_hash, compute_instagram_handle_commitment, compute_passport_claims_hash},
    constants::{MAGNA_CLAIMS_DS, MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS, SCHEMA_VERSION_V1, SCHEMA_VERSION_V2},
};
use crate::test::setup::setup;
use magna_lib::{
    CLAIM_EXPIRY_TS,
    CLAIM_INSTAGRAM_HANDLE_HASH,
    CLAIM_NONE,
    Constraint,
    InstagramClaims,
    InstagramCommittedClaimsWitness,
    MAX_CONSTRAINTS,
    OP_EQ,
    OP_GTE,
    OP_NONE,
    Policy,
    pack_alpha3,
    require_policy_matches_instagram,
};

global INSTAGRAM_CREDENTIAL_TYPE: u8 = 3;
global INSTAGRAM_HANDLE_HASH: Field = 123456;
global INSTAGRAM_HANDLE_BLIND: Field = 654321;
global INSTAGRAM_EXPIRY_TS: u64 = 1_893_456_000;
global ROOT_COMMITMENT: Field = 987654321;

fn empty_constraints() -> [Constraint; MAX_CONSTRAINTS] {
    [Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 }; MAX_CONSTRAINTS]
}

fn instagram_policy() -> Policy {
    let mut constraints = empty_constraints();
    constraints[0] = Constraint {
        claim_id: CLAIM_INSTAGRAM_HANDLE_HASH,
        op: OP_EQ,
        value: INSTAGRAM_HANDLE_HASH,
    };
    constraints[1] = Constraint { claim_id: CLAIM_EXPIRY_TS, op: OP_GTE, value: 1_800_000_000 };
    Policy { credential_type: INSTAGRAM_CREDENTIAL_TYPE, constraints }
}

fn instagram_claims_hash(handle_hash: Field) -> Field {
    instagram_claims_hash_with_blind(handle_hash, INSTAGRAM_HANDLE_BLIND)
}

fn instagram_claims_hash_with_blind(handle_hash: Field, handle_blind: Field) -> Field {
    let handle_commitment = compute_instagram_handle_commitment(
        handle_hash,
        handle_blind,
        MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS,
    );
    compute_instagram_claims_hash(
        SCHEMA_VERSION_V2,
        INSTAGRAM_CREDENTIAL_TYPE,
        handle_commitment,
        INSTAGRAM_EXPIRY_TS,
        MAGNA_CLAIMS_DS,
    )
}

fn instagram_claims_witness(handle_hash: Field) -> InstagramCommittedClaimsWitness {
    InstagramCommittedClaimsWitness {
        handle_hash,
        handle_blind: INSTAGRAM_HANDLE_BLIND,
    }
}

fn passport_authority_claims_hash() -> Field {
    compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78),
        21,
        INSTAGRAM_EXPIRY_TS,
        MAGNA_CLAIMS_DS,
    )
}

fn renewed_passport_authority_claims_hash() -> Field {
    compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78),
        22,
        INSTAGRAM_EXPIRY_TS,
        MAGNA_CLAIMS_DS,
    )
}

#[test]
unconstrained fn test_instagram_policy_matches_handle_and_expiry() {
    let claims = InstagramClaims {
        handle_hash: INSTAGRAM_HANDLE_HASH,
        expiry_ts: INSTAGRAM_EXPIRY_TS,
    };
    require_policy_matches_instagram(instagram_policy(), INSTAGRAM_CREDENTIAL_TYPE, claims);
}

#[test]
unconstrained fn test_instagram_claims_hash_changes_when_handle_changes() {
    let first = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    let second = instagram_claims_hash(INSTAGRAM_HANDLE_HASH + 1);
    assert(first != second, "instagram handle must affect claims hash");
}

#[test]
unconstrained fn test_instagram_claims_hash_changes_when_blind_changes() {
    let first = instagram_claims_hash_with_blind(INSTAGRAM_HANDLE_HASH, INSTAGRAM_HANDLE_BLIND);
    let second = instagram_claims_hash_with_blind(INSTAGRAM_HANDLE_HASH, INSTAGRAM_HANDLE_BLIND + 1);
    assert(first != second, "instagram handle blind must affect claims hash");
}

#[test]
unconstrained fn test_verify_instagram_succeeds_for_matching_handle_hash() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(
            active_owner,
            ghost_owner,
            claims_hash,
            INSTAGRAM_CREDENTIAL_TYPE,
            INSTAGRAM_EXPIRY_TS,
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
        MagnaIssuer::at(issuer).verify_instagram(
            instagram_policy(),
            hinted_credential,
            hinted_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test]
unconstrained fn test_verify_linked_instagram_succeeds_for_matching_handle_hash() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root_authority(
            active_owner,
            ROOT_COMMITMENT,
            passport_authority_claims_hash(),
            INSTAGRAM_EXPIRY_TS,
        ),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_linked_credential(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT,
            claims_hash,
            INSTAGRAM_CREDENTIAL_TYPE,
            INSTAGRAM_EXPIRY_TS,
        ),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(
            active_owner,
            ROOT_COMMITMENT,
            passport_authority_claims_hash(),
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, ROOT_COMMITMENT, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, ROOT_COMMITMENT, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked_instagram(
            instagram_policy(),
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test]
unconstrained fn test_refresh_root_authority_keeps_linked_instagram_usable() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    let initial_authority_claims_hash = passport_authority_claims_hash();
    let renewed_authority_claims_hash = renewed_passport_authority_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root_authority(
            active_owner,
            ROOT_COMMITMENT,
            initial_authority_claims_hash,
            INSTAGRAM_EXPIRY_TS,
        ),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_linked_credential(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT,
            claims_hash,
            INSTAGRAM_CREDENTIAL_TYPE,
            INSTAGRAM_EXPIRY_TS,
        ),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(
            active_owner,
            ROOT_COMMITMENT,
            initial_authority_claims_hash,
        ),
    );

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).refresh_root_authority(
            ghost_owner,
            hinted_root_status,
            hinted_root_authority,
            renewed_authority_claims_hash,
            INSTAGRAM_EXPIRY_TS,
        ),
    );

    let refreshed_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(
            active_owner,
            ROOT_COMMITMENT,
            renewed_authority_claims_hash,
        ),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, ROOT_COMMITMENT, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, ROOT_COMMITMENT, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked_instagram(
            instagram_policy(),
            hinted_root_status,
            refreshed_root_authority,
            hinted_credential,
            hinted_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test(should_fail_with = "claims hash mismatch")]
unconstrained fn test_verify_instagram_rejects_mismatched_handle_hash() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(
            active_owner,
            ghost_owner,
            claims_hash,
            INSTAGRAM_CREDENTIAL_TYPE,
            INSTAGRAM_EXPIRY_TS,
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
        MagnaIssuer::at(issuer).verify_instagram(
            instagram_policy(),
            hinted_credential,
            hinted_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH + 1),
            0,
        ),
    );
}

#[test(should_fail_with = "claims hash mismatch")]
unconstrained fn test_verify_instagram_rejects_mismatched_handle_blind() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(
            active_owner,
            ghost_owner,
            claims_hash,
            INSTAGRAM_CREDENTIAL_TYPE,
            INSTAGRAM_EXPIRY_TS,
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
        MagnaIssuer::at(issuer).verify_instagram(
            instagram_policy(),
            hinted_credential,
            hinted_status,
            InstagramCommittedClaimsWitness {
                handle_hash: INSTAGRAM_HANDLE_HASH,
                handle_blind: INSTAGRAM_HANDLE_BLIND + 1,
            },
            0,
        ),
    );
}
