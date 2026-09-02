# Magna Issuer Contract (Noir / Aztec)

`contracts/magna-issuer/src/main.nr` implements the Magna v1 protocol core:

- Immutable orchestrator-origin enforcement for issuance.
- Atomic issuance of `CredentialNote`, `StatusNote`, and `RecoveryNote`.
- Private `verify()` with:
  - claims commitment binding (`claims_hash`)
  - multi-constraint policy evaluation via `magna-lib`
  - revocation nullifier non-inclusion proof
  - public metering enqueue
- Proof-bound rooted recovery that:
  - consumes an authenticated L1→L2 message from an immutable Ethereum recovery portal
  - binds the deployment, destination, nonce, message secret, root, claims, and credential expiry
  - spends `RootRecoveryNote` and emits the root kill-switch nullifier
  - atomically mints the complete rooted passport note set for the approved destination
- The generic rootless `recover()` entrypoint has been removed. The orchestrator has no V3
  recovery authority.

## Current assumptions

- v1 scope is zkPassport-first.
- Sender-for-tags compatibility requires tx origin from stable orchestrator account.
- Note delivery uses `ONCHAIN_UNCONSTRAINED` by default in v1.

## Verify to meter-hook wiring

- `constructor(orchestrator_address, verify_meter_hook_address)` stores an immutable
  verify meter hook address.
- `verify(...)` always enqueues local issuer metering via `_meter_verify()`.
- If `verify_meter_hook_address != AztecAddress::zero()`, `verify(...)` also enqueues
  `MagnaVerifyMeterHook::meter_verify_or_revert(credential_type)`.
- Passing `AztecAddress::zero()` disables external meter-hook wiring while keeping
  issuer-local metering active.

## Sponsored-mode rate limit (no-drain)

When `verify_meter_hook_address != 0`, `verify(...)` enters sponsored mode and emits an
additional rate-limit nullifier to bound sponsored usage:

- 24h window: `MAGNA_SPONSOR_RL_WINDOW_SECONDS = 86400`
- 5 slots per window: `MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW = 5`
- `verify(...)` takes an extra argument `sponsor_slot` in `[0..4]`
- Reusing the same slot in the same window is rejected by nullifier uniqueness

See `docs/no-drain-sponsorship.md`.

## Sponsor gateway entrypoint

`MagnaIssuer` now also exposes `verify_sponsored(caller, ...)` for dedicated
company sponsor gateway paths.

- `verify(...)` remains the direct user-call path.
- `verify_sponsored(...)` is intended to be called by `MagnaCompanySponsor`.
- `verify_sponsored(...)` checks issuer-managed gateway membership.
- Orchestrator-managed gateway lifecycle entrypoints:
  - `add_company_sponsor_gateway(...)`
  - `remove_company_sponsor_gateway(...)` (one-way disable)
  - `is_company_sponsor_gateway(...)`
- The explicit `caller` argument preserves the active-owner ownership checks even
  when the immediate `msg_sender()` is the sponsor contract.
- The issuer-side sponsored rate-limit logic still applies on this path.

## Revocation nullifier formula (spec/diagram lock)

Magna does **not** use `H(secret)` alone for revocation.

The contract computes revocation / kill-switch nullifiers as:

- `compute_revocation_nullifier(revocation_secret, credential_type, claims_hash, MAGNA_REVOCATION_DS)`
- i.e. `H(secret, credential_type, claims_hash; domain_separator)`

This is intentional domain separation:

- prevents cross-credential collisions,
- binds revocation to the exact credential commitment scope,
- keeps nullifiers unlinkable random-looking field values on-chain.

Important: this does **not** let arbitrary users revoke credentials independently.
Only a holder who can produce the required private note witness and satisfy the
contract call constraints can trigger the corresponding nullifier creation in
private execution.

### Which notes are nullified when rooted recovery runs?

Nullification is **not "all note types at once"**:

- The settled `RootRecoveryNote` is nullified in `recover_root_v3(...)`.
- The emitted root kill-switch nullifier marks the prior root lineage revoked for linked verifies.
- The canonical Inbox message is consumed exactly once; a second consumption fails.
- Old linked credential notes are not directly spent, but they cannot verify against the killed
  root lineage.

## Recovery ownership invariant

After `recover_root_v3(...)`, the rotated `RootRecoveryNote` is re-minted to
`self.msg_sender()` (Ghost owner), while `RootStatusNote` is minted to
the proof-bound destination. The same transaction also mints fresh root authority and linked
passport credential/status/recovery notes to that destination.

This is a deliberate separation of daily-use vs break-glass control.

The Ghost call presents the recovery nonce, authenticated claims and expiry, message secret, and
canonical Inbox leaf index. The contract recomputes the V3 intent and authorization from its anchor
chain/version, immutable portal, issuer address, destination, and secret hash, then consumes the
message from that portal. Neither the orchestrator nor the Magna API can create this authorization.

## TestEnvironment note

`aztec test` uses `TestEnvironment` (mocked TXE). Some utility oracle paths are
not available with the current handler. Contract entrypoint tests in this crate
avoid asserting via unsupported utility oracle checks and instead validate
revocation effects through contract behavior (e.g. post-recovery `verify` fail).

## Code organization

- `src/main.nr`: contract declaration, storage, notes, and `#[external]` entrypoints.
- `src/internal/*.nr`: claims hashing, revocation nullifier, metering helpers, constants.
- `src/test/*.nr`: `aztec test` unit tests via `TestEnvironment`.
