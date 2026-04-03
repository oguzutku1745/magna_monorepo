use aztec::protocol::hash::poseidon2_hash_with_separator;

pub fn compute_passport_claims_hash(
    schema_version: u8,
    credential_type: u8,
    nationality_alpha3_packed: Field,
    min_age_proven: u8,
    expiry_ts: u64,
    claims_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [
            schema_version as Field,
            credential_type as Field,
            nationality_alpha3_packed,
            min_age_proven as Field,
            expiry_ts as Field,
        ],
        claims_domain_separator,
    )
}

pub fn compute_instagram_claims_hash(
    schema_version: u8,
    credential_type: u8,
    handle_hash: Field,
    expiry_ts: u64,
    claims_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [
            schema_version as Field,
            credential_type as Field,
            handle_hash,
            expiry_ts as Field,
        ],
        claims_domain_separator,
    )
}
