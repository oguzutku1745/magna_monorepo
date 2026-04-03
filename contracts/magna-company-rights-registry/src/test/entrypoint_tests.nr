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

#[test(should_fail_with = "portal must be non-zero")]
unconstrained fn test_constructor_requires_non_zero_portal() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let initializer = MagnaCompanyRightsRegistry::interface().constructor(EthAddress::zero(), admin);
    let _registry = env
        .deploy("MagnaCompanyRightsRegistry")
        .with_public_initializer(admin, initializer);
}
