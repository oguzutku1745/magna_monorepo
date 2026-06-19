mod public_key_note;
mod test;

use aztec::macros::aztec;

#[aztec]
pub contract MagnaWebAuthnAccount {
    use aztec::{
        authwit::{account::AccountActions, entrypoint::app::AppPayload},
        context::PrivateContext,
        macros::{
            functions::{allow_phase_change, external, initializer, noinitcheck, view},
            storage::storage,
        },
        messages::delivery::MessageDelivery,
        oracle::auth_witness::get_auth_witness,
        state_vars::SinglePrivateImmutable,
    };
    use crate::public_key_note::WebAuthnPublicKeyNote;
    use magna_webauthn::{verify_webauthn_get_assertion, WebAuthnEnvelope};

    global CDJ_MAX: u32 = 256;
    global AD_MAX: u32 = 64;
    // 64 sig + 1 ad_len + 64 ad + 1 cdj_len + 256 cdj + 1 origin_index
    global WEBAUTHN_WITNESS_LEN: u32 = 387;

    #[storage]
    struct Storage {
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
        self.storage.signing_public_key.initialize(note).deliver(
            MessageDelivery::onchain_constrained().with_sender(self.address),
        );
    }

    #[external("private")]
    #[noinitcheck]
    #[allow_phase_change]
    fn entrypoint(app_payload: AppPayload, fee_payment_method: u8, cancellable: bool) {
        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.entrypoint(app_payload, fee_payment_method, cancellable);
    }

    #[external("private")]
    #[noinitcheck]
    #[view]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(self.context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    #[contract_library_method]
    fn is_valid_impl(context: &mut PrivateContext, outer_hash: Field) -> bool {
        let storage = Storage::init(context);
        let key = storage.signing_public_key.get_note();

        // Safety: the witness only supplies data whose integrity is enforced
        // by the envelope checks + ECDSA verification below.
        let witness: [Field; WEBAUTHN_WITNESS_LEN] = unsafe { get_auth_witness(outer_hash) };

        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }

        let ad_len = witness[64] as u32;
        assert(ad_len <= AD_MAX, "authenticator data too long");
        let mut ad_storage: [u8; 64] = [0; 64];
        for i in 0..64 {
            ad_storage[i] = witness[65 + i] as u8;
        }
        for i in 0..64 {
            if (i as u32) >= ad_len {
                assert(ad_storage[i] == 0, "authenticator data padding must be zero");
            }
        }
        let authenticator_data: BoundedVec<u8, 64> = BoundedVec::from_parts(ad_storage, ad_len);

        let cdj_len = witness[129] as u32;
        assert(cdj_len <= CDJ_MAX, "client data json too long");
        let mut cdj_storage: [u8; 256] = [0; 256];
        for i in 0..256 {
            cdj_storage[i] = witness[130 + i] as u8;
        }
        for i in 0..256 {
            if (i as u32) >= cdj_len {
                assert(cdj_storage[i] == 0, "client data padding must be zero");
            }
        }
        let client_data_json: BoundedVec<u8, 256> = BoundedVec::from_parts(cdj_storage, cdj_len);

        let origin_index = witness[386] as u32;

        let envelope = WebAuthnEnvelope {
            authenticator_data,
            client_data_json,
            signature,
            origin_index,
        };

        // The WebAuthn challenge is the big-endian bytes of the authwit outer hash.
        let challenge: [u8; 32] = outer_hash.to_be_bytes();

        verify_webauthn_get_assertion(
            envelope, key.x, key.y, challenge, key.rp_id_hash, key.origin, key.origin_len,
        )
    }
}
