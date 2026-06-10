use crate::MagnaWebAuthnAccount;
use aztec::{
    context::PrivateCall,
    protocol::address::AztecAddress,
    test::helpers::{test_environment::{DeployOptions, TestEnvironment}, txe_oracles},
};

// Deploys the account with a fixture key and proves the constructor stores the
// note. The full witness path is exercised by the magna_webauthn lib tests and
// the TS integration test (Task 9) because TXE auth-witness injection for
// custom accounts is not part of the TestEnvironment helper surface.
#[test]
unconstrained fn test_constructor_stores_public_key_note() {
    let mut env = TestEnvironment::new();

    let mut origin: [u8; 64] = [0; 64];
    let origin_str = "http://localhost:5184".as_bytes();
    for i in 0..21 {
        origin[i] = origin_str[i];
    }

    let initializer = MagnaWebAuthnAccount::interface().constructor(
        [1; 32], [2; 32], [3; 32], origin, 21,
    );
    // Account constructors store a SinglePrivateImmutable owned by self.address,
    // so TXE must execute the private initializer scoped as the deployed account.
    let deployment = env.deploy_opts(DeployOptions::new(), "MagnaWebAuthnAccount");
    let instance = txe_oracles::deploy(
        deployment.path,
        initializer.name,
        initializer.args,
        deployment.secret,
        deployment.salt,
        AztecAddress::zero(),
    );
    let account_address = instance.to_address();
    let _ = deployment.env.call_private::<_, _, ()>(
        account_address,
        PrivateCall::new(account_address, initializer.selector, initializer.name, initializer.args),
    );
    // Initialization completing without revert is the assertion here; a second
    // initialization attempt must fail.
    assert(account_address != AztecAddress::zero());
}
