use crate::base64url::base64url_encode_32;

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
