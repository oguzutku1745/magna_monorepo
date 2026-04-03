# Magna v1 Test Plan

## Unit-level checks

1. Claims hash determinism
   - same canonical payload => same `claims_hash`
   - schema/version changes => different `claims_hash`
- Instagram handle changes => different Instagram `claims_hash`
2. Policy normalization
   - constraint padding to `MAX_CONSTRAINTS`
   - reject overflow policies
3. Alpha-3 packing
   - valid uppercase alpha-3 only
   - deterministic packed field
4. Ghost derivation
   - same `(uniqueIdentifier, scope)` => same output
   - different scope/type => different output

## Contract behavior checks

1. Issuance authorization
   - success only when `msg_sender == ORCHESTRATOR_ADDRESS`
2. 3-note issuance
   - credential + status to active owner
   - recovery to ghost owner
3. Rooted passport issuance
   - `registerRootedPassport(...)` mints root status/recovery, root authority, and the current linked passport lineage
4. Root authority behavior
   - linked passport verify requires a matching live `RootAuthorityNote`
   - linked Instagram verify requires a live unexpired `RootAuthorityNote`
   - refreshing authority rotates the old authority nullifier and mints a fresh linked passport lineage
   - stale authority hints fail after refresh
5. Verify path
   - rejects mismatched claims hash
   - passes multi-constraint policy (e.g. age>=18 AND country!=USA)
   - rejects revoked status (revocation nullifier exists)
- Instagram verify passes when `handle_hash` matches the issued credential
- Instagram verify rejects when the witness `handle_hash` differs
6. Recovery path
   - spends `RecoveryNote`
   - emits kill-switch nullifier
   - remints fresh status/recovery and optional credential refresh
7. Root outcomes
   - `recover_root(...)` disables old linked descendants
   - passport-expiry-only flow pauses linked validity until authority refresh
   - linked Instagram remains usable after authority refresh with the fresh rooted passport authority

## Sponsorship / no-drain checks (Option A)

1. Public metering hook hardening (`MagnaVerifyMeterHook`)
   - `meter_verify_or_revert` is issuer-only
   - `meter_verify_or_revert` is meter-only (no eligibility reverts)
2. Sponsored verify rate limit (issuer-side)
   - in sponsored mode, `verify()` accepts exactly 5 calls per 24h window per credential (slot 0..4)
   - the 6th call in same window is rejected due to duplicate rate-limit nullifier
   - `sponsor_slot >= 5` is rejected
3. Sponsored verify wiring
   - in sponsored mode, `verify()` enqueues `MagnaVerifyMeterHook.meter_verify_or_revert` and succeeds when issuer is configured
   - direct external calls to the policy hook from non-issuer are rejected
4. Company sponsor gateway
   - `MagnaCompanySponsor` meter starts at zero and its public meter is `only_self`
   - `MagnaIssuer.verify_sponsored(...)` accepts only the configured company sponsor gateway
   - the explicit `caller` argument must still match the hinted note owners
   - the opt-in live e2e suite covers funded sponsor success, over-budget rejection, and unfunded sponsor rejection when run with `AZTEC_E2E=1`
   - the opt-in live e2e suite covers `sponsored_verify_linked_instagram(...)` when run with `AZTEC_E2E=1`
   - these live e2e paths are not part of default `test:ci` today

## Adversarial tests

1. Replay
   - replaying spent `RecoveryNote` fails
2. Cross-credential collision attempts
   - same `RS` across differing `(credential_type, claims_hash)` must produce distinct revocation nullifiers due DS inputs
3. Unauthorized issuance
   - non-orchestrator issuance attempt fails
4. Expired credential inclusion
   - tx inclusion after `expiry_ts` is blocked via expiration/public time checks
5. Root authority renewal safety
   - stale passport authority hints fail after a successful refresh
   - generic `revoke_linked_credential(...)` must reject passport authority lineage

## Performance/constraint tracking

- Record proving time and constraint deltas for:
  - baseline verify (single constraint)
  - verify with 2, 4, 8 constraints
  - recovery transaction
