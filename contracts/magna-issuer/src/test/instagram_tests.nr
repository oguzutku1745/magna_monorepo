use crate::internal::{
    claims::{
        compute_instagram_claims_hash, compute_instagram_handle_commitment,
        compute_passport_claims_hash,
    },
    constants::{
        MAGNA_CLAIMS_DS, MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS, SCHEMA_VERSION_V1, SCHEMA_VERSION_V2,
    },
};
use crate::internal::revocation::bounded_revocation_deadline;
use crate::MagnaIssuer;
use crate::test::{root_linked_tests::seed_root_recovery_message, setup::setup};
use magna_lib::{
    CLAIM_EXPIRY_TS, CLAIM_INSTAGRAM_HANDLE_HASH, CLAIM_NONE, Constraint, InstagramClaims,
    InstagramCommittedClaimsWitness, MAX_CONSTRAINTS, OP_EQ, OP_GTE, OP_NONE, pack_alpha3, Policy,
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
    InstagramCommittedClaimsWitness { handle_hash, handle_blind: INSTAGRAM_HANDLE_BLIND }
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
    let claims =
        InstagramClaims { handle_hash: INSTAGRAM_HANDLE_HASH, expiry_ts: INSTAGRAM_EXPIRY_TS };
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
    let second =
        instagram_claims_hash_with_blind(INSTAGRAM_HANDLE_HASH, INSTAGRAM_HANDLE_BLIND + 1);
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
unconstrained fn test_verify_linked_instagram_succeeds_after_passport_authority_expiry() {
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
            1,
        ),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(
            active_owner,
            ghost_owner,
            claims_hash,
            3,
            INSTAGRAM_EXPIRY_TS,
        ),
    );
    let source = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let source_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );
    let root = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT),
    );
    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).link_credential_to_root(source, source_status, root),
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
        MagnaIssuer::at(issuer).get_linked_credential_hinted(
            active_owner,
            ROOT_COMMITMENT,
            claims_hash,
        ),
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
        MagnaIssuer::at(issuer).register_credential(
            active_owner,
            ghost_owner,
            claims_hash,
            3,
            INSTAGRAM_EXPIRY_TS,
        ),
    );
    let source = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let source_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );
    let root = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT),
    );
    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).link_credential_to_root(source, source_status, root),
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
        MagnaIssuer::at(issuer).get_linked_credential_hinted(
            active_owner,
            ROOT_COMMITMENT,
            claims_hash,
        ),
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

#[test(should_fail)]
unconstrained fn test_instagram_exact_commitment_replay_is_rejected_across_mint_versions() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, 701, 3, INSTAGRAM_EXPIRY_TS),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential_v2(owner, ghost, 701, 3, INSTAGRAM_EXPIRY_TS),
    );
}

#[test(should_fail_with = "instagram requires holder linking")]
unconstrained fn test_legacy_linked_instagram_mint_is_disabled() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_linked_credential(
            owner,
            ghost,
            ROOT_COMMITMENT,
            702,
            3,
            INSTAGRAM_EXPIRY_TS,
        ),
    );
}

#[test]
unconstrained fn test_holder_link_preserves_claims_and_expiry_and_binds_root_secret() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, ROOT_COMMITMENT, claims),
    );
    assert_eq(linked.note.claims_hash, credential.note.claims_hash);
    assert_eq(linked.note.expiry_ts, credential.note.expiry_ts);
    assert_eq(linked.note.credential_type, 3);
    assert(linked_status.note.revocation_secret != status.note.revocation_secret);
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_linked_instagram(
            instagram_policy(),
            root,
            linked,
            linked_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test(should_fail_with = "Cannot prove nullifier non-inclusion")]
unconstrained fn test_cached_standalone_fails_after_conversion() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_instagram(
            instagram_policy(),
            credential,
            status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test(should_fail_with = "note owner mismatch")]
unconstrained fn test_link_rejects_wrong_owner() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(
        attacker,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
}

#[test(should_fail_with = "note issuer mismatch")]
unconstrained fn test_link_rejects_wrong_issuer() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    credential.contract_address = attacker;
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
}

#[test(should_fail_with = "note storage slot mismatch")]
unconstrained fn test_link_rejects_wrong_credential_slot() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    credential.storage_slot = status.storage_slot;
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
}

#[test(should_fail_with = "note storage slot mismatch")]
unconstrained fn test_link_rejects_wrong_status_slot() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    status.storage_slot = credential.storage_slot;
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
}

#[test(should_fail_with = "note storage slot mismatch")]
unconstrained fn test_link_rejects_wrong_root_slot() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    root.storage_slot = status.storage_slot;
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
}

#[test(should_fail_with = "Cannot prove nullifier non-inclusion")]
unconstrained fn test_link_rejects_revoked_source() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_credential(status));
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
}

#[test(should_fail_with = "Cannot prove nullifier non-inclusion")]
unconstrained fn test_link_rejects_revoked_root() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_root_as_owner(root));
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
}

#[test(should_fail_with = "Cannot prove nullifier non-inclusion")]
unconstrained fn test_owner_revoke_kills_cached_independent() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_credential(status));
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_instagram(
            instagram_policy(),
            credential,
            status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test(should_fail_with = "Cannot prove nullifier non-inclusion")]
unconstrained fn test_linked_owner_revoke_kills_cached_linked() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, ROOT_COMMITMENT, claims),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_linked_credential_as_owner(linked_status));
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_linked_instagram(
            instagram_policy(),
            root,
            linked,
            linked_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test(should_fail_with = "linked recovery note not found")]
unconstrained fn test_holder_link_does_not_mint_recovery() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).link_credential_to_root(credential, status, root),
    );
    let _ = env.call_private(
        ghost,
        MagnaIssuer::at(issuer).get_linked_recovery_hinted(ghost, ROOT_COMMITMENT, claims),
    );
}


#[test]
unconstrained fn test_root_owner_revoke_leaves_independent_instagram_usable() {
    let (env, issuer, orchestrator, owner, ghost, attacker) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let mut credential =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let mut status =
        env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let mut root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_root_as_owner(root));
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_instagram(
            instagram_policy(),
            credential,
            status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test]
unconstrained fn test_owner_root_revoke_preserves_v3_recovery_to_same_owner() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let source =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).link_credential_to_root(source, status, root));
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, ROOT_COMMITMENT, claims),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_root_as_owner(root));
    let recovery = env.call_private(
        ghost,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost, ROOT_COMMITMENT),
    );
    let passport_claims = passport_authority_claims_hash();
    let message_secret = 0x3434;
    let leaf = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT,
        owner,
        34,
        passport_claims,
        INSTAGRAM_EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost,
        MagnaIssuer::at(issuer).recover_root_v3(
            recovery,
            owner,
            34,
            passport_claims,
            INSTAGRAM_EXPIRY_TS,
            message_secret,
            leaf,
        ),
    );
    let new_recovery = env.call_private(
        ghost,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost, ROOT_COMMITMENT),
    );
    let new_root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted_by_secret(
            owner,
            ROOT_COMMITMENT,
            new_recovery.note.revocation_secret,
        ),
    );
    assert(new_root.note.revocation_secret != root.note.revocation_secret);
}

#[test(should_fail_with = "linked root version mismatch")]
unconstrained fn test_same_owner_v3_recovery_rejects_old_linked_instagram_with_new_root() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let source =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).link_credential_to_root(source, status, root));
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let recovery = env.call_private(
        ghost,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost, ROOT_COMMITMENT),
    );
    let passport_claims = passport_authority_claims_hash();
    let message_secret = 0x3434;
    let leaf = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT,
        owner,
        34,
        passport_claims,
        INSTAGRAM_EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost,
        MagnaIssuer::at(issuer).recover_root_v3(
            recovery,
            owner,
            34,
            passport_claims,
            INSTAGRAM_EXPIRY_TS,
            message_secret,
            leaf,
        ),
    );
    let new_recovery = env.call_private(
        ghost,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost, ROOT_COMMITMENT),
    );
    let new_root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted_by_secret(
            owner,
            ROOT_COMMITMENT,
            new_recovery.note.revocation_secret,
        ),
    );
    assert(new_root.note.revocation_secret != root.note.revocation_secret);
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_linked_instagram(
            instagram_policy(),
            new_root,
            linked,
            linked_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test(should_fail_with = "Cannot prove nullifier non-inclusion")]
unconstrained fn test_root_owner_revoke_blocks_linked_instagram() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let source =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).link_credential_to_root(source, status, root));
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, ROOT_COMMITMENT, claims),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_root_as_owner(root));
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_linked_instagram(
            instagram_policy(),
            root,
            linked,
            linked_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}

#[test(should_fail_with = "credential expired")]
unconstrained fn test_link_rejects_expired_source() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, 709, 3, 1),
    );
    let source = env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, 709));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, 709));
    let root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).link_credential_to_root(source, status, root));
}

#[test]
fn test_revocation_deadline_caps_anchor_and_preserves_shorter_expiry() {
    assert_eq(bounded_revocation_deadline(1000, 9000), 1300);
    assert_eq(bounded_revocation_deadline(1000, 1100), 1100);
    assert_eq(bounded_revocation_deadline(1000, 1300), 1300);
}

#[test(should_fail_with = "note issuer mismatch")]
unconstrained fn test_standalone_verifier_rejects_genuine_foreign_issuer_notes() {
    let (mut env, issuer, orchestrator, owner, ghost, _) = setup();
    let foreign = env.deploy("MagnaIssuer").with_public_initializer(orchestrator,
        MagnaIssuer::interface().constructor(orchestrator, aztec::protocol::address::AztecAddress::zero()));
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(orchestrator, MagnaIssuer::at(foreign).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS));
    let credential = env.call_private(owner, MagnaIssuer::at(foreign).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(foreign).get_status_hinted(owner, claims));
    env.call_private(owner, MagnaIssuer::at(issuer).verify_instagram(instagram_policy(), credential, status, instagram_claims_witness(INSTAGRAM_HANDLE_HASH), 0));
}

#[test]
unconstrained fn test_fresh_blind_reissuance_and_individual_revocation_leave_other_instance_active() {
    let (env, issuer, orchestrator, owner, ghost, _) = setup();
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    let fresh_claims = instagram_claims_hash_with_blind(INSTAGRAM_HANDLE_HASH, INSTAGRAM_HANDLE_BLIND + 1);
    env.call_private(orchestrator, MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS));
    env.call_private(orchestrator, MagnaIssuer::at(issuer).register_credential(owner, ghost, fresh_claims, 3, INSTAGRAM_EXPIRY_TS));
    let revoked = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    env.call_private(owner, MagnaIssuer::at(issuer).revoke_credential(revoked));
    let credential = env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, fresh_claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, fresh_claims));
    env.call_private(owner, MagnaIssuer::at(issuer).verify_instagram(instagram_policy(), credential, status,
        InstagramCommittedClaimsWitness { handle_hash: INSTAGRAM_HANDLE_HASH, handle_blind: INSTAGRAM_HANDLE_BLIND + 1 }, 0));
}

#[test(should_fail_with = "linked root version mismatch")]
unconstrained fn test_v3_recovery_away_then_back_rejects_old_linked_instagram() {
    let (env, issuer, orchestrator, owner, ghost, destination) = setup();
    let claims = instagram_claims_hash(INSTAGRAM_HANDLE_HASH);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(owner, ghost, ROOT_COMMITMENT),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, INSTAGRAM_EXPIRY_TS),
    );
    let source =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(owner, ROOT_COMMITMENT),
    );
    env.call_private(owner, MagnaIssuer::at(issuer).link_credential_to_root(source, status, root));
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, ROOT_COMMITMENT, claims),
    );
    let recovery = env.call_private(
        ghost,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost, ROOT_COMMITMENT),
    );
    let passport_claims = passport_authority_claims_hash();
    let message_secret = 0x3434;
    let leaf = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT,
        destination,
        34,
        passport_claims,
        INSTAGRAM_EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost,
        MagnaIssuer::at(issuer).recover_root_v3(
            recovery,
            destination,
            34,
            passport_claims,
            INSTAGRAM_EXPIRY_TS,
            message_secret,
            leaf,
        ),
    );
    let second_recovery = env.call_private(ghost, MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost, ROOT_COMMITMENT));
    let second_secret = 0x3535;
    let second_leaf = seed_root_recovery_message(env, issuer, ROOT_COMMITMENT, owner, 35, passport_claims, INSTAGRAM_EXPIRY_TS, second_secret);
    env.call_private(ghost, MagnaIssuer::at(issuer).recover_root_v3(second_recovery, owner, 35, passport_claims, INSTAGRAM_EXPIRY_TS, second_secret, second_leaf));
    let new_recovery = env.call_private(
        ghost,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost, ROOT_COMMITMENT),
    );
    let new_root = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_root_status_hinted_by_secret(
            owner,
            ROOT_COMMITMENT,
            new_recovery.note.revocation_secret,
        ),
    );
    assert(new_root.note.revocation_secret != root.note.revocation_secret);
    env.call_private(
        owner,
        MagnaIssuer::at(issuer).verify_linked_instagram(
            instagram_policy(),
            new_root,
            linked,
            linked_status,
            instagram_claims_witness(INSTAGRAM_HANDLE_HASH),
            0,
        ),
    );
}
