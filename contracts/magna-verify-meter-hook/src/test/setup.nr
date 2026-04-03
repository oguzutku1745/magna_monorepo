use crate::MagnaVerifyMeterHook;
use aztec::{
    protocol::address::AztecAddress,
    test::helpers::test_environment::TestEnvironment,
};

pub unconstrained fn setup(
    initial_allowlist_mask: u64,
) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let caller = env.create_light_account();

    let initializer = MagnaVerifyMeterHook::interface().constructor(admin, initial_allowlist_mask);
    let contract_address = env.deploy("MagnaVerifyMeterHook").with_public_initializer(admin, initializer);

    // For unit tests, treat `caller` as the authorized issuer.
    env.call_public(
        admin,
        MagnaVerifyMeterHook::at(contract_address).set_issuer(caller),
    );

    (env, contract_address, admin, caller)
}
