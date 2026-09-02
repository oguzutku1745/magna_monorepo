use crate::MagnaIssuer;
use crate::internal::{
    claims::compute_passport_claims_hash,
    constants::{MAGNA_CLAIMS_DS, MAGNA_ROOT_REVOCATION_DS, SCHEMA_VERSION_V1},
    revocation::compute_root_revocation_nullifier,
};
use crate::test::setup::setup;
use aztec::{
    hash::compute_secret_hash,
    protocol::{
        address::{AztecAddress, EthAddress},
        traits::ToField,
    },
    test::helpers::test_environment::TestEnvironment,
};
use magna_recovery_v3_protocol::{compute_recovery_authorization, compute_recovery_intent};
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
global RECOVERY_PORTAL: Field = 0xdead;

unconstrained fn seed_root_recovery_message(
    env: TestEnvironment,
    issuer: AztecAddress,
    root_commitment: Field,
    destination: AztecAddress,
    recovery_nonce: Field,
    claims_hash: Field,
    credential_valid_until: u64,
    message_secret: Field,
) -> Field {
    let (aztec_chain_id, aztec_protocol_version) = env.private_context_at(issuer, |context| {
        let header = context.get_anchor_block_header();
        (header.global_variables.chain_id, header.global_variables.version)
    });
    let recovery_intent = compute_recovery_intent(
        aztec_chain_id,
        RECOVERY_PORTAL,
        aztec_protocol_version,
        aztec_chain_id,
        issuer.to_field(),
        destination.to_field(),
        recovery_nonce,
        compute_secret_hash([message_secret]),
    );
    let authorization = compute_recovery_authorization(
        recovery_intent,
        root_commitment,
        claims_hash,
        credential_valid_until,
    );
    env.send_l1_to_l2_message(
        authorization,
        message_secret,
        EthAddress::from_field(RECOVERY_PORTAL),
        issuer,
    )
}

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

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_missing_proof_authorization() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted_root_recovery,
            new_active_owner,
            10,
            claims_hash_for_min_age(21),
            EXPIRY_TS,
            0x1010,
            0,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_substituted_destination() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let claims_hash = claims_hash_for_min_age(21);
    let message_secret = 0x1111;
    let leaf_index = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT_1,
        new_active_owner,
        11,
        claims_hash,
        EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted_root_recovery,
            active_owner,
            11,
            claims_hash,
            EXPIRY_TS,
            message_secret,
            leaf_index,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_substituted_nonce() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let claims_hash = claims_hash_for_min_age(21);
    let message_secret = 0x1212;
    let leaf_index = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT_1,
        new_active_owner,
        12,
        claims_hash,
        EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted_root_recovery,
            new_active_owner,
            13,
            claims_hash,
            EXPIRY_TS,
            message_secret,
            leaf_index,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_substituted_claims() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, destination) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let claims_hash = claims_hash_for_min_age(21);
    let secret = 0x1313;
    let leaf_index = seed_root_recovery_message(
        env, issuer, ROOT_COMMITMENT_1, destination, 13, claims_hash, EXPIRY_TS, secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted, destination, 13, claims_hash + 1, EXPIRY_TS, secret, leaf_index,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_substituted_expiry() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, destination) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let claims_hash = claims_hash_for_min_age(21);
    let secret = 0x1414;
    let leaf_index = seed_root_recovery_message(
        env, issuer, ROOT_COMMITMENT_1, destination, 14, claims_hash, EXPIRY_TS, secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted, destination, 14, claims_hash, EXPIRY_TS + 1, secret, leaf_index,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_substituted_message_secret() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, destination) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let claims_hash = claims_hash_for_min_age(21);
    let secret = 0x1515;
    let leaf_index = seed_root_recovery_message(
        env, issuer, ROOT_COMMITMENT_1, destination, 15, claims_hash, EXPIRY_TS, secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted, destination, 15, claims_hash, EXPIRY_TS, secret + 1, leaf_index,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_substituted_leaf_index() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, destination) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let hinted = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let claims_hash = claims_hash_for_min_age(21);
    let secret = 0x1616;
    let leaf_index = seed_root_recovery_message(
        env, issuer, ROOT_COMMITMENT_1, destination, 16, claims_hash, EXPIRY_TS, secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted, destination, 16, claims_hash, EXPIRY_TS, secret, leaf_index + 1,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_root_rejects_replayed_authorization() {
    let (env, issuer, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_root(active_owner, ghost_owner, ROOT_COMMITMENT_1),
    );
    let first_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    let authorization_nonce = 14;
    let claims_hash = claims_hash_for_min_age(21);
    let message_secret = 0x1414;
    let leaf_index = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT_1,
        new_active_owner,
        authorization_nonce,
        claims_hash,
        EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            first_root_recovery,
            new_active_owner,
            authorization_nonce,
            claims_hash,
            EXPIRY_TS,
            message_secret,
            leaf_index,
        ),
    );
    let second_root_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_root_recovery_hinted(ghost_owner, ROOT_COMMITMENT_1),
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            second_root_recovery,
            new_active_owner,
            authorization_nonce,
            claims_hash,
            EXPIRY_TS,
            message_secret,
            leaf_index,
        ),
    );
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

    let authorization_nonce = 1;
    let message_secret = 0x2121;
    let leaf_index = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT_1,
        new_active_owner,
        authorization_nonce,
        claims_hash,
        EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted_root_recovery,
            new_active_owner,
            authorization_nonce,
            claims_hash,
            EXPIRY_TS,
            message_secret,
            leaf_index,
        ),
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

    let authorization_nonce = 2;
    let claims_hash = claims_hash_for_min_age(21);
    let message_secret = 0x2222;
    let leaf_index = seed_root_recovery_message(
        env,
        issuer,
        ROOT_COMMITMENT_1,
        new_active_owner,
        authorization_nonce,
        claims_hash,
        EXPIRY_TS,
        message_secret,
    );
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).recover_root_v3(
            hinted_root_recovery,
            new_active_owner,
            authorization_nonce,
            claims_hash,
            EXPIRY_TS,
            message_secret,
            leaf_index,
        ),
    );

    let rotated_root_status = env.call_private(
        new_active_owner,
        MagnaIssuer::at(issuer).get_root_status_hinted(new_active_owner, ROOT_COMMITMENT_1),
    );
    let _rotated_root_authority = env.call_private(
        new_active_owner,
        MagnaIssuer::at(issuer).get_root_authority_hinted(
            new_active_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
        ),
    );
    let rotated_credential = env.call_private(
        new_active_owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(
            new_active_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
        ),
    );
    let _rotated_linked_status = env.call_private(
        new_active_owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(
            new_active_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
        ),
    );
    let _rotated_linked_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(issuer).get_linked_recovery_hinted(
            ghost_owner,
            ROOT_COMMITMENT_1,
            claims_hash,
        ),
    );
    assert_eq(rotated_credential.note.expiry_ts, EXPIRY_TS);
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
