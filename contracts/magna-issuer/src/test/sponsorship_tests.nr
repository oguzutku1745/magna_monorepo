use crate::MagnaIssuer;
use crate::internal::claims::compute_passport_claims_hash;
use crate::internal::constants::{
    MAGNA_CLAIMS_DS,
    MAGNA_SPONSOR_POLICY_DELAY_SECONDS,
    MAGNA_SPONSOR_RL_WINDOW_SECONDS,
    SCHEMA_VERSION_V1,
};
use crate::test::setup::{setup, setup_sponsored};
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

fn empty_constraints() -> [Constraint; MAX_CONSTRAINTS] {
    [Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 }; MAX_CONSTRAINTS]
}

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
unconstrained fn test_verify_sponsored_entrypoint_allows_configured_gateway_calls() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, gateway) = setup();
    let claims_hash = base_claims_hash();

    let before = env.execute_utility(MagnaIssuer::at(issuer).get_verify_meter_count());
    assert(before == 0, "verify meter should start at zero");

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
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
        gateway,
        MagnaIssuer::at(issuer).verify_sponsored(
            active_owner,
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );

    let after = env.execute_utility(MagnaIssuer::at(issuer).get_verify_meter_count());
    assert(after == 1, "verify meter should increment by one");
}

#[test(should_fail_with = "company sponsor only")]
unconstrained fn test_verify_sponsored_entrypoint_rejects_unconfigured_gateway_sender() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, _) = setup();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
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
        MagnaIssuer::at(issuer).verify_sponsored(
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
unconstrained fn test_verify_sponsored_entrypoint_rejects_owner_mismatch() {
    let (mut env, issuer, orchestrator, active_owner, ghost_owner, gateway) = setup();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
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
        gateway,
        MagnaIssuer::at(issuer).verify_sponsored(
            gateway,
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "invalid sponsor slot")]
unconstrained fn test_sponsored_verify_rejects_invalid_slot() {
    let (mut env, issuer, _, orchestrator, active_owner, ghost_owner, _) = setup_sponsored();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
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
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            5, // invalid (slots are 0..4)
        ),
    );
}

#[test]
unconstrained fn test_sponsored_verify_allows_five_slots_per_window() {
    let (mut env, issuer, _, orchestrator, active_owner, ghost_owner, _) = setup_sponsored();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    let hinted_credential = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );

    // Slots 0..4 should all be accepted within the same 24h window.
    for i in 0..5 {
        env.call_private(
            active_owner,
            MagnaIssuer::at(issuer).verify(
                base_policy(),
                hinted_credential,
                hinted_status,
                21,
                pack_alpha3(67, 65, 78),
                i as u8,
            ),
        );
    }
}

#[test(should_fail)]
unconstrained fn test_sponsored_verify_rejects_reusing_same_slot_in_window() {
    let (mut env, issuer, _, orchestrator, active_owner, ghost_owner, _) = setup_sponsored();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
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
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );

    // Same slot again in same window must be rejected (duplicate rate-limit nullifier).
    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify(
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test]
unconstrained fn test_sponsored_credential_type_mask_is_not_applied_before_delay() {
    let (mut env, issuer, _, orchestrator, active_owner, ghost_owner, _) = setup_sponsored();
    let claims_hash = base_claims_hash();
    let disallow_current_type_mask = 1 as u64 << 2;

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer).schedule_sponsored_credential_type_mask(disallow_current_type_mask),
    );

    let current_mask_immediately = env.view_public(
        MagnaIssuer::at(issuer).get_sponsored_credential_type_mask(),
    );
    assert(current_mask_immediately == 0, "scheduled sponsor mask should not apply immediately");

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
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail_with = "credential type not sponsored")]
unconstrained fn test_sponsored_credential_type_mask_rejects_after_delay() {
    let (mut env, issuer, _, orchestrator, active_owner, ghost_owner, _) = setup_sponsored();
    let claims_hash = base_claims_hash();
    let disallow_current_type_mask = 1 as u64 << 2;

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
    );

    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer).schedule_sponsored_credential_type_mask(disallow_current_type_mask),
    );

    env.advance_next_block_timestamp_by(MAGNA_SPONSOR_POLICY_DELAY_SECONDS);
    env.mine_block();

    let current_mask_after_delay = env.view_public(
        MagnaIssuer::at(issuer).get_sponsored_credential_type_mask(),
    );
    assert(
        current_mask_after_delay == disallow_current_type_mask,
        "scheduled sponsor mask should apply after delay",
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
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test]
unconstrained fn test_sponsored_verify_allows_reusing_same_slot_after_window_rollover() {
    let (mut env, issuer, _, orchestrator, active_owner, ghost_owner, _) = setup_sponsored();
    let claims_hash = base_claims_hash();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(active_owner, ghost_owner, claims_hash, 1, 1_893_456_000),
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
            base_policy(),
            hinted_credential,
            hinted_status,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );

    env.advance_next_block_timestamp_by(MAGNA_SPONSOR_RL_WINDOW_SECONDS);
    env.mine_block();

    let hinted_credential_after_rollover = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_credential_hinted(active_owner, claims_hash),
    );
    let hinted_status_after_rollover = env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).get_status_hinted(active_owner, claims_hash),
    );

    env.call_private(
        active_owner,
        MagnaIssuer::at(issuer).verify(
            base_policy(),
            hinted_credential_after_rollover,
            hinted_status_after_rollover,
            21,
            pack_alpha3(67, 65, 78),
            0,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_initialize_company_sponsor_gateway_cannot_be_reinitialized() {
    let (mut env, issuer, orchestrator, _, _, attacker) = setup();
    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer).initialize_company_sponsor_gateway(attacker),
    );
}

