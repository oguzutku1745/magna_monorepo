use aztec::protocol::hash::poseidon2_hash_with_separator;

global MAGNA_CLAIMS_DS: u32 = 0x4D414743; // "MAGC"
global MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS: u32 = 0x4D414E43; // "MANC"
global MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS: u32 = 0x4D414558; // "MAEX"
global PASSPORT_SCHEMA_VERSION_V2: u8 = 2;
global PASSPORT_CREDENTIAL_TYPE: u8 = 1;

fn compute_nationality_commitment(
    nationality_alpha3_packed: Field,
    nationality_blind: Field,
) -> Field {
    poseidon2_hash_with_separator(
        [nationality_alpha3_packed, nationality_blind],
        MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
    )
}

fn compute_expiry_commitment(expiry_ts: u64, expiry_blind: Field) -> Field {
    poseidon2_hash_with_separator(
        [expiry_ts as Field, expiry_blind],
        MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
    )
}

fn compute_claims_hash(
    nationality_commitment: Field,
    min_age_proven: u8,
    expiry_commitment: Field,
) -> Field {
    poseidon2_hash_with_separator(
        [
            PASSPORT_SCHEMA_VERSION_V2 as Field,
            PASSPORT_CREDENTIAL_TYPE as Field,
            nationality_commitment,
            min_age_proven as Field,
            expiry_commitment,
        ],
        MAGNA_CLAIMS_DS,
    )
}

fn main(
    nationality_alpha3_packed: Field,
    nationality_blind: Field,
    expiry_ts: u64,
    expiry_blind: Field,
    min_age_proven: u8,
    age_min_bound: u8,
    age_max_bound: u8,
    credential_valid_until: u64,
    scoped_nullifier: Field,
    expected_claims_hash: Field,
    expected_nationality_commitment: Field,
    expected_expiry_commitment: Field,
    expected_min_age_proven: Field,
    expected_credential_valid_until: Field,
    expected_scoped_nullifier: Field,
    expected_nationality_disclosure_commitment: Field,
    expected_expiry_disclosure_commitment: Field,
    expected_age_predicate_commitment: Field,
    expected_bind_commitment: Field,
) -> pub [Field; 10] {
    assert(age_max_bound >= age_min_bound, "Invalid age predicate bounds");
    assert(min_age_proven >= age_min_bound, "Age predicate minimum not proven");
    assert(min_age_proven <= age_max_bound, "Age predicate maximum not proven");

    let nationality_commitment = compute_nationality_commitment(
        nationality_alpha3_packed,
        nationality_blind,
    );
    let expiry_commitment = compute_expiry_commitment(expiry_ts, expiry_blind);
    let claims_hash = compute_claims_hash(
        nationality_commitment,
        min_age_proven,
        expiry_commitment,
    );

    assert(
        nationality_commitment == expected_nationality_commitment,
        "Nationality commitment mismatch",
    );
    assert(expiry_commitment == expected_expiry_commitment, "Expiry commitment mismatch");
    assert(claims_hash == expected_claims_hash, "Claims hash mismatch");
    assert(min_age_proven as Field == expected_min_age_proven, "minAgeProven mismatch");
    assert(
        credential_valid_until as Field == expected_credential_valid_until,
        "credentialValidUntil mismatch",
    );
    assert(scoped_nullifier == expected_scoped_nullifier, "scopedNullifier mismatch");

    [
        expected_claims_hash,
        expected_nationality_commitment,
        expected_expiry_commitment,
        expected_min_age_proven,
        expected_credential_valid_until,
        expected_scoped_nullifier,
        expected_nationality_disclosure_commitment,
        expected_expiry_disclosure_commitment,
        expected_age_predicate_commitment,
        expected_bind_commitment,
    ]
}
