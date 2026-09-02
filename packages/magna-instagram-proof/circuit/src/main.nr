use std::hash::pedersen_hash;
use zkemail::{
    dkim::RSAPubkey,
    headers::{body_hash::get_body_hash, email_address::get_email_address},
    partial_hash::partial_sha256_var_end,
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

// zkemail.nr v2.0.0 defines its 1024-bit RSA representation as nine 120-bit limbs.
// The upstream constant is private, so keep the value explicit at this integration boundary.
global RSA_1024_LIMBS: u32 = 9;

fn main(
    header: BoundedVec<u8, MAX_EMAIL_HEADER_LENGTH>,
    body: BoundedVec<u8, MAX_PARTIAL_EMAIL_BODY_LENGTH>,
    pubkey: RSAPubkey<RSA_1024_LIMBS>,
    signature: [Field; RSA_1024_LIMBS],
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
    handle_blind: Field,
    expiry_ts: u64,
    active_owner: Field,
    issuer_address: Field,
    chain_id: Field,
) -> pub [Field; 7] {
    assert(header.len() <= MAX_EMAIL_HEADER_LENGTH, "Email header length exceeds maximum");
    assert(body.len() <= MAX_PARTIAL_EMAIL_BODY_LENGTH, "Email body length exceeds maximum");

    let _authenticated_header_hash = pubkey.verify_dkim_signature(header, signature);

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

    let handle_packed = assert_instagram_handle_match(
        body,
        prefix_index,
        template_kind,
        claimed_handle,
        claimed_handle_len,
    );

    assert(handle_blind != 0, "Handle blind must be non-zero");
    assert(expiry_ts != 0, "Credential expiry must be non-zero");
    assert(active_owner != 0, "Active owner must be non-zero");
    assert(issuer_address != 0, "Issuer address must be non-zero");
    assert(chain_id != 0, "Chain id must be non-zero");

    let handle_hash = pedersen_hash([
        constants::MAGNA_INSTAGRAM_HANDLE_DS,
        claimed_handle_len as Field,
        handle_packed,
    ]);
    let handle_commitment = pedersen_hash([
        constants::MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS,
        handle_hash,
        handle_blind,
    ]);
    let claims_hash = pedersen_hash([
        constants::MAGNA_CLAIMS_DS,
        constants::INSTAGRAM_SCHEMA_VERSION,
        constants::INSTAGRAM_CREDENTIAL_TYPE,
        handle_commitment,
        expiry_ts as Field,
    ]);

    let pubkey_hash = pubkey.hash();
    [
        pedersen_hash(pubkey_hash),
        pedersen_hash(signature),
        claims_hash,
        expiry_ts as Field,
        active_owner,
        issuer_address,
        chain_id,
    ]
}
