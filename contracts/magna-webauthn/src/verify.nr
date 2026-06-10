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
