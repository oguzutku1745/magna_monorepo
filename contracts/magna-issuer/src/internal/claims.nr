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

pub fn compute_passport_nationality_commitment(
    nationality_alpha3_packed: Field,
    nationality_blind: Field,
    nationality_commitment_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [
            nationality_alpha3_packed,
            nationality_blind,
        ],
        nationality_commitment_domain_separator,
    )
}

pub fn compute_passport_expiry_commitment(
    expiry_ts: u64,
    expiry_blind: Field,
    expiry_commitment_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [
            expiry_ts as Field,
            expiry_blind,
        ],
        expiry_commitment_domain_separator,
    )
}

pub fn compute_passport_claims_hash_v2(
    schema_version: u8,
    credential_type: u8,
    nationality_commitment: Field,
    min_age_proven: u8,
    expiry_commitment: Field,
    claims_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [
            schema_version as Field,
            credential_type as Field,
            nationality_commitment,
            min_age_proven as Field,
            expiry_commitment,
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
