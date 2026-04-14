use crate::MagnaRightsPurchaseL2;
use crate::test::setup::setup;
use aztec::{
    protocol::address::AztecAddress,
    test::helpers::authwit::add_public_authwit_from_call,
    test::helpers::test_environment::TestEnvironment,
};
use magna_company_rights_registry::MagnaCompanyRightsRegistry;
use token_contract::Token;

global DEFAULT_PRICE_PER_VERIFY: u128 = 150_000;

#[test]
unconstrained fn test_constructor_sets_expected_getters() {
    let (
        env,
        purchase,
        admin,
        _payer,
        _sponsor,
        treasury,
        payment_token,
        rights_registry,
        _attacker,
    ) = setup(DEFAULT_PRICE_PER_VERIFY);

    let configured_admin = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_admin());
    let configured_treasury = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_treasury());
    let configured_payment_token = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_payment_token());
    let configured_rights_registry = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_rights_registry());
    let configured_price = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_price_per_verify());

    assert(configured_admin == admin, "admin getter mismatch");
    assert(configured_treasury == treasury, "treasury getter mismatch");
    assert(configured_payment_token == payment_token, "payment token getter mismatch");
    assert(configured_rights_registry == rights_registry, "rights registry getter mismatch");
    assert(configured_price == DEFAULT_PRICE_PER_VERIFY, "price getter mismatch");
}

#[test]
unconstrained fn test_next_purchase_id_starts_at_one() {
    let (env, purchase, _, _, _, _, _, _, _) = setup(DEFAULT_PRICE_PER_VERIFY);
    let next_purchase_id = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_next_purchase_id());
    assert(next_purchase_id == 1, "next purchase id should start at one");
}

#[test]
unconstrained fn test_purchase_rights_happy_path_moves_tokens_and_credits_registry() {
    let (
        mut env,
        purchase,
        admin,
        payer,
        sponsor,
        treasury,
        payment_token,
        rights_registry,
        _attacker,
    ) = setup(DEFAULT_PRICE_PER_VERIFY);
    let initial_balance = 2_000_000 as u128;
    let first_rights_amount = 3 as u128;
    let second_rights_amount = 2 as u128;
    let first_package_id = 11 as Field;
    let second_package_id = 22 as Field;
    let first_authwit_nonce = 1 as Field;
    let second_authwit_nonce = 2 as Field;
    let first_payment_amount = first_rights_amount * DEFAULT_PRICE_PER_VERIFY;
    let second_payment_amount = second_rights_amount * DEFAULT_PRICE_PER_VERIFY;

    env.call_public(admin, Token::at(payment_token).mint_to_public(payer, initial_balance));

    let first_transfer_call = Token::at(payment_token).transfer_in_public(
        payer,
        treasury,
        first_payment_amount,
        first_authwit_nonce,
    );
    add_public_authwit_from_call(env, payer, purchase, first_transfer_call);

    let first_purchase_id = env.call_public(
        payer,
        MagnaRightsPurchaseL2::at(purchase).purchase_rights_public(
            sponsor,
            first_rights_amount,
            first_package_id,
            first_authwit_nonce,
        ),
    );
    assert(first_purchase_id == 1, "first purchase id mismatch");

    let second_transfer_call = Token::at(payment_token).transfer_in_public(
        payer,
        treasury,
        second_payment_amount,
        second_authwit_nonce,
    );
    add_public_authwit_from_call(env, payer, purchase, second_transfer_call);

    let second_purchase_id = env.call_public(
        payer,
        MagnaRightsPurchaseL2::at(purchase).purchase_rights_public(
            sponsor,
            second_rights_amount,
            second_package_id,
            second_authwit_nonce,
        ),
    );
    assert(second_purchase_id == 2, "second purchase id mismatch");

    let payer_balance = env.view_public(Token::at(payment_token).balance_of_public(payer));
    let treasury_balance = env.view_public(Token::at(payment_token).balance_of_public(treasury));
    let remaining_verifies = env.view_public(
        MagnaCompanyRightsRegistry::at(rights_registry).get_remaining_verifies(sponsor),
    );
    let last_credit_nonce = env.view_public(
        MagnaCompanyRightsRegistry::at(rights_registry).get_last_credit_nonce(sponsor),
    );
    let package_id = env.view_public(MagnaCompanyRightsRegistry::at(rights_registry).get_package_id(sponsor));
    let next_purchase_id = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_next_purchase_id());

    assert(
        payer_balance == initial_balance - first_payment_amount - second_payment_amount,
        "payer public balance mismatch",
    );
    assert(
        treasury_balance == first_payment_amount + second_payment_amount,
        "treasury public balance mismatch",
    );
    assert(
        remaining_verifies == first_rights_amount + second_rights_amount,
        "registry rights balance mismatch",
    );
    assert(last_credit_nonce == 2 as Field, "registry credit nonce mismatch");
    assert(package_id == second_package_id, "registry package id mismatch");
    assert(next_purchase_id == 3, "next purchase id should advance after happy-path purchases");
}

#[test]
unconstrained fn test_purchase_rights_tracks_balances_per_sponsor() {
    let (
        mut env,
        purchase,
        admin,
        payer,
        sponsor_a,
        treasury,
        payment_token,
        rights_registry,
        sponsor_b,
    ) = setup(DEFAULT_PRICE_PER_VERIFY);
    let initial_balance = 3_000_000 as u128;
    let rights_for_a = 2 as u128;
    let rights_for_b = 5 as u128;
    let nonce_a = 11 as Field;
    let nonce_b = 22 as Field;
    let payment_for_a = rights_for_a * DEFAULT_PRICE_PER_VERIFY;
    let payment_for_b = rights_for_b * DEFAULT_PRICE_PER_VERIFY;

    env.call_public(admin, Token::at(payment_token).mint_to_public(payer, initial_balance));

    let transfer_for_a = Token::at(payment_token).transfer_in_public(
        payer,
        treasury,
        payment_for_a,
        nonce_a,
    );
    add_public_authwit_from_call(env, payer, purchase, transfer_for_a);
    env.call_public(
        payer,
        MagnaRightsPurchaseL2::at(purchase).purchase_rights_public(
            sponsor_a,
            rights_for_a,
            100 as Field,
            nonce_a,
        ),
    );

    let transfer_for_b = Token::at(payment_token).transfer_in_public(
        payer,
        treasury,
        payment_for_b,
        nonce_b,
    );
    add_public_authwit_from_call(env, payer, purchase, transfer_for_b);
    env.call_public(
        payer,
        MagnaRightsPurchaseL2::at(purchase).purchase_rights_public(
            sponsor_b,
            rights_for_b,
            200 as Field,
            nonce_b,
        ),
    );

    let sponsor_a_remaining = env.view_public(
        MagnaCompanyRightsRegistry::at(rights_registry).get_remaining_verifies(sponsor_a),
    );
    let sponsor_b_remaining = env.view_public(
        MagnaCompanyRightsRegistry::at(rights_registry).get_remaining_verifies(sponsor_b),
    );
    let next_purchase_id = env.view_public(MagnaRightsPurchaseL2::at(purchase).get_next_purchase_id());

    assert(sponsor_a_remaining == rights_for_a, "sponsor A rights mismatch");
    assert(sponsor_b_remaining == rights_for_b, "sponsor B rights mismatch");
    assert(next_purchase_id == 3, "next purchase id should increment across both sponsors");
}

#[test(should_fail_with = "admin must be non-zero")]
unconstrained fn test_constructor_requires_non_zero_admin() {
    let mut env = TestEnvironment::new();
    let treasury = env.create_light_account();
    let payment_token = env.create_light_account();
    let rights_registry = env.create_light_account();
    let initializer = MagnaRightsPurchaseL2::interface().constructor(
        AztecAddress::zero(),
        treasury,
        payment_token,
        rights_registry,
        DEFAULT_PRICE_PER_VERIFY,
    );
    let _purchase = env
        .deploy("MagnaRightsPurchaseL2")
        .with_public_initializer(treasury, initializer);
}

#[test(should_fail_with = "treasury must be non-zero")]
unconstrained fn test_constructor_requires_non_zero_treasury() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let payment_token = env.create_light_account();
    let rights_registry = env.create_light_account();
    let initializer = MagnaRightsPurchaseL2::interface().constructor(
        admin,
        AztecAddress::zero(),
        payment_token,
        rights_registry,
        DEFAULT_PRICE_PER_VERIFY,
    );
    let _purchase = env
        .deploy("MagnaRightsPurchaseL2")
        .with_public_initializer(admin, initializer);
}

#[test(should_fail_with = "payment token must be non-zero")]
unconstrained fn test_constructor_requires_non_zero_payment_token() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let treasury = env.create_light_account();
    let rights_registry = env.create_light_account();
    let initializer = MagnaRightsPurchaseL2::interface().constructor(
        admin,
        treasury,
        AztecAddress::zero(),
        rights_registry,
        DEFAULT_PRICE_PER_VERIFY,
    );
    let _purchase = env
        .deploy("MagnaRightsPurchaseL2")
        .with_public_initializer(admin, initializer);
}

#[test(should_fail_with = "rights registry must be non-zero")]
unconstrained fn test_constructor_requires_non_zero_rights_registry() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let treasury = env.create_light_account();
    let payment_token = env.create_light_account();
    let initializer = MagnaRightsPurchaseL2::interface().constructor(
        admin,
        treasury,
        payment_token,
        AztecAddress::zero(),
        DEFAULT_PRICE_PER_VERIFY,
    );
    let _purchase = env
        .deploy("MagnaRightsPurchaseL2")
        .with_public_initializer(admin, initializer);
}

#[test(should_fail_with = "price per verify must be non-zero")]
unconstrained fn test_constructor_requires_non_zero_price() {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let treasury = env.create_light_account();
    let payment_token = env.create_light_account();
    let rights_registry = env.create_light_account();
    let initializer = MagnaRightsPurchaseL2::interface().constructor(
        admin,
        treasury,
        payment_token,
        rights_registry,
        0,
    );
    let _purchase = env
        .deploy("MagnaRightsPurchaseL2")
        .with_public_initializer(admin, initializer);
}

#[test(should_fail_with = "sponsor must be non-zero")]
unconstrained fn test_purchase_rights_requires_non_zero_sponsor() {
    let (mut env, purchase, _, payer, _, _, _, _, _) = setup(DEFAULT_PRICE_PER_VERIFY);
    let _ = env.call_public(
        payer,
        MagnaRightsPurchaseL2::at(purchase).purchase_rights_public(
            AztecAddress::zero(),
            1 as u128,
            0 as Field,
            1 as Field,
        ),
    );
}

#[test(should_fail_with = "rights amount must be non-zero")]
unconstrained fn test_purchase_rights_requires_non_zero_amount() {
    let (mut env, purchase, _, payer, sponsor, _, _, _, _) = setup(DEFAULT_PRICE_PER_VERIFY);
    let _ = env.call_public(
        payer,
        MagnaRightsPurchaseL2::at(purchase).purchase_rights_public(
            sponsor,
            0,
            0 as Field,
            1 as Field,
        ),
    );
}

#[test(should_fail)]
unconstrained fn test_purchase_rights_reverts_on_payment_overflow() {
    let max_u128 = 340282366920938463463374607431768211455 as u128;
    let (mut env, purchase, _, payer, sponsor, _, _, _, _) = setup(max_u128);
    let _ = env.call_public(
        payer,
        MagnaRightsPurchaseL2::at(purchase).purchase_rights_public(
            sponsor,
            2 as u128,
            0 as Field,
            1 as Field,
        ),
    );
}
