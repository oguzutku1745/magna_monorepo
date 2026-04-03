use aztec::protocol::hash::poseidon2_hash_with_separator;

pub fn compute_revocation_nullifier(
    revocation_secret: Field,
    credential_type: u8,
    claims_hash: Field,
    revocation_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [revocation_secret, credential_type as Field, claims_hash],
        revocation_domain_separator,
    )
}

pub fn compute_root_revocation_nullifier(
    revocation_secret: Field,
    root_commitment: Field,
    revocation_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [revocation_secret, root_commitment],
        revocation_domain_separator,
    )
}

pub fn compute_root_authority_revocation_nullifier(
    revocation_secret: Field,
    root_commitment: Field,
    claims_hash: Field,
    revocation_domain_separator: u32,
) -> Field {
    poseidon2_hash_with_separator(
        [revocation_secret, root_commitment, claims_hash],
        revocation_domain_separator,
    )
}
