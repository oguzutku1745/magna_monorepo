use crate::MagnaCompanySponsor;
use crate::test::setup::setup;
use aztec::protocol::{address::AztecAddress, traits::FromField};
use magna_lib::{
    CLAIM_AGE_MIN_PROVEN,
    CLAIM_NONE,
    OP_GTE,
    OP_NONE,
    Constraint,
    Policy,
    compute_session_authorization,
};

#[test]
fn test_session_authorization_hash_matches_sdk_vector() {
    let empty = Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 };
    let policy = Policy {
        credential_type: 1,
        constraints: [
            Constraint { claim_id: CLAIM_AGE_MIN_PROVEN, op: OP_GTE, value: 18 },
            empty,
            empty,
            empty,
            empty,
            empty,
            empty,
            empty,
        ],
    };
    let actual = compute_session_authorization(
        AztecAddress::from_field(0x0400000000000000000000000000000000000000000000000000000000000000),
        0x22222222222222222222222222222222,
        0x0033333333333333333333333333333333333333333333333333333333333333,
        1800000000,
        1,
        policy,
    );
    assert(
        actual == 17750339779338875618543372302299504726590070954394071976808203118234804546074,
        "session authorization SDK/Noir vector mismatch",
    );
}

#[test]
unconstrained fn test_sponsored_verify_meter_starts_at_zero() {
    let (env, sponsor, _, _, _, _, _) = setup();
    let before = env.execute_utility(
        MagnaCompanySponsor::at(sponsor).get_sponsored_verify_count(),
    );
    assert(before == 0, "sponsor meter should start at zero");
}

#[test(should_fail)]
unconstrained fn test_meter_only_self_cannot_be_called_externally() {
    let (mut env, sponsor, _, orchestrator, _, _, _) = setup();
    env.call_public(
        orchestrator,
        MagnaCompanySponsor::at(sponsor)._meter_sponsored_verify(),
    );
}

#[test(should_fail_with = "admin only")]
unconstrained fn test_initialize_issuer_requires_admin() {
    let (mut env, sponsor, issuer, _, _, _, attacker) = setup();
    env.call_public(
        attacker,
        MagnaCompanySponsor::at(sponsor).initialize_issuer(issuer),
    );
}

#[test(should_fail)]
unconstrained fn test_initialize_issuer_cannot_be_reinitialized() {
    let (mut env, sponsor, issuer, orchestrator, _, _, _) = setup();
    env.call_public(
        orchestrator,
        MagnaCompanySponsor::at(sponsor).initialize_issuer(issuer),
    );
}

#[test(should_fail_with = "admin only")]
unconstrained fn test_initialize_rights_registry_requires_admin() {
    let (mut env, sponsor, issuer, _, _, _, attacker) = setup();
    env.call_public(
        attacker,
        MagnaCompanySponsor::at(sponsor).initialize_rights_registry(issuer),
    );
}

#[test(should_fail)]
unconstrained fn test_initialize_rights_registry_cannot_be_reinitialized() {
    let (mut env, sponsor, issuer, orchestrator, _, _, _) = setup();
    env.call_public(
        orchestrator,
        MagnaCompanySponsor::at(sponsor).initialize_rights_registry(issuer),
    );
}
