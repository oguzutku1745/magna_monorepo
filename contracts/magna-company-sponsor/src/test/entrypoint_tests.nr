use crate::MagnaCompanySponsor;
use crate::test::setup::setup;
use aztec::protocol::{address::AztecAddress, traits::FromField};
use magna_issuer::MagnaIssuer;
use magna_lib::{
    CLAIM_AGE_MIN_PROVEN, CLAIM_NONE, compute_session_authorization, Constraint, OP_GTE, OP_NONE,
    Policy,
};
use magna_lib::InstagramCommittedClaimsWitness;
use std::hash::pedersen_hash;

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
        AztecAddress::from_field(
            0x0400000000000000000000000000000000000000000000000000000000000000,
        ),
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
    let before = env.execute_utility(MagnaCompanySponsor::at(sponsor).get_sponsored_verify_count());
    assert(before == 0, "sponsor meter should start at zero");
}

#[test(should_fail)]
unconstrained fn test_meter_only_self_cannot_be_called_externally() {
    let (mut env, sponsor, _, orchestrator, _, _, _) = setup();
    env.call_public(orchestrator, MagnaCompanySponsor::at(sponsor)._meter_sponsored_verify());
}

#[test(should_fail_with = "admin only")]
unconstrained fn test_initialize_issuer_requires_admin() {
    let (mut env, sponsor, issuer, _, _, _, attacker) = setup();
    env.call_public(attacker, MagnaCompanySponsor::at(sponsor).initialize_issuer(issuer));
}

#[test(should_fail)]
unconstrained fn test_initialize_issuer_cannot_be_reinitialized() {
    let (mut env, sponsor, issuer, orchestrator, _, _, _) = setup();
    env.call_public(orchestrator, MagnaCompanySponsor::at(sponsor).initialize_issuer(issuer));
}

#[test(should_fail_with = "admin only")]
unconstrained fn test_initialize_rights_registry_requires_admin() {
    let (mut env, sponsor, issuer, _, _, _, attacker) = setup();
    env.call_public(attacker, MagnaCompanySponsor::at(sponsor).initialize_rights_registry(issuer));
}

#[test(should_fail)]
unconstrained fn test_initialize_rights_registry_cannot_be_reinitialized() {
    let (mut env, sponsor, issuer, orchestrator, _, _, _) = setup();
    env.call_public(
        orchestrator,
        MagnaCompanySponsor::at(sponsor).initialize_rights_registry(issuer),
    );
}

#[test]
unconstrained fn test_issuer_company_gateway_accepts_linked_instagram_without_passport_authority() {
    let (env, sponsor, issuer, orchestrator, owner, ghost, consumer) = setup();
    let expiry: u64 = 1_893_456_000;
    let handle: Field = 123456;
    let blind: Field = 654321;
    let handle_commitment = pedersen_hash([0x4D414943, handle, blind]);
    let claims = pedersen_hash([0x4D414743, 2, 3, handle_commitment, expiry as Field]);
    env.call_private(orchestrator, MagnaIssuer::at(issuer).register_root(owner, ghost, 789));
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, expiry),
    );
    let source =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let root = env.call_private(owner, MagnaIssuer::at(issuer).get_root_status_hinted(owner, 789));
    env.call_private(owner, MagnaIssuer::at(issuer).link_credential_to_root(source, status, root));
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, 789, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, 789, claims),
    );
    let empty = Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 };
    let policy = Policy { credential_type: 3, constraints: [empty; 8] };
    let witness = InstagramCommittedClaimsWitness { handle_hash: handle, handle_blind: blind };
    env.call_private(sponsor, MagnaIssuer::at(issuer).verify_linked_sponsored_instagram(
        owner, policy, root, linked, linked_status, witness, 0,
    ));
    env.call_private(sponsor, MagnaIssuer::at(issuer).verify_linked_sponsored_instagram(
        owner, policy, root, linked, linked_status, witness, 1,
    ));
    assert_eq(env.execute_utility(MagnaIssuer::at(issuer).get_verify_meter_count()), 2);
}

#[test(should_fail_with = "Cannot prove nullifier non-inclusion")]
unconstrained fn test_issuer_company_gateway_rejects_converted_standalone_instagram() {
    let (env, sponsor, issuer, orchestrator, owner, ghost, consumer) = setup();
    let expiry: u64 = 1_893_456_000;
    let handle: Field = 123456;
    let blind: Field = 654321;
    let handle_commitment = pedersen_hash([0x4D414943, handle, blind]);
    let claims = pedersen_hash([0x4D414743, 2, 3, handle_commitment, expiry as Field]);
    env.call_private(orchestrator, MagnaIssuer::at(issuer).register_root(owner, ghost, 789));
    env.call_private(
        orchestrator,
        MagnaIssuer::at(issuer).register_credential(owner, ghost, claims, 3, expiry),
    );
    let source =
        env.call_private(owner, MagnaIssuer::at(issuer).get_credential_hinted(owner, claims));
    let status = env.call_private(owner, MagnaIssuer::at(issuer).get_status_hinted(owner, claims));
    let root = env.call_private(owner, MagnaIssuer::at(issuer).get_root_status_hinted(owner, 789));
    env.call_private(owner, MagnaIssuer::at(issuer).link_credential_to_root(source, status, root));
    let linked = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_credential_hinted(owner, 789, claims),
    );
    let linked_status = env.call_private(
        owner,
        MagnaIssuer::at(issuer).get_linked_status_hinted(owner, 789, claims),
    );
    let empty = Constraint { claim_id: CLAIM_NONE, op: OP_NONE, value: 0 };
    let policy = Policy { credential_type: 3, constraints: [empty; 8] };
    let witness = InstagramCommittedClaimsWitness { handle_hash: handle, handle_blind: blind };
    env.call_private(sponsor, MagnaIssuer::at(issuer).verify_sponsored_instagram(owner, policy, source, status, witness, 0));
}
