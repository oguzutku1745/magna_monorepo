use crate::MagnaCompanyRightsRegistry;
use crate::test::setup::setup;
use aztec::{
    protocol::address::EthAddress,
    test::helpers::test_environment::TestEnvironment,
};

#[test]
unconstrained fn test_initialize_l2_purchase_adapter_admin_path_succeeds() {
    let (mut env, registry, admin, _, adapter, _) = setup();
    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
}

#[test(should_fail_with = "admin only")]
unconstrained fn test_initialize_l2_purchase_adapter_requires_admin() {
    let (mut env, registry, _, _, adapter, attacker) = setup();
    env.call_public(
        attacker,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
}

#[test(should_fail_with = "adapter already initialized")]
unconstrained fn test_initialize_l2_purchase_adapter_rejects_reinit() {
    let (mut env, registry, admin, _, adapter, _) = setup();
    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
}

#[test]
unconstrained fn test_credit_from_l2_payment_adapter_path_succeeds() {
    let (mut env, registry, admin, sponsor, adapter, _) = setup();
    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
    env.call_public(
        adapter,
        MagnaCompanyRightsRegistry::at(registry).credit_from_l2_payment(sponsor, 3, 0, 1),
    );
}

#[test(should_fail_with = "adapter only")]
unconstrained fn test_credit_from_l2_payment_requires_adapter() {
    let (mut env, registry, admin, sponsor, adapter, attacker) = setup();
    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
    env.call_public(
        attacker,
        MagnaCompanyRightsRegistry::at(registry).credit_from_l2_payment(sponsor, 3, 0, 1),
    );
}

#[test(should_fail_with = "insufficient verify rights")]
unconstrained fn test_consume_right_reverts_when_exhausted() {
    let (mut env, registry, _, sponsor, _, _) = setup();
    env.call_public(
        sponsor,
        MagnaCompanyRightsRegistry::at(registry).consume_right(1),
    );
}

#[test]
unconstrained fn test_consume_right_succeeds_after_credit() {
    let (mut env, registry, admin, sponsor, adapter, _) = setup();
    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
    env.call_public(
        adapter,
        MagnaCompanyRightsRegistry::at(registry).credit_from_l2_payment(sponsor, 2, 0, 9),
    );
    env.call_public(
        sponsor,
        MagnaCompanyRightsRegistry::at(registry).consume_right(1),
    );
}

#[test]
unconstrained fn test_rights_balances_are_isolated_per_sponsor_address() {
    let (mut env, registry, admin, sponsor_a, adapter, _) = setup();
    let sponsor_b = env.create_light_account();
    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(registry).initialize_l2_purchase_adapter(adapter),
    );
    env.call_public(
        adapter,
        MagnaCompanyRightsRegistry::at(registry).credit_from_l2_payment(sponsor_a, 4, 0, 100),
    );
    env.call_public(
        adapter,
        MagnaCompanyRightsRegistry::at(registry).credit_from_l2_payment(sponsor_b, 7, 0, 101),
    );
    env.call_public(
        sponsor_a,
        MagnaCompanyRightsRegistry::at(registry).consume_right(1),
    );

    let sponsor_a_remaining = env.view_public(
        MagnaCompanyRightsRegistry::at(registry).get_remaining_verifies(sponsor_a),
    );
    let sponsor_a_consumed = env.view_public(
        MagnaCompanyRightsRegistry::at(registry).get_consumed_verifies(sponsor_a),
    );
    let sponsor_b_remaining = env.view_public(
        MagnaCompanyRightsRegistry::at(registry).get_remaining_verifies(sponsor_b),
    );
    let sponsor_b_consumed = env.view_public(
        MagnaCompanyRightsRegistry::at(registry).get_consumed_verifies(sponsor_b),
    );
    assert(sponsor_a_remaining == 3, "sponsor A remaining mismatch");
    assert(sponsor_a_consumed == 1, "sponsor A consumed mismatch");
    assert(sponsor_b_remaining == 7, "sponsor B remaining mismatch");
    assert(sponsor_b_consumed == 0, "sponsor B consumed mismatch");
}

#[test(should_fail_with = "portal must be non-zero")]
unconstrained fn test_constructor_requires_non_zero_portal() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let initializer = MagnaCompanyRightsRegistry::interface().constructor(EthAddress::zero(), admin);
    let _registry = env
        .deploy("MagnaCompanyRightsRegistry")
        .with_public_initializer(admin, initializer);
}
