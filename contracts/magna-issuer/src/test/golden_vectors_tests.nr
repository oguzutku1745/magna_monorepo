use crate::internal::{
    claims::compute_passport_claims_hash,
    constants::{MAGNA_CLAIMS_DS, MAGNA_GHOST_DS, MAGNA_REVOCATION_DS, SCHEMA_VERSION_V1},
    revocation::compute_revocation_nullifier,
};
use crate::test::generated_golden_vectors::{
    GOLDEN_CLAIMS_HASH,
    GOLDEN_GHOST_SEED,
    GOLDEN_REVOCATION_NULLIFIER,
    GOLDEN_REVOCATION_SECRET,
    GOLDEN_UNIQUE_IDENTIFIER,
};
use aztec::protocol::hash::poseidon2_hash_with_separator;
use magna_lib::pack_alpha3;

#[test]
unconstrained fn test_golden_claims_hash_matches_vector() {
    let computed = compute_passport_claims_hash(
        SCHEMA_VERSION_V1,
        1,
        pack_alpha3(67, 65, 78), // "CAN"
        21,
        1_893_456_000,
        MAGNA_CLAIMS_DS,
    );
    assert(computed == GOLDEN_CLAIMS_HASH, "claims hash vector mismatch");
}

#[test]
unconstrained fn test_golden_revocation_nullifier_matches_vector() {
    let computed = compute_revocation_nullifier(
        GOLDEN_REVOCATION_SECRET,
        1,
        GOLDEN_CLAIMS_HASH,
        MAGNA_REVOCATION_DS,
    );
    assert(computed == GOLDEN_REVOCATION_NULLIFIER, "revocation nullifier vector mismatch");
}

#[test]
unconstrained fn test_golden_ghost_seed_matches_poseidon_unique_identifier_formula() {
    let computed = poseidon2_hash_with_separator([GOLDEN_UNIQUE_IDENTIFIER], MAGNA_GHOST_DS);
    assert(computed == GOLDEN_GHOST_SEED, "ghost seed vector mismatch");
}
