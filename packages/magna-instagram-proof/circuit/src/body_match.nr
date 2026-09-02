use crate::constants::{
    MAX_INSTAGRAM_HANDLE_LENGTH, PERIOD, TEMPLATE_ENGLISH, ZERO,
};

fn is_digit(byte: u8) -> bool {
    byte >= 48 & byte <= 57
}

fn is_lowercase_alpha(byte: u8) -> bool {
    byte >= 97 & byte <= 122
}

fn is_handle_char(byte: u8) -> bool {
    is_lowercase_alpha(byte) | is_digit(byte) | (byte == 46) | (byte == 95)
}

fn english_prefix_matches<let N: u32>(body: BoundedVec<u8, N>, prefix_index: u32) -> bool {
    let prefix = comptime { "and intended for ".as_bytes() };
    let in_bounds = prefix_index + 17 <= body.len();
    let mut matches = in_bounds;
    for i in 0..17 {
        matches = matches & (body.get_unchecked(prefix_index + i) == prefix[i]);
    }
    matches
}

pub fn prefix_length(template_kind: u8) -> u32 {
    if template_kind == TEMPLATE_ENGLISH {
        17
    } else {
        0
    }
}

pub fn assert_instagram_handle_match<let N: u32>(
    decoded_body: BoundedVec<u8, N>,
    prefix_index: u32,
    template_kind: u8,
    claimed_handle: [u8; MAX_INSTAGRAM_HANDLE_LENGTH],
    claimed_handle_len: u32,
) -> Field {
    assert(claimed_handle_len > 0, "Instagram handle is empty");
    assert(
        claimed_handle_len <= MAX_INSTAGRAM_HANDLE_LENGTH,
        "Instagram handle is too long",
    );

    assert(template_kind == TEMPLATE_ENGLISH, "Unsupported Instagram email template");
    assert(
        english_prefix_matches(decoded_body, prefix_index),
        "Instagram ownership footer not found at asserted index",
    );

    let handle_start = prefix_index + prefix_length(template_kind);
    assert(
        handle_start + claimed_handle_len < decoded_body.len(),
        "Instagram handle match exceeds body bounds",
    );

    let mut packed: Field = 0;
    for i in 0..MAX_INSTAGRAM_HANDLE_LENGTH {
        if i < claimed_handle_len {
            let expected = claimed_handle[i];
            assert(is_handle_char(expected), "Instagram handle contains invalid character");
            assert(
                decoded_body.get_unchecked(handle_start + i) == expected,
                "Instagram handle byte does not match signed body",
            );
            packed = (packed * 256) + expected as Field;
        } else {
            assert(claimed_handle[i] == ZERO, "Instagram handle padding must be zero");
        }
    }

    assert(
        decoded_body.get_unchecked(handle_start + claimed_handle_len) == PERIOD,
        "Instagram footer handle must be period terminated",
    );

    packed
}
