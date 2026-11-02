use crate::MagnaVerifyMeterHookInstant;
use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};

unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let issuer = env.create_light_account();
    let initializer = MagnaVerifyMeterHookInstant::interface().constructor(admin, 2);
    let hook = env.deploy("MagnaVerifyMeterHookInstant").with_public_initializer(admin, initializer);
    env.call_public(admin, MagnaVerifyMeterHookInstant::at(hook).set_issuer(issuer));
    (env, hook, admin, issuer)
}

#[test]
unconstrained fn instant_helper_initializes_updates_and_revokes_allowlist_immediately() {
    let (mut env, hook, admin, _) = setup();
    assert_eq(env.view_public(MagnaVerifyMeterHookInstant::at(hook).get_allowlist_mask()), 2);
    assert(env.view_public(MagnaVerifyMeterHookInstant::at(hook).is_credential_type_allowed(1)));
    env.call_public(admin, MagnaVerifyMeterHookInstant::at(hook).schedule_allowlist_mask(4));
    assert(!env.view_public(MagnaVerifyMeterHookInstant::at(hook).is_credential_type_allowed(1)));
    assert(env.view_public(MagnaVerifyMeterHookInstant::at(hook).is_credential_type_allowed(2)));
    env.call_public(admin, MagnaVerifyMeterHookInstant::at(hook).schedule_allowlist_mask(0));
    assert_eq(env.view_public(MagnaVerifyMeterHookInstant::at(hook).get_allowlist_mask()), 0);
}

#[test(should_fail_with = "admin only")]
unconstrained fn instant_helper_rejects_non_admin_policy_changes() {
    let (mut env, hook, _, issuer) = setup();
    env.call_public(issuer, MagnaVerifyMeterHookInstant::at(hook).schedule_allowlist_mask(0));
}

#[test(should_fail_with = "admin only")]
unconstrained fn instant_helper_rejects_non_admin_issuer_changes() {
    let (mut env, hook, _, issuer) = setup();
    env.call_public(issuer, MagnaVerifyMeterHookInstant::at(hook).set_issuer(issuer));
}

#[test(should_fail_with = "issuer only")]
unconstrained fn instant_helper_rejects_non_issuer_metering() {
    let (mut env, hook, admin, _) = setup();
    env.call_public(admin, MagnaVerifyMeterHookInstant::at(hook).meter_verify_or_revert(1));
}

#[test]
unconstrained fn instant_helper_keeps_authorized_metering_independent_of_allowlist() {
    let (mut env, hook, admin, issuer) = setup();
    env.call_public(admin, MagnaVerifyMeterHookInstant::at(hook).schedule_allowlist_mask(0));
    env.call_public(issuer, MagnaVerifyMeterHookInstant::at(hook).meter_verify_or_revert(1));
    assert_eq(env.execute_utility(MagnaVerifyMeterHookInstant::at(hook).get_metered_verify_count()), 1);
}
