use date::Date;
use magna_recovery_v3_protocol::{
    MAGNA_RECOVERY_V3_SCHEMA,
    compute_recovered_credential_valid_until,
    compute_recovery_authorization,
    compute_recovery_blind,
    compute_recovery_claims_hash,
    compute_recovery_intent,
    compute_recovery_root_commitment,
    compute_recovery_trust_context,
    format_recovery_bind_data,
};
use std::verify_proof_with_type;
use zkpassport_age::calculate_param_commitment as calculate_age_param_commitment;
use zkpassport_bind::calculate_param_commitment as calculate_bind_param_commitment;
use zkpassport_disclose::calculate_param_commitment as calculate_disclose_param_commitment;
use zkpassport_facematch::param_commit::calculate_param_commitment as calculate_facematch_param_commitment;

global RECOVERY_WRAPPER_VERSION: Field = 1;
global ZKPASSPORT_OUTER_COUNT_7_VKEY_HASH: Field =
    0x19d93a8a69386b80903a8559d884bea729dc1ecc1db48afc6d3bb73d4ed3abbe;
global ZKPASSPORT_OUTER_PUBLIC_INPUT_COUNT: u32 = 12;
global ZKPASSPORT_OUTER_PROOF_SIZE: u32 = 458;
global ZKPASSPORT_OUTER_VKEY_SIZE: u32 = 115;
global ZKPASSPORT_PROOF_TYPE_HONK_ZK: u32 = 6;
global ZKPASSPORT_MRZ_LENGTH: u32 = 90;
global PASSPORT_DOCUMENT_TYPE: u8 = 80; // "P"
global ID_CARD_DOCUMENT_TYPE: u8 = 73; // "I"
global ZKPASSPORT_NON_SALTED_MOCK_NULLIFIER_TYPE: Field = 2;
global ZKPASSPORT_NO_OPRF_PUBLIC_KEY_HASH: Field = 0;
global FACEMATCH_ENVIRONMENT_PRODUCTION: u8 = 1;
global FACEMATCH_MODE_REGULAR: u8 = 1;
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

fn main(
    zkpassport_outer_vkey: [Field; ZKPASSPORT_OUTER_VKEY_SIZE],
    zkpassport_outer_proof: [Field; ZKPASSPORT_OUTER_PROOF_SIZE],
    zkpassport_outer_public_inputs: [Field; ZKPASSPORT_OUTER_PUBLIC_INPUT_COUNT],
    disclose_mask: [bool; ZKPASSPORT_MRZ_LENGTH],
    disclosed_bytes: [u8; ZKPASSPORT_MRZ_LENGTH],
    nationality: [u8; 3],
    expiry_mrz: [u8; 6],
    min_age_proven: u8,
    age_min_bound: u8,
    age_max_bound: u8,
    facematch_root_key_leaf: Field,
    facematch_environment: u8,
    facematch_app_id_hash: Field,
    facematch_integrity_public_key_hash: Field,
    facematch_mode: u8,
    ethereum_chain_id: Field,
    recovery_portal_l1_address: Field,
    aztec_protocol_version: Field,
    aztec_chain_id: Field,
    issuer_l2_address: Field,
    destination: Field,
    recovery_nonce: Field,
    message_secret_hash: Field,
    recovery_wrapper_version: Field,
) -> pub [Field; 7] {
    verify_proof_with_type(
        zkpassport_outer_vkey,
        zkpassport_outer_proof,
        zkpassport_outer_public_inputs,
        ZKPASSPORT_OUTER_COUNT_7_VKEY_HASH,
        ZKPASSPORT_PROOF_TYPE_HONK_ZK,
    );

    assert(recovery_wrapper_version == RECOVERY_WRAPPER_VERSION, "Unsupported recovery wrapper version");
    assert(ethereum_chain_id != 0, "Ethereum chain ID is required");
    assert(recovery_portal_l1_address != 0, "Recovery portal is required");
    assert(aztec_protocol_version != 0, "Aztec protocol version is required");
    assert(aztec_chain_id != 0, "Aztec chain ID is required");
    assert(issuer_l2_address != 0, "Issuer is required");
    assert(destination != 0, "Recovery destination is required");
    assert(recovery_nonce != 0, "Recovery nonce is required");
    assert(message_secret_hash != 0, "Inbox message secret hash is required");
    assert(
        (age_max_bound == 0) | (age_max_bound >= age_min_bound),
        "Invalid age predicate bounds",
    );
    assert(min_age_proven == age_min_bound, "minAgeProven must equal authenticated lower bound");

    assert_disclosed_claims(disclose_mask, disclosed_bytes, nationality, expiry_mrz);

    let proof_current_date = zkpassport_outer_public_inputs[2] as u64;
    let passport_expiry = canonical_expiry_timestamp(expiry_mrz, proof_current_date);
    let outer_param_commitments = [
        zkpassport_outer_public_inputs[5],
        zkpassport_outer_public_inputs[6],
        zkpassport_outer_public_inputs[7],
        zkpassport_outer_public_inputs[8],
    ];
    let disclose_param_commitment = calculate_disclose_param_commitment(disclose_mask, disclosed_bytes);
    let age_param_commitment = calculate_age_param_commitment(age_min_bound, age_max_bound);

    assert(facematch_environment == FACEMATCH_ENVIRONMENT_PRODUCTION, "Facematch must use production environment");
    assert(facematch_mode == FACEMATCH_MODE_REGULAR, "Developer facematch must use regular mode");
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

    let identity_value = zkpassport_outer_public_inputs[10];
    assert(identity_value != 0, "zkPassport identity value is required");
    assert(
        zkpassport_outer_public_inputs[9] == ZKPASSPORT_NON_SALTED_MOCK_NULLIFIER_TYPE,
        "zkPassport nullifier is not official non-salted mock",
    );
    assert(
        zkpassport_outer_public_inputs[11] == ZKPASSPORT_NO_OPRF_PUBLIC_KEY_HASH,
        "Non-salted zkPassport proof must not carry an OPRF public key",
    );

    let recovery_intent = compute_recovery_intent(
        ethereum_chain_id,
        recovery_portal_l1_address,
        aztec_protocol_version,
        aztec_chain_id,
        issuer_l2_address,
        destination,
        recovery_nonce,
        message_secret_hash,
    );
    let bind_data = format_recovery_bind_data(recovery_intent);
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
        "Recovery intent is not authenticated by zkPassport Bind",
    );
    assert(
        contains(outer_param_commitments, facematch_param_commitment),
        "Facematch commitment is not authenticated by zkPassport",
    );

    let root_commitment = compute_recovery_root_commitment(identity_value);
    let nationality_blind = compute_recovery_blind(identity_value, recovery_nonce, 1);
    let expiry_blind = compute_recovery_blind(identity_value, recovery_nonce, 2);
    let claims_hash = compute_recovery_claims_hash(
        pack_alpha3(nationality),
        min_age_proven,
        passport_expiry,
        nationality_blind,
        expiry_blind,
    );
    let credential_valid_until = compute_recovered_credential_valid_until(
        passport_expiry,
        proof_current_date,
    );
    let authorization = compute_recovery_authorization(
        recovery_intent,
        root_commitment,
        claims_hash,
        credential_valid_until,
    );
    let trust_context = compute_recovery_trust_context(
        ethereum_chain_id,
        recovery_portal_l1_address,
        aztec_protocol_version,
        aztec_chain_id,
        issuer_l2_address,
        zkpassport_outer_public_inputs[3],
        zkpassport_outer_public_inputs[4],
        zkpassport_outer_public_inputs[9],
        zkpassport_outer_public_inputs[11],
        recovery_wrapper_version,
    );

    [
        MAGNA_RECOVERY_V3_SCHEMA,
        authorization,
        message_secret_hash,
        proof_current_date as Field,
        zkpassport_outer_public_inputs[0],
        zkpassport_outer_public_inputs[1],
        trust_context,
    ]
}
