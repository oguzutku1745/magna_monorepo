use crate::MagnaIssuer;
use crate::internal::{
    claims::compute_passport_claims_hash,
    constants::{MAGNA_CLAIMS_DS, MAGNA_REVOCATION_DS, SCHEMA_VERSION_V1},
    revocation::compute_revocation_nullifier,
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

fn base_claims_hash() -> Field {
    compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1, // credential_type
        pack_alpha3(67, 65, 78), // "CAN"
        21, // min_age_proven
        1_893_456_000, // expiry_ts
        MAGNA_CLAIMS_DS,
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

#[test]
unconstrained fn test_register_credential_inserts_expected_notes_and_shared_revocation_secret() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    let claims_hash = base_claims_hash();
    let credential_type = 1;
    let expiry_ts = 1_893_456_000;

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(
            active_owner,
            ghost_owner,
            claims_hash,
            credential_type,
            expiry_ts,
        ),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );
    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );

    assert(hinted_credential.note.claims_hash == claims_hash, "credential claims hash mismatch");
    assert(hinted_credential.note.credential_type == credential_type, "credential type mismatch");
    assert(hinted_credential.note.expiry_ts == expiry_ts, "credential expiry mismatch");

    assert(hinted_status.note.claims_hash == claims_hash, "status claims hash mismatch");
    assert(hinted_status.note.credential_type == credential_type, "status type mismatch");

    assert(hinted_recovery.note.claims_hash == claims_hash, "recovery claims hash mismatch");
    assert(hinted_recovery.note.credential_type == credential_type, "recovery type mismatch");
    assert(hinted_recovery.note.expiry_ts == expiry_ts, "recovery expiry mismatch");

    assert(
        hinted_status.note.revocation_secret == hinted_recovery.note.revocation_secret,
        "status/recovery revocation secret mismatch",
    );
}

#[test(should_fail_with = "credential note not found")]
unconstrained fn test_get_credential_hinted_fails_when_note_missing() {
    let (mut env, contract_address, _, active_owner, _, _) = setup();
    let claims_hash = base_claims_hash();
    let _ = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
}

#[test(should_fail_with = "status note not found")]
unconstrained fn test_get_status_hinted_fails_when_note_missing() {
    let (mut env, contract_address, _, active_owner, _, _) = setup();
    let claims_hash = base_claims_hash();
    let _ = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );
}

#[test(should_fail_with = "recovery note not found")]
unconstrained fn test_get_recovery_hinted_fails_when_note_missing() {
    let (mut env, contract_address, _, _, ghost_owner, _) = setup();
    let claims_hash = base_claims_hash();
    let _ = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );
}

#[test(should_fail_with = "owner mismatch")]
unconstrained fn test_get_credential_hinted_requires_owner_sender_match() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, attacker) = setup();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let _ = env.call_private(
        attacker,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
}

#[test(should_fail_with = "owner mismatch")]
unconstrained fn test_get_status_hinted_requires_owner_sender_match() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, attacker) = setup();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let _ = env.call_private(
        attacker,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );
}

#[test(should_fail_with = "owner mismatch")]
unconstrained fn test_get_recovery_hinted_requires_owner_sender_match() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, attacker) = setup();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let _ = env.call_private(
        attacker,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );
}

#[test]
unconstrained fn test_verify_succeeds_with_valid_notes_and_policy() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );

    let policy = base_policy();
    let min_age_proven = 21;
    let nationality_packed = pack_alpha3(67, 65, 78); // "CAN"

    env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).verify(
            policy,
            hinted_credential,
            hinted_status,
            min_age_proven,
            nationality_packed,
            0, // sponsor_slot (unused when verify_meter_hook is zero in test setup)
        ),
    );
}

#[test]
unconstrained fn test_verify_consumer_allows_configured_gateway_calls() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, consumer) = setup();

    env.call_public(
        orchestrator,
        MagnaIssuer::at(contract_address).initialize_consumer_gateway(consumer),
    );

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );

    env.call_private(
        consumer,
        MagnaIssuer::at(contract_address).verify_consumer(
            active_owner,
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "consumer only")]
unconstrained fn test_verify_consumer_rejects_unconfigured_gateway_sender() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, consumer) = setup();

    env.call_public(
        orchestrator,
        MagnaIssuer::at(contract_address).initialize_consumer_gateway(consumer),
    );

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).verify_consumer(
            active_owner,
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "owner mismatch")]
unconstrained fn test_verify_consumer_rejects_owner_mismatch() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, consumer) = setup();

    env.call_public(
        orchestrator,
        MagnaIssuer::at(contract_address).initialize_consumer_gateway(consumer),
    );

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );

    env.call_private(
        consumer,
        MagnaIssuer::at(contract_address).verify_consumer(
            consumer,
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "claims mismatch")]
unconstrained fn test_verify_fails_when_credential_and_status_claims_hash_do_not_match() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    let claims_hash_1 = base_claims_hash();
    let claims_hash_2 = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78), // "CAN"
        22, // min_age_proven differs
        1_893_456_000,
        MAGNA_CLAIMS_DS,
    );

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash_1, 1, 1_893_456_000),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash_2, 1, 1_893_456_000),
    );

    let hinted_credential_1 = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash_1),
    );
    let hinted_status_2 = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash_2),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).verify(
            base_policy(),
            hinted_credential_1,
            hinted_status_2,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "credential/status type mismatch")]
unconstrained fn test_verify_fails_when_credential_and_status_type_do_not_match() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    let claims_hash_type_1 = base_claims_hash();
    let claims_hash_type_2 = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        2, // different credential type
        pack_alpha3(67, 65, 78),
        21,
        1_893_456_000,
        MAGNA_CLAIMS_DS,
    );

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash_type_1, 1, 1_893_456_000),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash_type_2, 2, 1_893_456_000),
    );

    let hinted_credential_type_1 = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash_type_1),
    );
    let hinted_status_type_2 = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash_type_2),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).verify(
            base_policy(),
            hinted_credential_type_1,
            hinted_status_type_2,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "claims hash mismatch")]
unconstrained fn test_verify_fails_when_claim_inputs_do_not_match_claims_hash() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );

    // Provide wrong nationality for the same hinted notes.
    env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).verify(
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(85, 83, 65), // "USA"
            0,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_meter_verify_only_self_cannot_be_called_externally() {
    let (mut env, contract_address, orchestrator, _, _, _) = setup();
    env.call_public(orchestrator, MagnaIssuer::at(contract_address)._meter_verify());
}

#[test]
unconstrained fn test_verify_increments_meter_count_via_utility_read_path() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    let before = env.execute_utility(MagnaIssuer::at(contract_address).get_verify_meter_count());
    assert(before == 0, "verify meter should start at zero");

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).verify(
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );

    let after = env.execute_utility(MagnaIssuer::at(contract_address).get_verify_meter_count());
    assert(after == 1, "verify meter should increment by one");
}

#[test]
unconstrained fn test_recover_emits_revocation_nullifier_and_rotates_status_secret() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );
    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );

    let old_kill_switch_nullifier = compute_revocation_nullifier(
        hinted_recovery.note.revocation_secret,
        hinted_recovery.note.credential_type,
        hinted_recovery.note.claims_hash,
        MAGNA_REVOCATION_DS,
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).recover(hinted_recovery, new_active_owner, true),
    );

    // New status note is minted for new_active_owner with a fresh secret (overwhelming probability).
    let rotated_status = env.call_private(
        new_active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(new_active_owner, claims_hash),
    );
    assert(
        rotated_status.note.revocation_secret != hinted_status.note.revocation_secret,
        "expected status revocation secret rotation",
    );

    let new_kill_switch_nullifier = compute_revocation_nullifier(
        rotated_status.note.revocation_secret,
        rotated_status.note.credential_type,
        rotated_status.note.claims_hash,
        MAGNA_REVOCATION_DS,
    );
    assert(
        old_kill_switch_nullifier != new_kill_switch_nullifier,
        "expected kill-switch nullifier rotation after recovery",
    );
}

#[test]
unconstrained fn test_recover_with_remint_true_creates_credential_for_new_active_owner() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).recover(hinted_recovery, new_active_owner, true),
    );

    let reminted_credential = env.call_private(
        new_active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(new_active_owner, claims_hash),
    );
    assert(reminted_credential.note.claims_hash == claims_hash, "reminted credential claims mismatch");
}

#[test(should_fail)]
unconstrained fn test_verify_fails_after_recovery_due_to_revocation_nullifier() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(active_owner, claims_hash),
    );
    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).recover(hinted_recovery, new_active_owner, true),
    );

    // This must now fail due to revocation nullifier existence.
    env.call_private(
        active_owner,
        MagnaIssuer::at(contract_address).verify(
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_recover_cannot_be_replayed_with_same_hinted_note() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).recover(hinted_recovery, new_active_owner, true),
    );
    // Replay should fail because recovery note has already been nullified.
    env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).recover(hinted_recovery, new_active_owner, true),
    );
}

#[test]
unconstrained fn test_recover_without_remint_keeps_credential_unissued_for_new_active_owner() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).recover(hinted_recovery, new_active_owner, false),
    );

    // Status should still be re-issued to the new active owner.
    let _ = env.call_private(
        new_active_owner,
        MagnaIssuer::at(contract_address).get_status_hinted(new_active_owner, claims_hash),
    );
    // Recovery rotation remains owned by the ghost owner by design.
    let _ = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );
}

#[test(should_fail_with = "credential note not found")]
unconstrained fn test_recover_without_remint_does_not_create_new_active_owner_credential_note() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, new_active_owner) = setup();

    let claims_hash = base_claims_hash();
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_recovery = env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).get_recovery_hinted(ghost_owner, claims_hash),
    );

    env.call_private(
        ghost_owner,
        MagnaIssuer::at(contract_address).recover(hinted_recovery, new_active_owner, false),
    );

    let _ = env.call_private(
        new_active_owner,
        MagnaIssuer::at(contract_address).get_credential_hinted(new_active_owner, claims_hash),
    );
}

