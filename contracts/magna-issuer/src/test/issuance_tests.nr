use crate::MagnaIssuer;
use crate::internal::{
    constants::{MAGNA_PASSPORT_ISSUANCE_DS, SCHEMA_VERSION_V2},
    issuance::compute_passport_issuance_nullifier,
};
use crate::test::setup::setup;

#[test]
unconstrained fn test_orchestrator_can_register_credential() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential(
            active_owner,
            ghost_owner,
            123 as Field,
            1,
            1_893_456_000,
        ),
    );
}

#[test]
unconstrained fn test_orchestrator_can_register_credential_v2() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_credential_v2(
            active_owner,
            ghost_owner,
            123 as Field,
            1,
            1_893_456_000,
        ),
    );
}

#[test(should_fail_with = "orchestrator required")]
unconstrained fn test_non_orchestrator_cannot_register_credential() {
    let (mut env, contract_address, _, active_owner, ghost_owner, attacker) = setup();

    env.call_private(
        attacker,
        MagnaIssuer::at(contract_address).register_credential(
            active_owner,
            ghost_owner,
            123 as Field,
            1,
            1_893_456_000,
        ),
    );
}

#[test]
unconstrained fn test_orchestrator_can_register_rooted_passport_v2() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, _) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_rooted_passport_v2(
            active_owner,
            ghost_owner,
            777 as Field,
            123 as Field,
            1_893_456_000,
        ),
    );
}

#[test]
unconstrained fn test_passport_issuance_nullifier_is_stable_and_identity_bound() {
    let first = compute_passport_issuance_nullifier(
        777 as Field,
        SCHEMA_VERSION_V2,
        1,
        MAGNA_PASSPORT_ISSUANCE_DS,
    );
    let same_identity = compute_passport_issuance_nullifier(
        777 as Field,
        SCHEMA_VERSION_V2,
        1,
        MAGNA_PASSPORT_ISSUANCE_DS,
    );
    let different_identity = compute_passport_issuance_nullifier(
        778 as Field,
        SCHEMA_VERSION_V2,
        1,
        MAGNA_PASSPORT_ISSUANCE_DS,
    );
    let expected = 0x15b7451870baee966e01244f899f7d603a8c8ad7ea38f2df0cdbe461d61b8830;

    assert(first == expected, "issuance nullifier must match the TypeScript golden vector");
    assert(first == same_identity, "same passport identity must reuse issuance nullifier");
    assert(first != different_identity, "different passport identity must use a different issuance nullifier");
}

#[test]
unconstrained fn test_rooted_passport_v2_allows_different_identities() {
    let (mut env, contract_address, orchestrator, active_owner, ghost_owner, attacker) = setup();

    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_rooted_passport_v2(
            active_owner,
            ghost_owner,
            777 as Field,
            123 as Field,
            1_893_456_000,
        ),
    );
    env.call_private(
        orchestrator,
        MagnaIssuer::at(contract_address).register_rooted_passport_v2(
            attacker,
            ghost_owner,
            778 as Field,
            456 as Field,
            1_893_456_001,
        ),
    );
}
