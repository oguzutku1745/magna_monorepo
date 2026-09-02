use aztec::protocol::traits::{Deserialize, Serialize};

pub global MAX_CONSTRAINTS: u32 = 8;

// Claim IDs (v1)
pub global CLAIM_NONE: u8 = 0;
pub global CLAIM_AGE_MIN_PROVEN: u8 = 1;
pub global CLAIM_NATIONALITY_ALPHA3: u8 = 2;
pub global CLAIM_EXPIRY_TS: u8 = 3;
pub global CLAIM_INSTAGRAM_HANDLE_HASH: u8 = 4;

// Operators (v1)
pub global OP_NONE: u8 = 0;
pub global OP_EQ: u8 = 1;
pub global OP_NEQ: u8 = 2;
pub global OP_GTE: u8 = 3;
pub global OP_LTE: u8 = 4;

#[derive(Serialize, Deserialize)]
pub struct Constraint {
    pub claim_id: u8,
    pub op: u8,
    pub value: Field,
}

#[derive(Serialize, Deserialize)]
pub struct Policy {
    pub credential_type: u8,
    pub constraints: [Constraint; MAX_CONSTRAINTS],
}

#[derive(Serialize, Deserialize)]
pub struct PassportClaims {
    pub min_age_proven: u8,
    pub nationality_alpha3_packed: Field,
    pub expiry_ts: u64,
}

#[derive(Serialize, Deserialize)]
pub struct PassportCommittedClaimsWitness {
    pub min_age_proven: u8,
    pub nationality_alpha3_packed: Field,
    pub nationality_blind: Field,
    pub expiry_ts: u64,
    pub expiry_blind: Field,
}

#[derive(Serialize, Deserialize)]
pub struct InstagramClaims {
    pub handle_hash: Field,
    pub expiry_ts: u64,
}

#[derive(Serialize, Deserialize)]
pub struct InstagramCommittedClaimsWitness {
    pub handle_hash: Field,
    pub handle_blind: Field,
}

fn compare_field(lhs: Field, op: u8, rhs: Field) -> bool {
    if op == OP_EQ {
        lhs == rhs
    } else if op == OP_NEQ {
        lhs != rhs
    } else {
        false
    }
}

fn compare_u8(lhs: u8, op: u8, rhs_field: Field) -> bool {
    let rhs = rhs_field as u8;
    if op == OP_EQ {
        lhs == rhs
    } else if op == OP_NEQ {
        lhs != rhs
    } else if op == OP_GTE {
        lhs >= rhs
    } else if op == OP_LTE {
        lhs <= rhs
    } else {
        false
    }
}

fn compare_u64(lhs: u64, op: u8, rhs_field: Field) -> bool {
    let rhs = rhs_field as u64;
    if op == OP_EQ {
        lhs == rhs
    } else if op == OP_NEQ {
        lhs != rhs
    } else if op == OP_GTE {
        lhs >= rhs
    } else if op == OP_LTE {
        lhs <= rhs
    } else {
        false
    }
}

fn evaluate_passport_constraint(claims: PassportClaims, c: Constraint) -> bool {
    if c.claim_id == CLAIM_NONE {
        true
    } else if c.op == OP_NONE {
        true
    } else if c.claim_id == CLAIM_AGE_MIN_PROVEN {
        compare_u8(claims.min_age_proven, c.op, c.value)
    } else if c.claim_id == CLAIM_NATIONALITY_ALPHA3 {
        compare_field(claims.nationality_alpha3_packed, c.op, c.value)
    } else if c.claim_id == CLAIM_EXPIRY_TS {
        compare_u64(claims.expiry_ts, c.op, c.value)
    } else {
        false
    }
}

pub fn require_policy_matches_passport(policy: Policy, expected_credential_type: u8, claims: PassportClaims) {
    assert(policy.credential_type == expected_credential_type, "credential type mismatch");

    for i in 0..MAX_CONSTRAINTS {
        let c = policy.constraints[i];
        assert(evaluate_passport_constraint(claims, c), "policy constraint failed");
    }
}

fn evaluate_instagram_constraint(claims: InstagramClaims, c: Constraint) -> bool {
    if c.claim_id == CLAIM_NONE {
        true
    } else if c.op == OP_NONE {
        true
    } else if c.claim_id == CLAIM_INSTAGRAM_HANDLE_HASH {
        compare_field(claims.handle_hash, c.op, c.value)
    } else if c.claim_id == CLAIM_EXPIRY_TS {
        compare_u64(claims.expiry_ts, c.op, c.value)
    } else {
        false
    }
}

pub fn require_policy_matches_instagram(policy: Policy, expected_credential_type: u8, claims: InstagramClaims) {
    assert(policy.credential_type == expected_credential_type, "credential type mismatch");

    for i in 0..MAX_CONSTRAINTS {
        let c = policy.constraints[i];
        assert(evaluate_instagram_constraint(claims, c), "policy constraint failed");
    }
}

pub fn pack_alpha3(c0: u8, c1: u8, c2: u8) -> Field {
    // ASCII bytes packed into one field: (c0 << 16) | (c1 << 8) | c2
    ((c0 as Field) * 65536) + ((c1 as Field) * 256) + (c2 as Field)
}
