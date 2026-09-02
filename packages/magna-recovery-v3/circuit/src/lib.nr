use aztec::{
    hash::compute_secret_hash,
    protocol::hash::poseidon2_hash_with_separator,
};

pub global MAGNA_RECOVERY_V3_SCHEMA: Field = 3;
pub global MAGNA_PASSPORT_CREDENTIAL_TYPE: Field = 1;
pub global MAGNA_PASSPORT_COMMITTED_CLAIMS_SCHEMA: Field = 2;

// These domains intentionally match rooted A2 issuance. Recovery must locate
// the RootRecoveryNote already minted by issuance; V3 authorization has its
// own intent and authorization domains below.
pub global MAGNA_GHOST_DS: u32 = 0x4D414748;
pub global MAGNA_ROOT_DS: u32 = 0x4D414749;
pub global MAGNA_RECOVERY_INTENT_V3_DS: u32 = 0x4D524933;
pub global MAGNA_RECOVERY_AUTH_V3_DS: u32 = 0x4D524133;
pub global MAGNA_RECOVERY_BLIND_V3_DS: u32 = 0x4D524233;
pub global MAGNA_RECOVERY_TRUST_V3_DS: u32 = 0x4D525433;
pub global MAGNA_CLAIMS_DS: u32 = 0x4D414743;
pub global MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS: u32 = 0x4D414E43;
pub global MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS: u32 = 0x4D414558;
pub global MAGNA_RECOVERED_CREDENTIAL_MAX_AGE_SECONDS: u64 = 2592000;

pub fn compute_recovery_root_commitment(identity_value: Field) -> Field {
    poseidon2_hash_with_separator([identity_value], MAGNA_ROOT_DS)
}

pub fn compute_recovery_ghost_seed(identity_value: Field) -> Field {
    poseidon2_hash_with_separator(
        [identity_value, MAGNA_PASSPORT_CREDENTIAL_TYPE],
        MAGNA_GHOST_DS,
    )
}

pub fn compute_recovery_intent(
    ethereum_chain_id: Field,
    recovery_portal_l1_address: Field,
    aztec_protocol_version: Field,
    aztec_chain_id: Field,
    issuer_l2_address: Field,
    destination: Field,
    recovery_nonce: Field,
    message_secret_hash: Field,
) -> Field {
    poseidon2_hash_with_separator(
        [
            MAGNA_RECOVERY_V3_SCHEMA,
            ethereum_chain_id,
            recovery_portal_l1_address,
            aztec_protocol_version,
            aztec_chain_id,
            issuer_l2_address,
            destination,
            recovery_nonce,
            message_secret_hash,
        ],
        MAGNA_RECOVERY_INTENT_V3_DS,
    )
}

pub fn compute_recovery_blind(identity_value: Field, recovery_nonce: Field, kind: Field) -> Field {
    poseidon2_hash_with_separator(
        [MAGNA_RECOVERY_V3_SCHEMA, identity_value, recovery_nonce, kind],
        MAGNA_RECOVERY_BLIND_V3_DS,
    )
}

pub fn compute_recovery_claims_hash(
    nationality_alpha3_packed: Field,
    min_age_proven: u8,
    passport_expiry: u64,
    nationality_blind: Field,
    expiry_blind: Field,
) -> Field {
    let nationality_commitment = poseidon2_hash_with_separator(
        [nationality_alpha3_packed, nationality_blind],
        MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
    );
    let expiry_commitment = poseidon2_hash_with_separator(
        [passport_expiry as Field, expiry_blind],
        MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
    );
    poseidon2_hash_with_separator(
        [
            MAGNA_PASSPORT_COMMITTED_CLAIMS_SCHEMA,
            MAGNA_PASSPORT_CREDENTIAL_TYPE,
            nationality_commitment,
            min_age_proven as Field,
            expiry_commitment,
        ],
        MAGNA_CLAIMS_DS,
    )
}

pub fn compute_recovered_credential_valid_until(
    passport_expiry: u64,
    proof_current_date: u64,
) -> u64 {
    let policy_expiry = proof_current_date + MAGNA_RECOVERED_CREDENTIAL_MAX_AGE_SECONDS;
    if passport_expiry < policy_expiry { passport_expiry } else { policy_expiry }
}

pub fn compute_recovery_authorization(
    recovery_intent: Field,
    root_commitment: Field,
    claims_hash: Field,
    credential_valid_until: u64,
) -> Field {
    poseidon2_hash_with_separator(
        [
            MAGNA_RECOVERY_V3_SCHEMA,
            recovery_intent,
            root_commitment,
            claims_hash,
            credential_valid_until as Field,
        ],
        MAGNA_RECOVERY_AUTH_V3_DS,
    )
}

pub fn compute_recovery_trust_context(
    ethereum_chain_id: Field,
    recovery_portal_l1_address: Field,
    aztec_protocol_version: Field,
    aztec_chain_id: Field,
    issuer_l2_address: Field,
    service_scope_hash: Field,
    service_subscope_hash: Field,
    nullifier_type: Field,
    oprf_public_key_hash: Field,
    recovery_wrapper_version: Field,
) -> Field {
    let is_production_salted = (nullifier_type == 1) & (oprf_public_key_hash != 0);
    let is_development_non_salted_mock =
        (nullifier_type == 2) & (oprf_public_key_hash == 0);
    assert(
        is_production_salted | is_development_non_salted_mock,
        "Invalid recovery identifier profile",
    );
    poseidon2_hash_with_separator(
        [
            MAGNA_RECOVERY_V3_SCHEMA,
            ethereum_chain_id,
            recovery_portal_l1_address,
            aztec_protocol_version,
            aztec_chain_id,
            issuer_l2_address,
            service_scope_hash,
            service_subscope_hash,
            nullifier_type,
            oprf_public_key_hash,
            recovery_wrapper_version,
        ],
        MAGNA_RECOVERY_TRUST_V3_DS,
    )
}

fn hex_ascii(nibble: u8) -> u8 {
    if nibble < 10 { 48 + nibble } else { 87 + nibble }
}

// Exact zkPassport utils 0.37.3 formatBoundData({ custom_data }) bytes,
// right-padded to the Bind circuit's fixed 509-byte input.
pub fn format_recovery_bind_data(recovery_intent: Field) -> [u8; 509] {
    let mut result = [0 as u8; 509];
    result[0] = 3; // BoundDataIdentifier.CUSTOM_DATA
    result[1] = 0;
    result[2] = 82; // 18-byte prefix + 64 lowercase hexadecimal bytes
    let prefix: [u8; 18] = [
        109, 97, 103, 110, 97, 45, 114, 101, 99,
        111, 118, 101, 114, 121, 45, 118, 51, 58,
    ];
    for i in 0..18 {
        result[3 + i] = prefix[i];
    }
    let intent_bytes: [u8; 32] = recovery_intent.to_be_bytes();
    for i in 0..32 {
        result[21 + i * 2] = hex_ascii(intent_bytes[i] >> 4);
        result[22 + i * 2] = hex_ascii(intent_bytes[i] & 15);
    }
    result
}

#[test]
unconstrained fn recovery_v3_matches_typescript_golden_vector() {
    let message_secret_hash = compute_secret_hash([8]);
    assert_eq(
        message_secret_hash,
        10983938823970359692003842531941101377775130826861974616012302461719711391382,
    );

    let intent = compute_recovery_intent(
        31337,
        0x1234567890abcdef1234567890abcdef12345678,
        1,
        31337,
        0x1111,
        0x2222,
        0x3333,
        message_secret_hash,
    );
    assert_eq(intent, 5474976148921522764420130091996206529131183100560975976829770183465866711491);

    let root = compute_recovery_root_commitment(0x7777);
    assert(root != 0);
    assert(compute_recovery_ghost_seed(0x7777) != 0);

    let nationality_blind = compute_recovery_blind(0x7777, 0x3333, 1);
    let expiry_blind = compute_recovery_blind(0x7777, 0x3333, 2);
    assert_eq(
        nationality_blind,
        10356017180456265170667965686771862952263855199624596613860768450757522474488,
    );
    assert_eq(
        expiry_blind,
        5499853263927601870025696450358581933214405796321835855644243059641794685628,
    );
    let claims_hash = compute_recovery_claims_hash(
        0x555341,
        18,
        1831536000,
        nationality_blind,
        expiry_blind,
    );
    assert_eq(claims_hash, 412262879532960777775242603296395260267716737964617541260190438038428007927);
    let valid_until = compute_recovered_credential_valid_until(1831536000, 1800000000);
    assert_eq(valid_until, 1802592000);
    assert_eq(
        compute_recovery_authorization(intent, root, claims_hash, valid_until),
        220811261868622285676720366750850506129031796867418072377257707832340041158,
    );

    let bind_data = format_recovery_bind_data(intent);
    assert_eq(bind_data[0], 3);
    assert_eq(bind_data[2], 82);
    assert_eq(bind_data[21], 48); // first hex byte: "0"
    assert_eq(bind_data[84], 51); // final hex byte: "3"
    assert_eq(bind_data[85], 0);
}

#[test]
unconstrained fn recovery_v3_trust_context_matches_typescript() {
    let trust = compute_recovery_trust_context(
        31337,
        0x1234567890abcdef1234567890abcdef12345678,
        1,
        31337,
        0x1111,
        288835684222998702048621491676880786886776407269399176652428780953936514585,
        262643195942317248622974549834351092228754893331442909402367002913575669143,
        1,
        1178201404428554206520802247552222388413553631367032661928167491793274360628,
        1,
    );
    assert_eq(trust, 15566801594253113084049812527739827595382159007829037007465386694684186060403);
}

#[test]
unconstrained fn recovery_v3_accepts_only_the_isolated_developer_identifier_pair() {
    let trust = compute_recovery_trust_context(
        31337,
        0x1234567890abcdef1234567890abcdef12345678,
        1,
        31337,
        0x1111,
        288835684222998702048621491676880786886776407269399176652428780953936514585,
        262643195942317248622974549834351092228754893331442909402367002913575669143,
        2,
        0,
        1,
    );
    assert(trust != 0);
}
