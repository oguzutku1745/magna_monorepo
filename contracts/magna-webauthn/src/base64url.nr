// RFC 4648 base64url alphabet: A-Z a-z 0-9 - _
global BASE64URL_ALPHABET: [u8; 64] = [
    65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
    88, 89, 90, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113,
    114, 115, 116, 117, 118, 119, 120, 121, 122, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 45, 95,
];

/// Encodes 32 bytes as 43 base64url characters (no padding). This matches how
/// browsers encode the WebAuthn challenge inside clientDataJSON.
pub fn base64url_encode_32(input: [u8; 32]) -> [u8; 43] {
    let mut out: [u8; 43] = [0; 43];
    // 10 full 3-byte groups -> 40 output chars.
    for g in 0..10 {
        let b0 = input[g * 3] as u32;
        let b1 = input[g * 3 + 1] as u32;
        let b2 = input[g * 3 + 2] as u32;
        out[g * 4] = BASE64URL_ALPHABET[((b0 >> 2) & 63) as u32];
        out[g * 4 + 1] = BASE64URL_ALPHABET[(((b0 & 3) << 4) | (b1 >> 4)) as u32];
        out[g * 4 + 2] = BASE64URL_ALPHABET[(((b1 & 15) << 2) | (b2 >> 6)) as u32];
        out[g * 4 + 3] = BASE64URL_ALPHABET[(b2 & 63) as u32];
    }
    // Trailing 2 bytes -> 3 chars (4 zero pad bits, no '=' emitted).
    let b0 = input[30] as u32;
    let b1 = input[31] as u32;
    out[40] = BASE64URL_ALPHABET[((b0 >> 2) & 63) as u32];
    out[41] = BASE64URL_ALPHABET[(((b0 & 3) << 4) | (b1 >> 4)) as u32];
    out[42] = BASE64URL_ALPHABET[((b1 & 15) << 2) as u32];
    out
}
