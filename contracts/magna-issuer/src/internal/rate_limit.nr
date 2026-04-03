use aztec::protocol::hash::poseidon2_hash_with_separator;

pub fn compute_sponsor_rate_limit_nullifier(
    revocation_secret: Field,
    credential_type: u8,
    claims_hash: Field,
    window_id: u64,
    slot: u8,
    domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [
            revocation_secret,
            credential_type as Field,
            claims_hash,
            window_id as Field,
            slot as Field,
        ],
        domain_separator,
    )
}

