mod test;

use aztec::macros::aztec;

#[aztec]
pub contract MagnaRightsPurchaseL2 {
    use aztec::{
        macros::{
            functions::{external, initializer, view},
            storage::storage,
        },
        protocol::address::AztecAddress,
        state_vars::{PublicImmutable, PublicMutable},
    };
    use magna_company_rights_registry::MagnaCompanyRightsRegistry;
    use token_contract::Token;

    #[storage]
    struct Storage {
        admin: PublicImmutable<AztecAddress, Context>,
        treasury: PublicImmutable<AztecAddress, Context>,
        payment_token: PublicImmutable<AztecAddress, Context>,
        rights_registry: PublicImmutable<AztecAddress, Context>,
        price_per_verify: PublicImmutable<u128, Context>,
        next_purchase_id: PublicMutable<u128, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(
        admin: AztecAddress,
        treasury: AztecAddress,
        payment_token: AztecAddress,
        rights_registry: AztecAddress,
        price_per_verify: u128,
    ) {
        assert(admin != AztecAddress::zero(), "admin must be non-zero");
        assert(treasury != AztecAddress::zero(), "treasury must be non-zero");
        assert(payment_token != AztecAddress::zero(), "payment token must be non-zero");
        assert(rights_registry != AztecAddress::zero(), "rights registry must be non-zero");
        assert(price_per_verify > 0, "price per verify must be non-zero");

        self.storage.admin.initialize(admin);
        self.storage.treasury.initialize(treasury);
        self.storage.payment_token.initialize(payment_token);
        self.storage.rights_registry.initialize(rights_registry);
        self.storage.price_per_verify.initialize(price_per_verify);
        self.storage.next_purchase_id.write(1);
    }

    #[external("public")]
    fn purchase_rights_public(
        sponsor: AztecAddress,
        rights_amount: u128,
        package_id: Field,
        authwit_nonce: Field,
    ) -> u128 {
        assert(sponsor != AztecAddress::zero(), "sponsor must be non-zero");
        assert(rights_amount > 0, "rights amount must be non-zero");

        let purchase_id = self.storage.next_purchase_id.read();
        self.storage.next_purchase_id.write(purchase_id + 1);

        let payer = self.msg_sender();
        let treasury = self.storage.treasury.read();
        let payment_token = self.storage.payment_token.read();
        let price_per_verify = self.storage.price_per_verify.read();
        let payment_amount = rights_amount * price_per_verify;
        assert(payment_amount / rights_amount == price_per_verify, "payment overflow");

        Token::at(payment_token)
            .transfer_in_public(payer, treasury, payment_amount, authwit_nonce)
            .call(self.context);

        MagnaCompanyRightsRegistry::at(self.storage.rights_registry.read())
            .credit_from_l2_payment(sponsor, rights_amount, package_id, purchase_id as Field)
            .call(self.context);

        purchase_id
    }

    #[external("public")]
    #[view]
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    #[view]
    fn get_treasury() -> AztecAddress {
        self.storage.treasury.read()
    }

    #[external("public")]
    #[view]
    fn get_payment_token() -> AztecAddress {
        self.storage.payment_token.read()
    }

    #[external("public")]
    #[view]
    fn get_rights_registry() -> AztecAddress {
        self.storage.rights_registry.read()
    }

    #[external("public")]
    #[view]
    fn get_price_per_verify() -> u128 {
        self.storage.price_per_verify.read()
    }

    #[external("public")]
    #[view]
    fn get_next_purchase_id() -> u128 {
        self.storage.next_purchase_id.read()
    }
}
