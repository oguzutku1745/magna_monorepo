use std::hash::pedersen_hash;
use zkemail::{
    dkim::RSAPubkey,
    headers::{body_hash::get_body_hash, email_address::get_email_address},
    partial_hash::partial_sha256_var_end,
    remove_soft_line_breaks::remove_soft_line_breaks,
    KEY_LIMBS_1024,
    Sequence,
};

mod body_match;
mod constants;

use crate::{
    body_match::assert_instagram_handle_match,
    constants::{
        INSTAGRAM_FROM_EMAIL, MAX_EMAIL_HEADER_LENGTH, MAX_INSTAGRAM_HANDLE_LENGTH,
        MAX_PARTIAL_EMAIL_BODY_LENGTH,
    },
};

fn main(
    header: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH>,
    body: BoundedVec<u8, MAX_PARTIAL_EMAIL_BODY_LENGTH>,
    decoded_body: BoundedVec<u8, MAX_PARTIAL_EMAIL_BODY_LENGTH>,
    pubkey: RSAPubkey<KEY_LIMBS_1024>,
    signature: [Field; KEY_LIMBS_1024],
    body_hash_index: u32,
    dkim_header_sequence: Sequence,
    from_header_sequence: Sequence,
    from_address_sequence: Sequence,
    partial_body_hash: [u32; 8],
    partial_body_real_length: u64,
    prefix_index: u32,
    template_kind: u8,
    claimed_handle: [u8; MAX_INSTAGRAM_HANDLE_LENGTH],
    claimed_handle_len: u32,
) -> pub [Field; 4] {
    assert(header.len() <= MAX_EMAIL_HEADER_LENGTH, "Email header length exceeds maximum");
    assert(body.len() <= MAX_PARTIAL_EMAIL_BODY_LENGTH, "Email body length exceeds maximum");
    assert(
        decoded_body.len() <= MAX_PARTIAL_EMAIL_BODY_LENGTH,
        "Decoded email body length exceeds maximum",
    );

    pubkey.verify_dkim_signature(header, signature);

    let from = comptime { "from".as_bytes() };
    let from_addr = get_email_address(header, from_header_sequence, from_address_sequence, from);
    assert(
        from_addr.eq(BoundedVec::from(INSTAGRAM_FROM_EMAIL)),
        "Unexpected Instagram sender",
    );

    let signed_body_hash = get_body_hash(header, dkim_header_sequence, body_hash_index);
    let computed_body_hash = partial_sha256_var_end(
        partial_body_hash,
        body.storage(),
        body.len() as u64,
        partial_body_real_length,
    );
    assert(
        signed_body_hash == computed_body_hash,
        "SHA256 body hash does not match DKIM body hash",
    );
    assert(
        remove_soft_line_breaks(body.storage(), decoded_body.storage()),
        "Decoded body does not match quoted-printable soft-line-break removal",
    );

    let handle_packed = assert_instagram_handle_match(
        decoded_body,
        prefix_index,
        template_kind,
        claimed_handle,
        claimed_handle_len,
    );

    [
        pubkey.hash(),
        pedersen_hash(signature),
        claimed_handle_len as Field,
        handle_packed,
    ]
}
