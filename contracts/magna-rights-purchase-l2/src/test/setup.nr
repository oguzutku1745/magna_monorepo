use crate::MagnaRightsPurchaseL2;
use aztec::{
    protocol::address::{AztecAddress, EthAddress},
    test::helpers::test_environment::TestEnvironment,
};
use magna_company_rights_registry::MagnaCompanyRightsRegistry;
use token_contract::Token;

pub unconstrained fn setup(
    price_per_verify: u128,
) -> (
    TestEnvironment,
    AztecAddress,
    AztecAddress,
    AztecAddress,
    AztecAddress,
    AztecAddress,
    AztecAddress,
    AztecAddress,
    AztecAddress,
) {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let payer = env.create_contract_account();
    let sponsor = env.create_light_account();
    let treasury = env.create_light_account();
    let attacker = env.create_light_account();
    let portal = EthAddress::from_field(1);

    let payment_token_initializer = Token::interface().constructor(
        admin,
        "TestToken0000000000000000000000",
        "TT00000000000000000000000000000",
        6,
    );
    let payment_token = env
        .deploy("@token_contract/Token")
        .with_public_initializer(admin, payment_token_initializer);

    let rights_registry_initializer = MagnaCompanyRightsRegistry::interface().constructor(portal, admin);
    let rights_registry = env
        .deploy("@magna_company_rights_registry/MagnaCompanyRightsRegistry")
        .with_public_initializer(admin, rights_registry_initializer);

    let initializer = MagnaRightsPurchaseL2::interface().constructor(
        admin,
        treasury,
        payment_token,
        rights_registry,
        price_per_verify,
    );
    let purchase = env
        .deploy("MagnaRightsPurchaseL2")
        .with_public_initializer(admin, initializer);

    env.call_public(
        admin,
        MagnaCompanyRightsRegistry::at(rights_registry).initialize_l2_purchase_adapter(purchase),
    );

    (
        env,
        purchase,
        admin,
        payer,
        sponsor,
        treasury,
        payment_token,
        rights_registry,
        attacker,
    )
}
