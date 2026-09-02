mod test;

use aztec::macros::aztec;

pub(crate) global MAGNA_RIGHTS_CREDIT_DS: u32 = 0x4D475243; // "MGRC"

#[aztec]
pub contract MagnaCompanyRightsRegistry {
    use aztec::{
        macros::{
            functions::{external, initializer, view},
            storage::storage,
        },
        protocol::{
            address::{AztecAddress, EthAddress},
            hash::sha256_to_field,
        },
        state_vars::{Map, PublicImmutable, PublicMutable},
    };

    #[storage]
    struct Storage<Context> {
        admin: PublicImmutable<AztecAddress, Context>,
        portal: PublicImmutable<EthAddress, Context>,
        l2_purchase_adapter: PublicMutable<AztecAddress, Context>,
        remaining_verifies: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        consumed_verifies: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        last_credit_nonce: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        package_id: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(portal: EthAddress, admin: AztecAddress) {
        assert(!portal.is_zero(), "portal must be non-zero");
        assert(admin != AztecAddress::zero(), "admin must be non-zero");
        self.storage.portal.initialize(portal);
        self.storage.admin.initialize(admin);
        self.storage.l2_purchase_adapter.write(AztecAddress::zero());
    }

    #[external("public")]
    fn claim_l1_credit(
        sponsor: AztecAddress,
        rights_amount: u128,
        package_id: Field,
        credit_nonce: Field,
        secret: Field,
        message_leaf_index: Field,
    ) {
        assert(sponsor != AztecAddress::zero(), "sponsor must be non-zero");
        assert(rights_amount > 0, "rights amount must be non-zero");
        let portal = self.storage.portal.read();
        let domain_bytes: [u8; 32] = (crate::MAGNA_RIGHTS_CREDIT_DS as Field).to_be_bytes();
        let sponsor_bytes: [u8; 32] = sponsor.inner.to_be_bytes();
        let rights_amount_bytes: [u8; 32] = (rights_amount as Field).to_be_bytes();
        let package_id_bytes: [u8; 32] = package_id.to_be_bytes();
        let credit_nonce_bytes: [u8; 32] = credit_nonce.to_be_bytes();
        let payload_bytes = domain_bytes
            .concat(sponsor_bytes)
            .concat(rights_amount_bytes)
            .concat(package_id_bytes)
            .concat(credit_nonce_bytes);
        let content_hash = sha256_to_field(payload_bytes);
        self.context.consume_l1_to_l2_message(content_hash, [secret], portal, message_leaf_index);
        let remaining = self.storage.remaining_verifies.at(sponsor).read();
        self.storage.remaining_verifies.at(sponsor).write(remaining + rights_amount);
        self.storage.last_credit_nonce.at(sponsor).write(credit_nonce);
        self.storage.package_id.at(sponsor).write(package_id);
    }

    #[external("public")]
    fn consume_right(amount: u128) {
        assert(amount > 0, "amount must be non-zero");
        let sponsor = self.msg_sender();
        assert(sponsor != AztecAddress::zero(), "sponsor must be non-zero");
        let remaining = self.storage.remaining_verifies.at(sponsor).read();
        assert(remaining >= amount, "insufficient verify rights");
        self.storage.remaining_verifies.at(sponsor).write(remaining - amount);
        let consumed = self.storage.consumed_verifies.at(sponsor).read();
        self.storage.consumed_verifies.at(sponsor).write(consumed + amount);
    }

    #[external("public")]
    fn initialize_l2_purchase_adapter(adapter: AztecAddress) {
        assert(self.msg_sender() == self.storage.admin.read(), "admin only");
        assert(adapter != AztecAddress::zero(), "adapter must be non-zero");
        assert(
            self.storage.l2_purchase_adapter.read() == AztecAddress::zero(),
            "adapter already initialized",
        );
        self.storage.l2_purchase_adapter.write(adapter);
    }

    #[external("public")]
    fn credit_from_l2_payment(
        sponsor: AztecAddress,
        rights_amount: u128,
        package_id: Field,
        credit_nonce: Field,
    ) {
        let adapter = self.storage.l2_purchase_adapter.read();
        assert(adapter != AztecAddress::zero(), "adapter not initialized");
        assert(self.msg_sender() == adapter, "adapter only");
        assert(sponsor != AztecAddress::zero(), "sponsor must be non-zero");
        assert(rights_amount > 0, "rights amount must be non-zero");
        let remaining = self.storage.remaining_verifies.at(sponsor).read();
        self.storage.remaining_verifies.at(sponsor).write(remaining + rights_amount);
        self.storage.last_credit_nonce.at(sponsor).write(credit_nonce);
        self.storage.package_id.at(sponsor).write(package_id);
    }

    #[external("public")]
    #[view]
    fn get_admin() -> AztecAddress {
        self.storage.admin.read()
    }

    #[external("public")]
    #[view]
    fn get_portal() -> EthAddress {
        self.storage.portal.read()
    }

    #[external("public")]
    #[view]
    fn get_l2_purchase_adapter() -> AztecAddress {
        self.storage.l2_purchase_adapter.read()
    }

    #[external("public")]
    #[view]
    fn get_remaining_verifies(sponsor: AztecAddress) -> u128 {
        self.storage.remaining_verifies.at(sponsor).read()
    }

    #[external("public")]
    #[view]
    fn get_consumed_verifies(sponsor: AztecAddress) -> u128 {
        self.storage.consumed_verifies.at(sponsor).read()
    }

    #[external("public")]
    #[view]
    fn get_last_credit_nonce(sponsor: AztecAddress) -> Field {
        self.storage.last_credit_nonce.at(sponsor).read()
    }

    #[external("public")]
    #[view]
    fn get_package_id(sponsor: AztecAddress) -> Field {
        self.storage.package_id.at(sponsor).read()
    }

    #[external("public")]
    #[view]
    fn get_company_rights(sponsor: AztecAddress) -> (u128, u128, Field, Field) {
        (
            self.storage.remaining_verifies.at(sponsor).read(),
            self.storage.consumed_verifies.at(sponsor).read(),
            self.storage.last_credit_nonce.at(sponsor).read(),
            self.storage.package_id.at(sponsor).read(),
        )
    }

}
