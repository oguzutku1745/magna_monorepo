use crate::base64url::base64url_encode_32;

fn assert_bytes_at<let H: u32, let N: u32>(
    haystack: BoundedVec<u8, H>,
    needle: [u8; N],
    index: u32,
) {
    assert(index + N <= haystack.len(), "substring out of range");
    for i in 0..N {
        assert(haystack.get(index + i) == needle[i], "substring mismatch");
    }
}

/// WebAuthn L3 section 5.8.1.1 mandates clientDataJSON serialization to begin with
/// type then challenge. For webauthn.get the first 36 bytes are exactly the
/// prefix below, the 43 base64url challenge chars sit at index 36, and the
/// closing quote at index 79.
pub fn assert_type_and_challenge<let CDJ_MAX: u32>(
    client_data_json: BoundedVec<u8, CDJ_MAX>,
    expected_challenge: [u8; 32],
) {
    let prefix = "{\"type\":\"webauthn.get\",\"challenge\":\"".as_bytes(); // [u8; 36]
    assert_bytes_at(client_data_json, prefix, 0);
    let challenge_b64 = base64url_encode_32(expected_challenge); // [u8; 43]
    assert_bytes_at(client_data_json, challenge_b64, 36);
    assert(client_data_json.get(79) == 34, "challenge not terminated"); // '"'
}

/// Asserts `"origin":"<expected>"` at the prover-supplied index. The closing
/// quote check defeats prefix attacks; the signed JSON defeats injection.
pub fn assert_origin_at<let CDJ_MAX: u32, let ORIGIN_MAX: u32>(
    client_data_json: BoundedVec<u8, CDJ_MAX>,
    origin_index: u32,
    expected_origin: [u8; ORIGIN_MAX],
    expected_origin_len: u32,
) {
    assert(expected_origin_len <= ORIGIN_MAX, "origin length out of range");
    let key = "\"origin\":\"".as_bytes(); // [u8; 10]
    assert_bytes_at(client_data_json, key, origin_index);
    for i in 0..ORIGIN_MAX {
        if (i as u32) < expected_origin_len {
            assert(
                client_data_json.get(origin_index + 10 + i) == expected_origin[i],
                "origin mismatch",
            );
        }
    }
    assert(
        client_data_json.get(origin_index + 10 + expected_origin_len) == 34,
        "origin not terminated",
    );
}

/// Sound absence-or-false check: scans the whole buffer and asserts the exact
/// bytes `"crossOrigin":true` appear nowhere. Bytes beyond len() are zero in
/// storage() and cannot match. Browsers may legitimately omit crossOrigin.
pub fn assert_no_cross_origin_true<let CDJ_MAX: u32>(client_data_json: BoundedVec<u8, CDJ_MAX>) {
    let needle = "\"crossOrigin\":true".as_bytes(); // [u8; 18]
    let storage = client_data_json.storage();
    for start in 0..(CDJ_MAX - 18 + 1) {
        let mut matches = true;
        for i in 0..18 {
            if storage[start + i] != needle[i] {
                matches = false;
            }
        }
        assert(!matches, "crossOrigin:true is not allowed");
    }
}

/// rpIdHash is the first 32 bytes of authenticatorData (WebAuthn L3 section 6.1).
pub fn assert_rp_id_hash<let AD_MAX: u32>(
    authenticator_data: BoundedVec<u8, AD_MAX>,
    expected_rp_id_hash: [u8; 32],
) {
    assert(authenticator_data.len() >= 37, "authenticator data too short");
    for i in 0..32 {
        assert(authenticator_data.get(i) == expected_rp_id_hash[i], "rpIdHash mismatch");
    }
}

/// Flags byte is authenticatorData[32]: bit 0 = UP, bit 2 = UV. Both required.
pub fn assert_authenticator_flags<let AD_MAX: u32>(authenticator_data: BoundedVec<u8, AD_MAX>) {
    assert(authenticator_data.len() >= 37, "authenticator data too short");
    let flags = authenticator_data.get(32);
    assert((flags & 0x01) == 0x01, "user presence (UP) flag missing");
    assert((flags & 0x04) == 0x04, "user verification (UV) flag missing");
}
