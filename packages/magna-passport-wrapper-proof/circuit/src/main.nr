use aztec::protocol::hash::poseidon2_hash_with_separator;
use date::Date;
use std::verify_proof_with_type;
use zkpassport_age::calculate_param_commitment as calculate_age_param_commitment;
use zkpassport_bind::calculate_param_commitment as calculate_bind_param_commitment;
use zkpassport_disclose::calculate_param_commitment as calculate_disclose_param_commitment;
use zkpassport_facematch::param_commit::calculate_param_commitment as calculate_facematch_param_commitment;

global MAGNA_CLAIMS_DS: u32 = 0x4D414743; // "MAGC"
global MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS: u32 = 0x4D414E43; // "MANC"
global MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS: u32 = 0x4D414558; // "MAEX"
global MAGNA_ROOT_DS: u32 = 0x4D414749; // "MAGI"
global MAGNA_PASSPORT_A2_CONTEXT_DS: u32 = 0x4D413243; // "MA2C"
global PASSPORT_SCHEMA_VERSION_V2: u8 = 2;
global PASSPORT_CREDENTIAL_TYPE: u8 = 1;
global ZKPASSPORT_OUTER_COUNT_7_VKEY_HASH: Field =
    0x19d93a8a69386b80903a8559d884bea729dc1ecc1db48afc6d3bb73d4ed3abbe;
global ZKPASSPORT_OUTER_PUBLIC_INPUT_COUNT: u32 = 12;
global ZKPASSPORT_OUTER_PROOF_SIZE: u32 = 458;
global ZKPASSPORT_OUTER_VKEY_SIZE: u32 = 115;
global ZKPASSPORT_PROOF_TYPE_HONK_ZK: u32 = 6;
global ZKPASSPORT_MRZ_LENGTH: u32 = 90;
global ZKPASSPORT_BIND_LENGTH: u32 = 509;
global PASSPORT_DOCUMENT_TYPE: u8 = 80; // "P"
global ID_CARD_DOCUMENT_TYPE: u8 = 73; // "I"
global ZKPASSPORT_SALTED_NULLIFIER_TYPE: Field = 1;
global ZKPASSPORT_OPRF_PUBLIC_KEY_HASH: Field =
    1178201404428554206520802247552222388413553631367032661928167491793274360628;
global FACEMATCH_ENVIRONMENT_PRODUCTION: u8 = 1;
global FACEMATCH_MODE_STRICT: u8 = 2;
global APPLE_APP_ATTEST_ROOT_KEY_HASH: Field =
    0x2532418a107c5306fa8308c22255792cf77e4a290cbce8a840a642a3e591340b;
global GOOGLE_APP_ATTEST_RSA_ROOT_KEY_HASH: Field =
    0x16700a2d9168a194fc85f237af5829b5a2be05b8ae8ac4879ada34cf54a9c211;
global GOOGLE_APP_ATTEST_ECDSA_P384_ROOT_KEY_HASH: Field =
    0x0e1889bec6c1d686abcf08360ff404f803ab345881ea8cba6aad33b7f7f7ffe0;
global ZKPASSPORT_IOS_APP_ID_HASH: Field =
    0x1fa73686cf510f8f85757b0602de0dd72a13e68ae2092462be8b72662e7f179b;
global ZKPASSPORT_ANDROID_APP_ID_HASH: Field =
    0x24d9929b248be7eeecaa98e105c034a50539610f3fdd4cb9c8983ef4100d615d;
global GOOGLE_PLAY_INTEGRITY_PUBLIC_KEY_HASH: Field =
    8544227306600425492560068004835614964118871262589609739238120993689090208159;

fn contains(values: [Field; 4], expected: Field) -> bool {
    (values[0] == expected) | (values[1] == expected) | (values[2] == expected) | (values[3] == expected)
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
    facematch_root_key_leaf: Field,
    facematch_environment: u8,
    facematch_app_id_hash: Field,
    facematch_integrity_public_key_hash: Field,
    facematch_mode: u8,
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
        ZKPASSPORT_OUTER_COUNT_7_VKEY_HASH,
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
        zkpassport_outer_public_inputs[8],
    ];
    let disclose_param_commitment = calculate_disclose_param_commitment(
        disclose_mask,
        disclosed_bytes,
    );
    let age_param_commitment = calculate_age_param_commitment(age_min_bound, age_max_bound);
    let bind_param_commitment = calculate_bind_param_commitment(bind_data);
    assert(facematch_environment == FACEMATCH_ENVIRONMENT_PRODUCTION, "Facematch must use production environment");
    assert(facematch_mode == FACEMATCH_MODE_STRICT, "Facematch must use strict mode");
    let approved_root_key = (facematch_root_key_leaf == APPLE_APP_ATTEST_ROOT_KEY_HASH)
        | (facematch_root_key_leaf == GOOGLE_APP_ATTEST_RSA_ROOT_KEY_HASH)
        | (facematch_root_key_leaf == GOOGLE_APP_ATTEST_ECDSA_P384_ROOT_KEY_HASH);
    assert(approved_root_key, "Facematch attestation root is not approved");
    let is_ios_app = facematch_app_id_hash == ZKPASSPORT_IOS_APP_ID_HASH;
    let is_android_app = facematch_app_id_hash == ZKPASSPORT_ANDROID_APP_ID_HASH;
    assert(is_ios_app | is_android_app, "Facematch app ID is not zkPassport");
    let expected_integrity_public_key_hash = if is_android_app {
        GOOGLE_PLAY_INTEGRITY_PUBLIC_KEY_HASH
    } else {
        0
    };
    assert(
        facematch_integrity_public_key_hash == expected_integrity_public_key_hash,
        "Facematch integrity public key is invalid",
    );
    let facematch_param_commitment = calculate_facematch_param_commitment(
        facematch_root_key_leaf,
        facematch_environment,
        facematch_app_id_hash,
        facematch_integrity_public_key_hash,
        facematch_mode,
    );
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
    assert(
        contains(outer_param_commitments, facematch_param_commitment),
        "Facematch commitment is not authenticated by zkPassport",
    );
    assert(
        zkpassport_outer_public_inputs[9] == ZKPASSPORT_SALTED_NULLIFIER_TYPE,
        "zkPassport nullifier is not production salted",
    );
    assert(
        zkpassport_outer_public_inputs[11] == ZKPASSPORT_OPRF_PUBLIC_KEY_HASH,
        "zkPassport OPRF public key is not pinned",
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
    let scoped_nullifier = zkpassport_outer_public_inputs[10];
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
            zkpassport_outer_public_inputs[9],
            zkpassport_outer_public_inputs[11],
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
