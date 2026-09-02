use aztec::protocol::hash::poseidon2_hash_with_separator;
use std::hash::pedersen_hash;

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
    handle_commitment: Field,
    expiry_ts: u64,
    claims_domain_separator: u32,
) -> Field {
    pedersen_hash([
        claims_domain_separator as Field,
        schema_version as Field,
        credential_type as Field,
        handle_commitment,
        expiry_ts as Field,
    ])
}

pub fn compute_instagram_handle_commitment(
    handle_hash: Field,
    handle_blind: Field,
    commitment_domain_separator: u32,
) -> Field {
    assert(handle_blind != 0, "instagram handle blind must be non-zero");
    pedersen_hash([
        commitment_domain_separator as Field,
        handle_hash,
        handle_blind,
    ])
}
