use aztec::protocol::hash::poseidon2_hash_with_separator;
use date::Date;
use std::verify_proof_with_type;
use zkpassport_age::calculate_param_commitment as calculate_age_param_commitment;
use zkpassport_bind::calculate_param_commitment as calculate_bind_param_commitment;
use zkpassport_disclose::calculate_param_commitment as calculate_disclose_param_commitment;

global MAGNA_CLAIMS_DS: u32 = 0x4D414743; // "MAGC"
global MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS: u32 = 0x4D414E43; // "MANC"
global MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS: u32 = 0x4D414558; // "MAEX"
global MAGNA_ROOT_DS: u32 = 0x4D414749; // "MAGI"
global MAGNA_PASSPORT_A2_CONTEXT_DS: u32 = 0x4D413243; // "MA2C"
global PASSPORT_SCHEMA_VERSION_V2: u8 = 2;
global PASSPORT_CREDENTIAL_TYPE: u8 = 1;
global ZKPASSPORT_OUTER_COUNT_6_VKEY_HASH: Field =
    0x1235fce6de6e5d5f86af3509d1c043bf531b5b01ca97a97eec45ac48ab0cec2c;
global ZKPASSPORT_OUTER_PUBLIC_INPUT_COUNT: u32 = 11;
global ZKPASSPORT_OUTER_PROOF_SIZE: u32 = 458;
global ZKPASSPORT_OUTER_VKEY_SIZE: u32 = 115;
global ZKPASSPORT_PROOF_TYPE_HONK_ZK: u32 = 6;
global ZKPASSPORT_MRZ_LENGTH: u32 = 90;
global ZKPASSPORT_BIND_LENGTH: u32 = 509;
global PASSPORT_DOCUMENT_TYPE: u8 = 80; // "P"
global ID_CARD_DOCUMENT_TYPE: u8 = 73; // "I"

fn contains(values: [Field; 3], expected: Field) -> bool {
    (values[0] == expected) | (values[1] == expected) | (values[2] == expected)
}

fn assert_disclosed_claims(
    disclose_mask: [bool; ZKPASSPORT_MRZ_LENGTH],
    disclosed_bytes: [u8; ZKPASSPORT_MRZ_LENGTH],
    nationality: [u8; 3],
    expiry_mrz: [u8; 6],
) {
    assert(disclose_mask[0], "Document type byte is not disclosed");
    assert(disclose_mask[1], "Document subtype byte is not disclosed");
    let is_passport = disclosed_bytes[0] == PASSPORT_DOCUMENT_TYPE;
    let is_id_card = disclosed_bytes[0] == ID_CARD_DOCUMENT_TYPE;
    assert(is_passport | is_id_card, "Unsupported authenticated document type");
    let nationality_offset = if is_id_card { 45 } else { 54 };
    let expiry_offset = if is_id_card { 38 } else { 65 };

    for i in 0..3 {
        assert(disclose_mask[nationality_offset + i], "Nationality byte is not disclosed");
        assert(
            disclosed_bytes[nationality_offset + i] == nationality[i],
            "Nationality does not match authenticated disclosure",
        );
    }
    for i in 0..6 {
        assert(disclose_mask[expiry_offset + i], "Expiry byte is not disclosed");
        assert(
            disclosed_bytes[expiry_offset + i] == expiry_mrz[i],
            "Expiry does not match authenticated disclosure",
        );
    }
}

fn pack_alpha3(nationality: [u8; 3]) -> Field {
    nationality[0] as Field * 0x10000
        + nationality[1] as Field * 0x100
        + nationality[2] as Field
}

fn canonical_expiry_timestamp(expiry_mrz: [u8; 6], proof_current_date: u64) -> u64 {
    let threshold = Date::from_timestamp(proof_current_date).add_years(20);
    Date::from_bytes_short_year(expiry_mrz, threshold).to_timestamp() + 86399
}

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
    zkpassport_outer_vkey: [Field; ZKPASSPORT_OUTER_VKEY_SIZE],
    zkpassport_outer_proof: [Field; ZKPASSPORT_OUTER_PROOF_SIZE],
    zkpassport_outer_public_inputs: [Field; ZKPASSPORT_OUTER_PUBLIC_INPUT_COUNT],
    disclose_mask: [bool; ZKPASSPORT_MRZ_LENGTH],
    disclosed_bytes: [u8; ZKPASSPORT_MRZ_LENGTH],
    nationality: [u8; 3],
    expiry_mrz: [u8; 6],
    nationality_blind: Field,
    expiry_ts: u64,
    expiry_blind: Field,
    min_age_proven: u8,
    age_min_bound: u8,
    age_max_bound: u8,
    bind_data: [u8; ZKPASSPORT_BIND_LENGTH],
    credential_valid_until: u64,
    action: Field,
    issuer: Field,
    owner: Field,
    ghost_owner: Field,
    credential_mode: Field,
) -> pub [Field; 8] {
    verify_proof_with_type(
        zkpassport_outer_vkey,
        zkpassport_outer_proof,
        zkpassport_outer_public_inputs,
        ZKPASSPORT_OUTER_COUNT_6_VKEY_HASH,
        ZKPASSPORT_PROOF_TYPE_HONK_ZK,
    );

    assert(
        (age_max_bound == 0) | (age_max_bound >= age_min_bound),
        "Invalid age predicate bounds",
    );
    assert(min_age_proven == age_min_bound, "minAgeProven must equal authenticated lower bound");

    assert_disclosed_claims(
        disclose_mask,
        disclosed_bytes,
        nationality,
        expiry_mrz,
    );

    let proof_current_date = zkpassport_outer_public_inputs[2] as u64;
    let authenticated_expiry_ts = canonical_expiry_timestamp(expiry_mrz, proof_current_date);
    assert(expiry_ts == authenticated_expiry_ts, "Expiry timestamp is not canonical");
    assert(
        credential_valid_until <= authenticated_expiry_ts,
        "Credential validity exceeds passport expiry",
    );

    let outer_param_commitments = [
        zkpassport_outer_public_inputs[5],
        zkpassport_outer_public_inputs[6],
        zkpassport_outer_public_inputs[7],
    ];
    let disclose_param_commitment = calculate_disclose_param_commitment(
        disclose_mask,
        disclosed_bytes,
    );
    let age_param_commitment = calculate_age_param_commitment(age_min_bound, age_max_bound);
    let bind_param_commitment = calculate_bind_param_commitment(bind_data);
    assert(
        contains(outer_param_commitments, disclose_param_commitment),
        "Disclosure commitment is not authenticated by zkPassport",
    );
    assert(
        contains(outer_param_commitments, age_param_commitment),
        "Age commitment is not authenticated by zkPassport",
    );
    assert(
        contains(outer_param_commitments, bind_param_commitment),
        "Bind commitment is not authenticated by zkPassport",
    );

    let nationality_commitment = compute_nationality_commitment(
        pack_alpha3(nationality),
        nationality_blind,
    );
    let expiry_commitment = compute_expiry_commitment(expiry_ts, expiry_blind);
    let claims_hash = compute_claims_hash(
        nationality_commitment,
        min_age_proven,
        expiry_commitment,
    );
    let scoped_nullifier = zkpassport_outer_public_inputs[9];
    let root_commitment = poseidon2_hash_with_separator([scoped_nullifier], MAGNA_ROOT_DS);
    let request_context_hash = poseidon2_hash_with_separator(
        [
            action,
            issuer,
            owner,
            ghost_owner,
            credential_mode,
            root_commitment,
            credential_valid_until as Field,
            zkpassport_outer_public_inputs[0],
            zkpassport_outer_public_inputs[1],
            zkpassport_outer_public_inputs[8],
            zkpassport_outer_public_inputs[3],
            zkpassport_outer_public_inputs[4],
            bind_param_commitment,
        ],
        MAGNA_PASSPORT_A2_CONTEXT_DS,
    );

    [
        claims_hash,
        nationality_commitment,
        expiry_commitment,
        min_age_proven as Field,
        credential_valid_until as Field,
        root_commitment,
        request_context_hash,
        proof_current_date as Field,
    ]
}
