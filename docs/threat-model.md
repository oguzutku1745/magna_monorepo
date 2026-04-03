# Magna v1 Threat Model

## Security goals

1. Keep underlying identity data private while enabling policy checks.
2. Enforce active-owner revocation without public user registries.
3. Support lost-everything recovery without Magna custody of user secrets.
4. Keep issuance authority tightly scoped to a stable orchestrator origin.

## Trust boundaries

- **User device / PXE**: private witness generation, private proving, local secrets.
- **Magna issuer/orchestrator account**: trusted issuance origin for note tagging and contract authorization.
- **Issuer contract**: enforces acceptance and note semantics; does not trust arbitrary callers.
- **Aztec sequencer/node**: executes public phase and state inclusion, but should not learn private witness values.

## Assets

- `revocation_secret` (`RS`) in `StatusNote`/`RecoveryNote`
- root revocation secret in `RootStatusNote`/`RootRecoveryNote`
- `claims_hash` commitment
- `root_commitment` (opaque linked-identity handle)
- Ghost derivation inputs (`uniqueIdentifier`, scope)
- orchestrator authorization keys

## Adversaries and mitigations

### A1. Unauthorized issuance attempts

- **Risk**: attacker calls issue entrypoint and mints fake credentials.
- **Mitigation**: immutable acceptance rule in issuer contract:
  - `assert(self.msg_sender() == ORCHESTRATOR_ADDRESS)`

### A2. Linkability via public registries

- **Risk**: stable public credential registry correlates user actions.
- **Mitigation**: no public per-user credential index; only private notes + nullifiers.

### A3. Recovery discovery failure

- **Risk**: new device cannot discover `RecoveryNote`.
- **Mitigation**: Option A sender-for-tags design:
  - issuance tx originates from stable orchestrator account
  - new PXE registers that known sender and scans tags

### A4. False revocation/non-revocation checks

- **Risk**: stale or weak revocation signal.
- **Mitigation**:
  - kill-switch nullifier emitted by spending `RecoveryNote`
  - `verify()` proves non-inclusion of
    - `N = H(MAGNA_REVOCATION_DS, RS, credential_type, claims_hash)`
  - use Aztec history nullifier non-inclusion primitives

For linked credentials:

- credential-specific lineage uses
  - `N_linked = H(MAGNA_REVOCATION_DS, RS, credential_type, claims_hash)`
- shared root lineage uses
  - `N_root = H(MAGNA_ROOT_REVOCATION_DS, RS_root, root_commitment)`
- `verify_linked()` proves non-inclusion of **both** nullifiers.

### A5. Ghost derivation leakage

- **Risk**: leaked `uniqueIdentifier` enables Ghost key derivation.
- **Mitigation**:
  - treat `uniqueIdentifier` as sensitive
  - never log/store/transmit off-device
  - use explicit scoped derivation `magna_recovery::<credential_type>`
  - track migration path to salted identifiers when available

### A5b. Root linkage leakage

- **Risk**: exposing raw `uniqueIdentifier` or a public global registry creates stable cross-credential linkage.
- **Mitigation**:
  - do not place raw `uniqueIdentifier` onchain
  - use a private opaque `root_commitment`
  - keep root linkage entirely inside private note payloads / private proving flow
  - avoid public registries keyed by root identity handles

### A5c. Over-revocation vs under-revocation

- **Risk**: revoking one linked credential accidentally disables all credentials, or a root revocation fails to disable
  its linked descendants.
- **Mitigation**:
  - separate root nullifier domain from credential nullifier domain
  - separate root recovery flow from credential recovery flow
  - linked verifies require both the credential-specific lineage and the shared root lineage
  - rootless credentials remain explicitly root-independent by entrypoint and note type

### A6. Orchestrator signer compromise

- **Risk**: malicious issuance from compromised signer.
- **Mitigation**:
  - keep orchestrator address stable
  - rotate signing/auth policy in orchestrator account contract
  - optional pause controls and incident response runbook

### A7. Fee sponsorship draining (sponsor drainer)

- **Risk**: if the platform sponsors fees for `verify()`, an attacker tries to drain the sponsor by:
  - **revert-burn**: causing txs to be valid enough to be included, but revert in public execution
  - **valid spam**: repeatedly calling valid sponsored `verify()` unboundedly
- **Mitigation (Option A: structural allowlist + private eligibility + rate-limit nullifier)**:
  - sponsorship is structurally tied to `MagnaIssuer.verify()` (by construction it only sponsors `verify`)
  - eligibility checks are enforced in **private** (fail during proving → no tx → sponsor pays 0)
  - sponsored verifies emit a **rate-limit nullifier** (5 per 24h window), bounding sponsored usage
  - any external public metering hook is **issuer-only + meter-only** to avoid public revert surfaces

See: `docs/no-drain-sponsorship.md`.

## Data minimization (what Magna does NOT store)

- Raw passport chip data
- Raw birthdate unless explicitly needed for local checks
- User private keys or protocol keys
- Recovery secrets (`RS`)
- Plain `uniqueIdentifier` values or public registries keyed by them
- Global user registry linking identities to addresses

## Residual risks

- Node metadata leakage from query patterns (Aztec-known tradeoff)
- Unconstrained randomness oracle assumptions for note blinding
- Upstream protocol changes in Aztec devnet versions
