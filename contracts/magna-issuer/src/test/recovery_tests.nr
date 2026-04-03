use crate::internal::{
    constants::MAGNA_REVOCATION_DS,
    revocation::compute_revocation_nullifier,
};

#[test]
unconstrained fn test_recovery_kill_switch_nullifier_is_deterministic() {
    let n1 = compute_revocation_nullifier(123 as Field, 1, 456 as Field, MAGNA_REVOCATION_DS);
    let n2 = compute_revocation_nullifier(123 as Field, 1, 456 as Field, MAGNA_REVOCATION_DS);
    assert(n1 == n2, "kill switch nullifier should be deterministic");
}

#[test]
unconstrained fn test_recovery_fresh_secret_changes_kill_switch_nullifier() {
    let old_n = compute_revocation_nullifier(123 as Field, 1, 456 as Field, MAGNA_REVOCATION_DS);
    let new_n = compute_revocation_nullifier(124 as Field, 1, 456 as Field, MAGNA_REVOCATION_DS);
    assert(old_n != new_n, "fresh revocation secret must rotate nullifier");
}

#[test]
unconstrained fn test_recovery_scope_is_bound_to_type_and_claims_hash() {
    let base = compute_revocation_nullifier(123 as Field, 1, 456 as Field, MAGNA_REVOCATION_DS);
    let different_type = compute_revocation_nullifier(123 as Field, 2, 456 as Field, MAGNA_REVOCATION_DS);
    let different_claims = compute_revocation_nullifier(123 as Field, 1, 457 as Field, MAGNA_REVOCATION_DS);

    assert(base != different_type, "credential type must domain-separate nullifier");
    assert(base != different_claims, "claims hash must domain-separate nullifier");
}
