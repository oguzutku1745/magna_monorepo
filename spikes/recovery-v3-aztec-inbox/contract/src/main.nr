use aztec::macros::aztec;

#[aztec]
pub contract RecoveryInboxConsumer {
    use aztec::{
        macros::{
            functions::{external, initializer},
            storage::storage,
        },
        protocol::address::EthAddress,
        state_vars::PublicImmutable,
    };

    #[storage]
    struct Storage<Context> {
        portal: PublicImmutable<EthAddress, Context>,
    }

    #[external("public")]
    #[initializer]
    fn constructor(portal: EthAddress) {
        assert(!portal.is_zero(), "portal must be non-zero");
        self.storage.portal.initialize(portal);
    }

    #[external("private")]
    fn consume_recovery_authorization(
        recovery_authorization: Field,
        message_secret: Field,
        message_leaf_index: Field,
    ) {
        let portal_address = self.storage.portal.read();
        self.context.consume_l1_to_l2_message(
            recovery_authorization,
            [message_secret],
            portal_address,
            message_leaf_index,
        );
    }
}
