use crate::base64url::base64url_encode_32;
use crate::verify::compute_webauthn_message_hash;
use crate::{verify_webauthn_get_assertion, WebAuthnEnvelope};
use crate::envelope::{
    assert_authenticator_flags, assert_no_cross_origin_true, assert_origin_at,
    assert_rp_id_hash, assert_type_and_challenge,
};

#[test]
fn test_base64url_encode_all_zero() {
    let expected = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".as_bytes();
    let out = base64url_encode_32([0; 32]);
    assert(out == expected);
}

#[test]
fn test_base64url_encode_known_vector() {
    let mut input: [u8; 32] = [0; 32];
    for i in 0..32 {
        input[i] = i as u8;
    }
    let expected = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8".as_bytes();
    let out = base64url_encode_32(input);
    assert(out == expected);
}

#[test]
fn test_base64url_encode_all_ff() {
    let expected = "__________________________________________8".as_bytes();
    let out = base64url_encode_32([255; 32]);
    assert(out == expected);
}


// --- Fixtures copied verbatim from noir_webauthn v0.37.2 my_test (Apache-2.0) ---
global FIX_PUBKEY_X: [u8; 32] = [
    91, 200, 36, 72, 14, 85, 105, 189, 204, 19, 185, 157, 161, 241, 56, 107, 228, 8, 67, 156, 7,
    183, 173, 111, 146, 216, 51, 2, 244, 251, 78, 203,
];
global FIX_PUBKEY_Y: [u8; 32] = [
    30, 52, 243, 79, 92, 114, 5, 253, 138, 212, 14, 51, 122, 247, 225, 82, 193, 243, 157, 70, 225,
    62, 254, 206, 247, 110, 252, 111, 188, 128, 142, 226,
];
global FIX_SIGNATURE: [u8; 64] = [
    47, 222, 74, 22, 26, 2, 142, 123, 25, 179, 68, 61, 58, 204, 200, 245, 241, 176, 227, 237, 173,
    115, 147, 229, 128, 165, 63, 170, 148, 250, 171, 141, 115, 50, 249, 181, 84, 62, 116, 119,
    139, 101, 89, 14, 140, 246, 186, 29, 143, 146, 13, 198, 186, 85, 47, 213, 235, 176, 236, 26,
    88, 231, 191, 129,
];
// {"type":"webauthn.get","challenge":"ULLEP9ORBrr7ug2jT8Qw4fkePJbqKs7ivDQRn5Kzd1A","origin":"http://localhost:5184","crossOrigin":false}
global FIX_CDJ_BYTES: [u8; 134] = [
    123, 34, 116, 121, 112, 101, 34, 58, 34, 119, 101, 98, 97, 117, 116, 104, 110, 46, 103, 101,
    116, 34, 44, 34, 99, 104, 97, 108, 108, 101, 110, 103, 101, 34, 58, 34, 85, 76, 76, 69, 80,
    57, 79, 82, 66, 114, 114, 55, 117, 103, 50, 106, 84, 56, 81, 119, 52, 102, 107, 101, 80, 74,
    98, 113, 75, 115, 55, 105, 118, 68, 81, 82, 110, 53, 75, 122, 100, 49, 65, 34, 44, 34, 111,
    114, 105, 103, 105, 110, 34, 58, 34, 104, 116, 116, 112, 58, 47, 47, 108, 111, 99, 97, 108,
    104, 111, 115, 116, 58, 53, 49, 56, 52, 34, 44, 34, 99, 114, 111, 115, 115, 79, 114, 105, 103,
    105, 110, 34, 58, 102, 97, 108, 115, 101, 125,
];
// rpIdHash = SHA256("localhost"), flags = 29 (UP|UV), counter = 0
global FIX_AD_BYTES: [u8; 37] = [
    73, 150, 13, 229, 136, 14, 140, 104, 116, 52, 23, 15, 100, 118, 96, 91, 143, 228, 174, 185,
    162, 134, 50, 199, 153, 92, 243, 186, 131, 29, 151, 99, 29, 0, 0, 0, 0,
];
global FIX_CHALLENGE: [u8; 32] = [
    80, 178, 196, 63, 211, 145, 6, 186, 251, 186, 13, 163, 79, 196, 48, 225, 249, 30, 60, 150,
    234, 42, 206, 226, 188, 52, 17, 159, 146, 179, 119, 80,
];
global OTHER_VALID_PUBKEY_X: [u8; 32] = [
    139, 86, 118, 230, 15, 13, 30, 204, 6, 133, 248, 82, 54, 101, 178, 189, 126, 170,
    84, 48, 0, 106, 149, 40, 133, 99, 30, 73, 2, 210, 205, 200,
];
global OTHER_VALID_PUBKEY_Y: [u8; 32] = [
    184, 8, 42, 248, 97, 207, 125, 175, 201, 50, 10, 102, 148, 60, 53, 169, 208, 70,
    112, 255, 179, 218, 110, 33, 33, 135, 156, 9, 30, 230, 17, 26,
];

pub fn fixture_cdj() -> BoundedVec<u8, 256> {
    let mut v: BoundedVec<u8, 256> = BoundedVec::new();
    for i in 0..134 {
        v.push(FIX_CDJ_BYTES[i]);
    }
    v
}

pub fn fixture_ad() -> BoundedVec<u8, 64> {
    let mut v: BoundedVec<u8, 64> = BoundedVec::new();
    for i in 0..37 {
        v.push(FIX_AD_BYTES[i]);
    }
    v
}

#[test]
fn test_signature_verifies_over_message_hash() {
    let message_hash = compute_webauthn_message_hash(fixture_ad(), fixture_cdj());
    let ok = std::ecdsa_secp256r1::verify_signature(
        FIX_PUBKEY_X, FIX_PUBKEY_Y, FIX_SIGNATURE, message_hash,
    );
    assert(ok);
}

#[test]
fn test_tampered_client_data_changes_hash() {
    let mut cdj_bytes = FIX_CDJ_BYTES;
    cdj_bytes[0] = 91; // '{' -> '['
    let mut cdj: BoundedVec<u8, 256> = BoundedVec::new();
    for i in 0..134 {
        cdj.push(cdj_bytes[i]);
    }
    let message_hash = compute_webauthn_message_hash(fixture_ad(), cdj);
    let ok = std::ecdsa_secp256r1::verify_signature(
        FIX_PUBKEY_X, FIX_PUBKEY_Y, FIX_SIGNATURE, message_hash,
    );
    assert(!ok);
}


fn fixture_rp_id_hash() -> [u8; 32] {
    let mut h: [u8; 32] = [0; 32];
    for i in 0..32 {
        h[i] = FIX_AD_BYTES[i];
    }
    h
}

fn fixture_origin() -> ([u8; 64], u32) {
    let origin_str = "http://localhost:5184".as_bytes(); // [u8; 21]
    let mut origin: [u8; 64] = [0; 64];
    for i in 0..21 {
        origin[i] = origin_str[i];
    }
    (origin, 21)
}

#[test]
fn test_type_and_challenge_pass_on_fixture() {
    assert_type_and_challenge(fixture_cdj(), FIX_CHALLENGE);
}

#[test(should_fail)]
fn test_wrong_challenge_fails() {
    let mut wrong = FIX_CHALLENGE;
    wrong[0] = wrong[0] + 1;
    assert_type_and_challenge(fixture_cdj(), wrong);
}

#[test(should_fail)]
fn test_wrong_type_fails() {
    let mut cdj_bytes = FIX_CDJ_BYTES;
    cdj_bytes[9] = 88; // 'w' of webauthn.get -> 'X'
    let mut cdj: BoundedVec<u8, 256> = BoundedVec::new();
    for i in 0..134 { cdj.push(cdj_bytes[i]); }
    assert_type_and_challenge(cdj, FIX_CHALLENGE);
}

#[test]
fn test_origin_passes_on_fixture() {
    let (origin, origin_len) = fixture_origin();
    assert_origin_at(fixture_cdj(), 81, origin, origin_len);
}

#[test(should_fail)]
fn test_wrong_origin_fails() {
    let mut origin: [u8; 64] = [0; 64];
    let evil = "http://localhost:5185".as_bytes();
    for i in 0..21 { origin[i] = evil[i]; }
    assert_origin_at(fixture_cdj(), 81, origin, 21);
}

#[test(should_fail)]
fn test_origin_prefix_attack_fails() {
    // Claimed origin is a strict prefix of the real one; must fail the
    // closing-quote check (next char is '4', not '"').
    let mut origin: [u8; 64] = [0; 64];
    let prefix = "http://localhost:518".as_bytes();
    for i in 0..20 { origin[i] = prefix[i]; }
    assert_origin_at(fixture_cdj(), 81, origin, 20);
}

#[test]
fn test_cross_origin_false_fixture_passes_scan() {
    assert_no_cross_origin_true(fixture_cdj());
}

#[test(should_fail)]
fn test_cross_origin_true_fails_scan() {
    let target = "{\"type\":\"webauthn.get\",\"challenge\":\"ULLEP9ORBrr7ug2jT8Qw4fkePJbqKs7ivDQRn5Kzd1A\",\"origin\":\"http://localhost:5184\",\"crossOrigin\":true}"
        .as_bytes();
    let mut v: BoundedVec<u8, 256> = BoundedVec::new();
    for i in 0..target.len() { v.push(target[i]); }
    assert_no_cross_origin_true(v);
}

#[test]
fn test_rp_id_hash_passes_on_fixture() {
    assert_rp_id_hash(fixture_ad(), fixture_rp_id_hash());
}

#[test(should_fail)]
fn test_wrong_rp_id_hash_fails() {
    let mut wrong = fixture_rp_id_hash();
    wrong[31] = wrong[31] + 1;
    assert_rp_id_hash(fixture_ad(), wrong);
}

#[test]
fn test_flags_pass_on_fixture() {
    assert_authenticator_flags(fixture_ad());
}

#[test(should_fail)]
fn test_missing_uv_flag_fails() {
    let mut ad_bytes = FIX_AD_BYTES;
    ad_bytes[32] = 0x01; // UP only
    let mut v: BoundedVec<u8, 64> = BoundedVec::new();
    for i in 0..37 { v.push(ad_bytes[i]); }
    assert_authenticator_flags(v);
}

#[test(should_fail)]
fn test_missing_up_flag_fails() {
    let mut ad_bytes = FIX_AD_BYTES;
    ad_bytes[32] = 0x04; // UV only
    let mut v: BoundedVec<u8, 64> = BoundedVec::new();
    for i in 0..37 { v.push(ad_bytes[i]); }
    assert_authenticator_flags(v);
}

#[test(should_fail)]
fn test_short_authenticator_data_fails() {
    let mut v: BoundedVec<u8, 64> = BoundedVec::new();
    for i in 0..32 { v.push(FIX_AD_BYTES[i]); }
    assert_authenticator_flags(v);
}

fn fixture_envelope() -> WebAuthnEnvelope<256, 64> {
    WebAuthnEnvelope {
        authenticator_data: fixture_ad(),
        client_data_json: fixture_cdj(),
        signature: FIX_SIGNATURE,
        origin_index: 81,
    }
}

#[test]
fn test_full_assertion_verifies() {
    let (origin, origin_len) = fixture_origin();
    let ok = verify_webauthn_get_assertion(
        fixture_envelope(), FIX_PUBKEY_X, FIX_PUBKEY_Y, FIX_CHALLENGE,
        fixture_rp_id_hash(), origin, origin_len,
    );
    assert(ok);
}

#[test]
fn test_wrong_public_key_fails_signature() {
    let (origin, origin_len) = fixture_origin();
    let ok = verify_webauthn_get_assertion(
        fixture_envelope(), OTHER_VALID_PUBKEY_X, OTHER_VALID_PUBKEY_Y, FIX_CHALLENGE,
        fixture_rp_id_hash(), origin, origin_len,
    );
    assert(!ok);
}

#[test(should_fail)]
fn test_wrong_challenge_fails_envelope() {
    let (origin, origin_len) = fixture_origin();
    let mut wrong = FIX_CHALLENGE;
    wrong[5] = wrong[5] + 1;
    let _ = verify_webauthn_get_assertion(
        fixture_envelope(), FIX_PUBKEY_X, FIX_PUBKEY_Y, wrong,
        fixture_rp_id_hash(), origin, origin_len,
    );
}
