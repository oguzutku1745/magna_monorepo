use crate::MagnaVerifyMeterHook;
use crate::test::setup::setup;

// Must match POLICY_DELAY_SECONDS in contract source.
global POLICY_DELAY_SECONDS: u64 = 3600;

fn credential_type_bit(credential_type: u8) -> u64 {
    1 as u64 << (credential_type as u64)
}

#[test]
unconstrained fn test_schedule_allowlist_mask_admin_can_schedule_and_effect_applies_after_delay() {
    let (mut env, contract_address, admin, _) = setup(0);
    let credential_type = 1;
    let new_mask = credential_type_bit(credential_type);

    env.call_public(
        admin,
        MagnaVerifyMeterHook::at(contract_address).schedule_allowlist_mask(new_mask),
    );

    let allowed_immediately = env.view_public(
        MagnaVerifyMeterHook::at(contract_address).is_credential_type_allowed(credential_type),
    );
    assert(!allowed_immediately, "allowlist change should be delayed");

    env.advance_next_block_timestamp_by(POLICY_DELAY_SECONDS);
    env.mine_block();

    let allowed_after_delay = env.view_public(
        MagnaVerifyMeterHook::at(contract_address).is_credential_type_allowed(credential_type),
    );
    assert(allowed_after_delay, "allowlist change should apply after delay");
}

#[test(should_fail_with = "admin only")]
unconstrained fn test_schedule_allowlist_mask_non_admin_reverts() {
    let (mut env, contract_address, _, caller) = setup(0);
    env.call_public(
        caller,
        MagnaVerifyMeterHook::at(contract_address).schedule_allowlist_mask(credential_type_bit(1)),
    );
}

#[test]
unconstrained fn test_constructor_scheduled_allowlist_not_active_immediately() {
    let credential_type = 1;
    let (mut env, contract_address, _, _) = setup(credential_type_bit(credential_type));
    let allowed = env.view_public(
        MagnaVerifyMeterHook::at(contract_address).is_credential_type_allowed(credential_type),
    );
    assert(!allowed, "initial scheduled allowlist should not be active immediately");
}

#[test]
unconstrained fn test_constructor_scheduled_allowlist_becomes_active_after_delay() {
    let credential_type = 1;
    let (mut env, contract_address, _, _) = setup(credential_type_bit(credential_type));

    env.advance_next_block_timestamp_by(POLICY_DELAY_SECONDS);
    env.mine_block();

    let allowed = env.view_public(
        MagnaVerifyMeterHook::at(contract_address).is_credential_type_allowed(credential_type),
    );
    assert(allowed, "initial scheduled allowlist should become active after delay");
}

#[test]
unconstrained fn test_meter_verify_or_revert_succeeds_when_allowed_and_increments_count() {
    let credential_type = 1;
    let (mut env, contract_address, _, caller) = setup(credential_type_bit(credential_type));

    env.advance_next_block_timestamp_by(POLICY_DELAY_SECONDS);
    env.mine_block();

    let before = env.execute_utility(
        MagnaVerifyMeterHook::at(contract_address).get_metered_verify_count(),
    );
    assert(before == 0, "meter should start at zero");

    env.call_public(
        caller,
        MagnaVerifyMeterHook::at(contract_address).meter_verify_or_revert(credential_type),
    );

    let after = env.execute_utility(
        MagnaVerifyMeterHook::at(contract_address).get_metered_verify_count(),
    );
    assert(after == 1, "meter should increment by one");
}

#[test]
unconstrained fn test_meter_verify_or_revert_does_not_gate_on_allowlist_mask() {
    // Metering must be "meter-only": if issuer is authorized, it should not revert based on allowlist timing/state.
    let credential_type = 1;
    let (mut env, contract_address, _, caller) = setup(0);

    let before = env.execute_utility(
        MagnaVerifyMeterHook::at(contract_address).get_metered_verify_count(),
    );
    assert(before == 0, "meter should start at zero");

    env.call_public(
        caller,
        MagnaVerifyMeterHook::at(contract_address).meter_verify_or_revert(credential_type),
    );

    let after = env.execute_utility(
        MagnaVerifyMeterHook::at(contract_address).get_metered_verify_count(),
    );
    assert(after == 1, "meter should increment by one");
}

#[test(should_fail_with = "issuer only")]
unconstrained fn test_meter_verify_or_revert_reverts_when_called_by_non_issuer() {
    let credential_type = 1;
    let (mut env, contract_address, _admin, _caller_as_issuer) = setup(credential_type_bit(credential_type));
    let random = env.create_light_account();

    env.advance_next_block_timestamp_by(POLICY_DELAY_SECONDS);
    env.mine_block();

    env.call_public(
        random,
        MagnaVerifyMeterHook::at(contract_address).meter_verify_or_revert(credential_type),
    );
}
