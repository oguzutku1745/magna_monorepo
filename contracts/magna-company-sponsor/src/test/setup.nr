use crate::MagnaCompanySponsor;
use aztec::{
    protocol::address::AztecAddress,
    test::helpers::test_environment::TestEnvironment,
};
use magna_issuer::MagnaIssuer;

pub unconstrained fn setup(
) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let orchestrator = env.create_light_account();
    let active_owner = env.create_light_account();
    let ghost_owner = env.create_light_account();
    let attacker = env.create_light_account();

    let issuer_initializer = MagnaIssuer::interface().constructor(orchestrator, AztecAddress::zero());
    let issuer_address = env
        .deploy("MagnaIssuer")
        .with_public_initializer(orchestrator, issuer_initializer);

    let sponsor_initializer = MagnaCompanySponsor::interface().constructor(
        orchestrator,
        1_000_000_000 as u128,
    );
    let sponsor_address = env
        .deploy("MagnaCompanySponsor")
        .with_public_initializer(orchestrator, sponsor_initializer);

    env.call_public(
        orchestrator,
        MagnaCompanySponsor::at(sponsor_address).initialize_issuer(issuer_address),
    );
    env.call_public(
        orchestrator,
        MagnaCompanySponsor::at(sponsor_address).initialize_rights_registry(issuer_address),
    );
    env.call_public(
        orchestrator,
        MagnaIssuer::at(issuer_address).initialize_company_sponsor_gateway(sponsor_address),
    );

    (env, sponsor_address, issuer_address, orchestrator, active_owner, ghost_owner, attacker)
}
