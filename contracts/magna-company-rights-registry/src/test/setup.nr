use crate::MagnaCompanyRightsRegistry;
use aztec::{
    protocol::address::{AztecAddress, EthAddress},
    test::helpers::test_environment::TestEnvironment,
};

pub unconstrained fn setup(
) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let sponsor = env.create_light_account();
    let adapter = env.create_light_account();
    let attacker = env.create_light_account();
    let portal = EthAddress::from_field(1);

    let initializer = MagnaCompanyRightsRegistry::interface().constructor(portal, admin);
    let registry = env
        .deploy("MagnaCompanyRightsRegistry")
        .with_public_initializer(admin, initializer);

    (env, registry, admin, sponsor, adapter, attacker)
}
