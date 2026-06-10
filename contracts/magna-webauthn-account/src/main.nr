mod public_key_note;

use aztec::macros::aztec;

#[aztec]
pub contract MagnaWebAuthnAccount {
    use aztec::{
        macros::{functions::{external, initializer}, storage::storage},
        messages::message_delivery::MessageDelivery,
        oracle::notes::{get_sender_for_tags, set_sender_for_tags},
        state_vars::SinglePrivateImmutable,
    };
    use crate::public_key_note::WebAuthnPublicKeyNote;

    #[storage]
    struct Storage<Context> {
        signing_public_key: SinglePrivateImmutable<WebAuthnPublicKeyNote, Context>,
    }

    #[external("private")]
    #[initializer]
    fn constructor(
        signing_pub_key_x: [u8; 32],
        signing_pub_key_y: [u8; 32],
        rp_id_hash: [u8; 32],
        origin: [u8; 64],
        origin_len: u32,
    ) {
        let note = WebAuthnPublicKeyNote {
            x: signing_pub_key_x,
            y: signing_pub_key_y,
            rp_id_hash,
            origin,
            origin_len,
        };
        // Mirror ecdsa_r_account_contract's sender-for-tags dance so the user's
        // PXE finds the note without registering the deployer as a sender.
        // Safety: The sender for tags is only used to compute unconstrained shared secrets for emitting logs.
        let original_sender = unsafe { get_sender_for_tags().unwrap_or(self.address) };
        // Safety: Comment from above applies here as well.
        unsafe { set_sender_for_tags(self.address) };
        self.storage.signing_public_key.initialize(note).deliver(
            MessageDelivery.ONCHAIN_CONSTRAINED,
        );
        // Safety: Comment from above applies here as well.
        unsafe { set_sender_for_tags(original_sender) };
    }
}
