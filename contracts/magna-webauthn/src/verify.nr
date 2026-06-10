use crate::envelope::{
    assert_authenticator_flags, assert_no_cross_origin_true, assert_origin_at,
    assert_rp_id_hash, assert_type_and_challenge,
};

/// The signed payload of a WebAuthn assertion is
/// authenticator_data || SHA256(client_data_json), and the ECDSA message hash
/// is the SHA256 of that payload (WebAuthn L3 sections 6.3.3 / 7.2).
pub fn compute_webauthn_message_hash<let AD_MAX: u32, let CDJ_MAX: u32>(
    authenticator_data: BoundedVec<u8, AD_MAX>,
    client_data_json: BoundedVec<u8, CDJ_MAX>,
) -> [u8; 32] {
    let cdj_hash = sha256::sha256_var(client_data_json.storage(), client_data_json.len());
    let mut payload: [u8; AD_MAX + 32] = [0; AD_MAX + 32];
    for i in 0..AD_MAX {
        payload[i] = authenticator_data.storage()[i];
    }
    let ad_len = authenticator_data.len();
    for i in 0..32 {
        payload[ad_len + i] = cdj_hash[i];
    }
    sha256::sha256_var(payload, ad_len + 32)
}


pub struct WebAuthnEnvelope<let CDJ_MAX: u32, let AD_MAX: u32> {
    pub authenticator_data: BoundedVec<u8, AD_MAX>,
    pub client_data_json: BoundedVec<u8, CDJ_MAX>,
    pub signature: [u8; 64],
    pub origin_index: u32,
}

/// Full Magna WebAuthn assertion verification. Envelope checks ASSERT; only
/// the ECDSA result is returned as bool so account contracts can surface it as
/// their validity bit.
pub fn verify_webauthn_get_assertion<let CDJ_MAX: u32, let AD_MAX: u32, let ORIGIN_MAX: u32>(
    envelope: WebAuthnEnvelope<CDJ_MAX, AD_MAX>,
    public_key_x: [u8; 32],
    public_key_y: [u8; 32],
    expected_challenge: [u8; 32],
    expected_rp_id_hash: [u8; 32],
    expected_origin: [u8; ORIGIN_MAX],
    expected_origin_len: u32,
) -> bool {
    assert_type_and_challenge(envelope.client_data_json, expected_challenge);
    assert_origin_at(
        envelope.client_data_json, envelope.origin_index,
        expected_origin, expected_origin_len,
    );
    assert_no_cross_origin_true(envelope.client_data_json);
    assert_rp_id_hash(envelope.authenticator_data, expected_rp_id_hash);
    assert_authenticator_flags(envelope.authenticator_data);

    let message_hash =
        compute_webauthn_message_hash(envelope.authenticator_data, envelope.client_data_json);
    std::ecdsa_secp256r1::verify_signature(
        public_key_x, public_key_y, envelope.signature, message_hash,
    )
}
