use aztec::protocol::hash::poseidon2_hash_with_separator;

pub fn compute_passport_issuance_nullifier(
    root_commitment: Field,
    schema_version: u8,
    credential_type: u8,
    issuance_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [schema_version as Field, credential_type as Field, root_commitment],
        issuance_domain_separator,
    )
}
