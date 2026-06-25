use crate::MagnaIssuer;
use crate::test::setup::setup;

#[test]
unconstrained fn test_orchestrator_can_register_credential() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(
            active_owner,
            ghost_owner,
            123 as Field,
            1,
            1_893_456_000,
        ),
    );
}

#[test]
unconstrained fn test_orchestrator_can_register_credential_v2() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential_v2(
            active_owner,
            ghost_owner,
            123 as Field,
            1,
            1_893_456_000,
        ),
    );
}

#[test(should_fail_with = "orchestrator required")]
unconstrained fn test_non_orchestrator_cannot_register_credential() {
    let (mut env, contract_address, _, active_owner, ghost_owner, attacker) = setup();

    env.call_private(
        attacker,
        MagnaIssuer::at(contract_address).register_credential(
            active_owner,
            ghost_owner,
            123 as Field,
            1,
            1_893_456_000,
        ),
    );
}

#[test]
unconstrained fn test_orchestrator_can_register_rooted_passport_v2() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_rooted_passport_v2(
            active_owner,
            ghost_owner,
            777 as Field,
            123 as Field,
            1_893_456_000,
        ),
    );
}
