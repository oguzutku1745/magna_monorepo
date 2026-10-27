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

pub fn compute_linked_status_secret(
    root_secret: Field,
    credential_type: u8,
    claims_hash: Field,
) -> Field {
    poseidon2_hash_with_separator(
        [root_secret, credential_type as Field, claims_hash],
        crate::internal::constants::MAGNA_LINKED_STATUS_SECRET_DS,
    )
}

// History membership alone accepts arbitrary contracts and slots. Authenticate those
// separately, using the actual Owned<PrivateSet>.at(owner) storage slot.
pub fn assert_note_origin<Note>(
    hinted: aztec::note::HintedNote<Note>,
    issuer: aztec::protocol::address::AztecAddress,
    owner: aztec::protocol::address::AztecAddress,
    storage_slot: Field,
) {
    assert(hinted.owner == owner, "note owner mismatch");
    assert(hinted.contract_address == issuer, "note issuer mismatch");
    assert(hinted.storage_slot == storage_slot, "note storage slot mismatch");
}

pub fn bounded_revocation_deadline(anchor_timestamp: u64, existing_deadline: u64) -> u64 {
    std::cmp::min(
        anchor_timestamp + crate::internal::constants::MAGNA_REVOCATION_ANCHOR_SECONDS,
        existing_deadline,
    )
}
