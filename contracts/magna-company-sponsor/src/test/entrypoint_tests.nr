use crate::MagnaCompanySponsor;
use crate::test::setup::setup;

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
