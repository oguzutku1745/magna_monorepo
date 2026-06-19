use crate::MagnaIssuer;
use crate::internal::constants::{
    MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS,
    MAGNA_SPONSOR_GATEWAY_DELAY_SECONDS,
    MAGNA_SPONSOR_POLICY_DELAY_SECONDS,
};
use crate::test::setup::setup;

#[test]
unconstrained fn test_gateway_private_read_delays_cover_browser_proving_latency() {
    assert(MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS >= MAGNA_SPONSOR_POLICY_DELAY_SECONDS);
    assert(MAGNA_SPONSOR_GATEWAY_DELAY_SECONDS >= MAGNA_SPONSOR_POLICY_DELAY_SECONDS);
}

#[test]
unconstrained fn test_add_consumer_gateway_allows_gateway() {
    let (mut env, contract_address, orchestrator, _, _, _) = setup();
    let gateway = env.create_light_account();
    env.call_public(
        orchestrator,
        MagnaIssuer::at(contract_address).add_consumer_gateway(gateway),
    );
    env.advance_next_block_timestamp_by(MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS);
    env.mine_block();
    let allowed = env.view_public(
        MagnaIssuer::at(contract_address).is_consumer_gateway(gateway),
    );
    assert(allowed);
}

#[test]
unconstrained fn test_multiple_consumer_gateways_coexist() {
    let (mut env, contract_address, orchestrator, _, _, _) = setup();
    let gateway_a = env.create_light_account();
    let gateway_b = env.create_light_account();
    env.call_public(orchestrator, MagnaIssuer::at(contract_address).add_consumer_gateway(gateway_a));
    env.call_public(orchestrator, MagnaIssuer::at(contract_address).add_consumer_gateway(gateway_b));
    env.advance_next_block_timestamp_by(MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS);
    env.mine_block();
    assert(env.view_public(MagnaIssuer::at(contract_address).is_consumer_gateway(gateway_a)));
    assert(env.view_public(MagnaIssuer::at(contract_address).is_consumer_gateway(gateway_b)));
}

#[test]
unconstrained fn test_unregistered_gateway_is_not_allowed() {
    let (mut env, contract_address, _, _, _, attacker) = setup();
    let allowed = env.view_public(
        MagnaIssuer::at(contract_address).is_consumer_gateway(attacker),
    );
    assert(!allowed);
}

#[test]
unconstrained fn test_remove_consumer_gateway_disables_after_delay() {
    let (mut env, contract_address, orchestrator, _, _, _) = setup();
    let gateway = env.create_light_account();
    env.call_public(orchestrator, MagnaIssuer::at(contract_address).add_consumer_gateway(gateway));
    env.advance_next_block_timestamp_by(MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS);
    env.mine_block();
    env.call_public(orchestrator, MagnaIssuer::at(contract_address).remove_consumer_gateway(gateway));
    assert(env.view_public(MagnaIssuer::at(contract_address).is_consumer_gateway(gateway)));
    env.advance_next_block_timestamp_by(MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS);
    env.mine_block();
    assert(!env.view_public(MagnaIssuer::at(contract_address).is_consumer_gateway(gateway)));
}

#[test]
unconstrained fn test_remove_consumer_gateway_cancels_pending_add() {
    let (mut env, contract_address, orchestrator, _, _, _) = setup();
    let gateway = env.create_light_account();
    env.call_public(orchestrator, MagnaIssuer::at(contract_address).add_consumer_gateway(gateway));
    env.call_public(orchestrator, MagnaIssuer::at(contract_address).remove_consumer_gateway(gateway));
    env.advance_next_block_timestamp_by(MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS);
    env.mine_block();
    assert(!env.view_public(MagnaIssuer::at(contract_address).is_consumer_gateway(gateway)));
}

#[test(should_fail_with = "orchestrator required")]
unconstrained fn test_attacker_cannot_add_consumer_gateway() {
    let (mut env, contract_address, _, _, _, attacker) = setup();
    let gateway = env.create_light_account();
    env.call_public(attacker, MagnaIssuer::at(contract_address).add_consumer_gateway(gateway));
}
