use crate::MagnaIssuer;
use crate::internal::constants::MAGNA_SPONSOR_GATEWAY_DELAY_SECONDS;
use aztec::{
    protocol::address::{AztecAddress, EthAddress},
    test::helpers::test_environment::TestEnvironment,
};
use magna_verify_meter_hook::MagnaVerifyMeterHook;

pub unconstrained fn setup(
) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let orchestrator = env.create_light_account();
    let active_owner = env.create_light_account();
    let ghost_owner = env.create_light_account();
    let attacker = env.create_light_account();

    let initializer = MagnaIssuer::interface().constructor(orchestrator, AztecAddress::zero());
    let contract_address = env.deploy("MagnaIssuer").with_public_initializer(orchestrator, initializer);
    env.call_public(
        orchestrator,
        MagnaIssuer::at(contract_address).initialize_recovery_portal(EthAddress::from_field(0xdead)),
    );
    env.call_public(
        orchestrator,
        MagnaIssuer::at(contract_address).add_company_sponsor_gateway(attacker),
    );
    env.advance_next_block_timestamp_by(MAGNA_SPONSOR_GATEWAY_DELAY_SECONDS);
    env.mine_block();

    (env, contract_address, orchestrator, active_owner, ghost_owner, attacker)
}

pub unconstrained fn setup_sponsored(
) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let orchestrator = env.create_light_account();
    let active_owner = env.create_light_account();
    let ghost_owner = env.create_light_account();
    let attacker = env.create_light_account();

    // Deploy the public policy hook first so the issuer can store its address immutably.
    let verify_meter_hook_initializer = MagnaVerifyMeterHook::interface().constructor(orchestrator, 0);
    let verify_meter_hook_address = env
        .deploy("MagnaVerifyMeterHook")
        .with_public_initializer(orchestrator, verify_meter_hook_initializer);

    // Deploy issuer in sponsored mode (verify_meter_hook != 0).
    let issuer_initializer = MagnaIssuer::interface().constructor(orchestrator, verify_meter_hook_address);
    let issuer_address = env
        .deploy("MagnaIssuer")
        .with_public_initializer(orchestrator, issuer_initializer);
    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer_address).initialize_recovery_portal(EthAddress::from_field(0xdead)),
    );
    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer_address).add_company_sponsor_gateway(attacker),
    );
    env.advance_next_block_timestamp_by(MAGNA_SPONSOR_GATEWAY_DELAY_SECONDS);
    env.mine_block();

    // Configure the policy hook to accept calls only from this issuer.
    env.call_public(
        orchestrator,
        MagnaVerifyMeterHook::at(verify_meter_hook_address).set_issuer(issuer_address),
    );

    (env, issuer_address, verify_meter_hook_address, orchestrator, active_owner, ghost_owner, attacker)
}
