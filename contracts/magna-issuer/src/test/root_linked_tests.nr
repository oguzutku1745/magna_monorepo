use crate::MagnaIssuer;
use crate::internal::{
    claims::compute_passport_claims_hash,
    constants::{MAGNA_CLAIMS_DS, MAGNA_ROOT_REVOCATION_DS, SCHEMA_VERSION_V1},
    revocation::compute_root_revocation_nullifier,
};
use crate::test::setup::setup;
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
    Policy,
    pack_alpha3,
};

global ROOT_COMMITMENT_1: Field = 111;
global ROOT_COMMITMENT_2: Field = 222;
global EXPIRY_TS: u64 = 1_893_456_000;

fn empty_constraints() -> [Constraint; MAX_CONSTRAINTS] {
    [Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 }; MAX_CONSTRAINTS]
}

fn base_policy() -> Policy {
    let mut constraints = empty_constraints();
    constraints[0] = Constraint { claim_id: CLAIM_AGE_MIN_PROVEN, op: OP_GTE, value: 18 };
    constraints[1] = Constraint {
        claim_id: CLAIM_NATIONALITY_ALPHA3,
        op: OP_NEQ,
        value: pack_alpha3(85, 83, 65), // "USA"
    };
    constraints[2] = Constraint { claim_id: CLAIM_EXPIRY_TS, op: OP_GTE, value: 1_800_000_000 };
    Policy { credential_type: 1, constraints }
}

fn claims_hash_for_min_age(min_age_proven: u8) -> Field {
    compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78), // "CAN"
        min_age_proven,
        EXPIRY_TS,
        MAGNA_CLAIMS_DS,
    )
}

#[test]
unconstrained fn test_register_root_inserts_root_status_and_recovery_with_shared_secret() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );

    assert(
        hinted_root_status.note.root_commitment == ROOT_COMMITMENT_1,
        "root status commitment mismatch",
    );
    assert(
        hinted_root_recovery.note.root_commitment == ROOT_COMMITMENT_1,
        "root recovery commitment mismatch",
    );
    assert(
        hinted_root_status.note.revocation_secret == hinted_root_recovery.note.revocation_secret,
        "root status/recovery revocation secret mismatch",
    );
}

#[test]
unconstrained fn test_verify_linked_succeeds_with_live_root_and_linked_status() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = claims_hash_for_min_age(21);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
            EXPIRY_TS,
        ),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked(
            base_policy(),
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "root status mismatch")]
unconstrained fn test_verify_linked_rejects_root_status_from_other_root() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = claims_hash_for_min_age(21);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
            EXPIRY_TS,
        ),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_2),
    );

    let wrong_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_2),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked(
            base_policy(),
            wrong_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test]
unconstrained fn test_refresh_root_authority_rotates_authority_and_mints_new_linked_passport() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let initial_claims_hash = claims_hash_for_min_age(21);
    let refreshed_claims_hash = claims_hash_for_min_age(22);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            initial_claims_hash,
            EXPIRY_TS,
        ),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, initial_claims_hash),
    );

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).refresh_root_authority(
            ghost_owner,
            hinted_root_status,
            hinted_root_authority,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );

    let refreshed_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, refreshed_claims_hash),
    );
    assert(
        refreshed_root_authority.note.claims_hash == refreshed_claims_hash,
        "expected refreshed authority claims hash",
    );
    assert(
        refreshed_root_authority.note.revocation_secret != hinted_root_authority.note.revocation_secret,
        "expected authority revocation secret rotation",
    );

    let refreshed_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, ROOT_COMMITMENT_1, refreshed_claims_hash),
    );
    let refreshed_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, ROOT_COMMITMENT_1, refreshed_claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked(
            base_policy(),
            hinted_root_status,
            refreshed_root_authority,
            refreshed_credential,
            refreshed_status,
            22,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test]
unconstrained fn test_owner_refreshes_root_authority_after_orchestrator_public_authorization() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let initial_claims_hash = claims_hash_for_min_age(21);
    let refreshed_claims_hash = claims_hash_for_min_age(22);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            initial_claims_hash,
            EXPIRY_TS,
        ),
    );
    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, initial_claims_hash),
    );

    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer).authorize_root_authority_refresh(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );
    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).refresh_root_authority_authorized(
            ghost_owner,
            hinted_root_status,
            hinted_root_authority,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );

    let refreshed_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, refreshed_claims_hash),
    );
    assert(refreshed_root_authority.note.claims_hash == refreshed_claims_hash);
}

#[test(should_fail)]
unconstrained fn test_owner_refresh_rejects_unapproved_claims_hash() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let initial_claims_hash = claims_hash_for_min_age(21);
    let approved_claims_hash = claims_hash_for_min_age(22);
    let unapproved_claims_hash = claims_hash_for_min_age(23);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            initial_claims_hash,
            EXPIRY_TS,
        ),
    );
    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, initial_claims_hash),
    );
    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer).authorize_root_authority_refresh(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            approved_claims_hash,
            EXPIRY_TS,
        ),
    );
    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).refresh_root_authority_authorized(
            ghost_owner,
            hinted_root_status,
            hinted_root_authority,
            unapproved_claims_hash,
            EXPIRY_TS,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_owner_refresh_rejects_substituted_ghost_owner() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, attacker) = setup();
    let initial_claims_hash = claims_hash_for_min_age(21);
    let refreshed_claims_hash = claims_hash_for_min_age(22);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            initial_claims_hash,
            EXPIRY_TS,
        ),
    );
    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, initial_claims_hash),
    );
    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer).authorize_root_authority_refresh(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );
    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).refresh_root_authority_authorized(
            attacker,
            hinted_root_status,
            hinted_root_authority,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_owner_refresh_rejects_authorization_for_other_owner() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, attacker) = setup();
    let initial_claims_hash = claims_hash_for_min_age(21);
    let refreshed_claims_hash = claims_hash_for_min_age(22);
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            initial_claims_hash,
            EXPIRY_TS,
        ),
    );
    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, initial_claims_hash),
    );
    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer).authorize_root_authority_refresh(
            attacker,
            ghost_owner,
            ROOT_COMMITMENT_1,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );
    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).refresh_root_authority_authorized(
            ghost_owner,
            hinted_root_status,
            hinted_root_authority,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_verify_linked_rejects_stale_root_authority_after_refresh() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let initial_claims_hash = claims_hash_for_min_age(21);
    let refreshed_claims_hash = claims_hash_for_min_age(22);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            initial_claims_hash,
            EXPIRY_TS,
        ),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let stale_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, initial_claims_hash),
    );

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).refresh_root_authority(
            ghost_owner,
            hinted_root_status,
            stale_root_authority,
            refreshed_claims_hash,
            EXPIRY_TS,
        ),
    );

    let refreshed_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, ROOT_COMMITMENT_1, refreshed_claims_hash),
    );
    let refreshed_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, ROOT_COMMITMENT_1, refreshed_claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked(
            base_policy(),
            hinted_root_status,
            stale_root_authority,
            refreshed_credential,
            refreshed_status,
            22,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "passport lineage must revoke root authority")]
unconstrained fn test_revoke_linked_credential_rejects_passport_authority_lineage() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = claims_hash_for_min_age(21);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
            EXPIRY_TS,
        ),
    );

    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_linked_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1, claims_hash),
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).revoke_linked_credential(hinted_recovery),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_disables_linked_credentials_in_old_root_lineage() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();
    let claims_hash = claims_hash_for_min_age(21);

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_rooted_passport(
            active_owner,
            ghost_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
            EXPIRY_TS,
        ),
    );

    let hinted_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_authority = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );
    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(active_owner, ROOT_COMMITMENT_1, claims_hash),
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root(hinted_root_recovery, new_active_owner),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify_linked(
            base_policy(),
            hinted_root_status,
            hinted_root_authority,
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test]
unconstrained fn test_recover_root_rotates_root_status_for_new_active_owner() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );

    let hinted_root_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(active_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let old_root_nullifier = compute_root_revocation_nullifier(
        hinted_root_recovery.note.revocation_secret,
        hinted_root_recovery.note.root_commitment,
        MAGNA_ROOT_REVOCATION_DS,
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root(hinted_root_recovery, new_active_owner),
    );

    let rotated_root_status = env.call_private(
        new_active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(new_active_owner, ROOT_COMMITMENT_1),
    );
    assert(
        rotated_root_status.note.revocation_secret != hinted_root_status.note.revocation_secret,
        "expected root revocation secret rotation",
    );

    let new_root_nullifier = compute_root_revocation_nullifier(
        rotated_root_status.note.revocation_secret,
        rotated_root_status.note.root_commitment,
        MAGNA_ROOT_REVOCATION_DS,
    );
    assert(
        new_root_nullifier != old_root_nullifier,
        "expected root kill-switch nullifier rotation",
    );
}
