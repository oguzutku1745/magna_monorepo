# Magna Threat Model

**Status:** pre-release, not deployed to a public network. This document reflects the A2 recursive
PII-blind passport architecture, which supersedes A1. Every control below carries an explicit
status. §6 lists what is still open; §7 records what has been resolved.

Companion documents: [`protocol-spec.md`](./protocol-spec.md) (mechanics),
[`integration-guide.md`](./integration-guide.md) (dApp-facing surface).

---

## 1. Security goals

1. Keep underlying identity data private while still enabling policy checks.
2. Enforce holder-controlled revocation without a public user registry.
3. Support lost-everything recovery without Magna custodying user secrets.
4. Keep issuance authority scoped to a stable orchestrator origin, and keep issued claims
   **truthful** — bound to a real, verified passport.

Goal 4 has two halves — authorization and forgery resistance. Both are now enforced for the A2
passport path (§7.1). What remains open is *uniqueness*: nothing stops one passport from minting
many credentials (§6.1).

---

## 2. Trust boundaries

| Party | Trusted for | Explicitly not trusted for |
| --- | --- | --- |
| User device / PXE | private witness generation, local proving, holding blinds and secrets | producing honest witnesses — the circuit must constrain them |
| `magna-management` (wallet origin) | passkey custody, note discovery, session assertion issuance | nothing on behalf of a remote dApp beyond the signed assertion |
| `magna-verification-api` + orchestrator | verifying proofs, being the sole issuance caller | learning claim values; it is designed to be PII-blind |
| `MagnaIssuer` contract | note semantics, nullifier discipline, caller acceptance | judging claim truthfulness — it verifies a commitment, not a passport |
| Aztec sequencer / node | public execution and state inclusion | learning private witness values |
| zkPassport | attesting passport authenticity and disclosures | nothing about Magna's own claim encoding |

The structural consequence of PII-blindness: because the verification API never sees claim values,
it **cannot** sanity-check them. All correctness of claim content has to come from the wrapper
circuit — there is nowhere else it can live. A2 puts it there (§7.1); A1 did not, which is why the
gap was critical rather than cosmetic.

---

## 3. Assets

- `revocation_secret` in `StatusNote` / `RecoveryNote`, and the root variant in
  `RootStatusNote` / `RootRecoveryNote`
- `nationality_blind` and `expiry_blind` — device-local; losing them bricks the credential,
  leaking them de-anonymizes `claims_hash`
- `claims_hash` (a commitment, but a stable per-credential correlator)
- `root_commitment` — opaque cross-credential linkage handle
- zkPassport `uniqueIdentifier` and the Ghost seeds derived from it
- orchestrator authorization keys
- the dev session-signing key used for login assertions

---

## 4. Adversaries and mitigations

Threats are labelled `T1`–`T12`. Note that `A1` and `A2` elsewhere in these documents refer to
passport *flow versions*, not to threats.

### T1. Unauthorized issuance (wrong caller)

**Risk:** an attacker calls the issuance entrypoint directly and mints credentials.

**Mitigation:** immutable acceptance rule in the issuer contract —
`assert(msg_sender == ORCHESTRATOR_ADDRESS)`. Signer policy rotates inside the orchestrator account
contract so the address can stay stable for note discovery.

**Status:** enforced.

### T2. Unauthorized issuance (right caller, forged claims)

**Risk:** an attacker uses the *legitimate* issuance path but supplies claims that do not match the
passport they scanned — a real proof of a real passport, paired with fabricated nationality, age, or
expiry.

**Mitigation:** the A2 wrapper circuit recursively verifies the zkPassport outer proof against a
pinned vkey hash, and constrains the disclosure, age, and bind commitments to the same witnesses
that produce `claims_hash`. Scope, domain, registry roots, and proof freshness are bound through
`request_context_hash` and the API's time-bound and registry-trust checks.

**Status:** enforced under A2. This was previously the highest-severity open item; see §7.1 for the
history and the specific constraints that close it. Note the related uniqueness gap in T11/§6.1,
which is a different property and still open.

### T3. Linkability via public registries

**Risk:** a stable public credential index correlates a user's actions across dApps.

**Mitigation:** no public per-user index exists. State is private notes plus nullifiers. Nullifiers
are revealed only at revocation time, and are domain-separated per lineage.

**Status:** enforced.

### T4. Recovery discovery failure

**Risk:** a fresh device cannot find its `RecoveryNote` and the user is locked out permanently.

**Mitigation:** sender-for-tags. Issuance always originates from the stable orchestrator account, so
a new PXE registers that known sender and scans tags to rediscover notes.

**Status:** enforced. Note the coupling: the orchestrator address is a recoverability dependency,
not just an authorization one, which is why it must not change casually.

### T5. False revocation / stale non-revocation

**Risk:** a revoked credential still verifies, or a live one is wrongly rejected.

**Mitigation:** revocation is a kill-switch nullifier emitted by spending the recovery note.
`verify()` proves non-inclusion of `N` at the anchor block header using Aztec history primitives.
`verify_linked()` proves non-inclusion of `N_linked`, `N_root`, and `N_root_authority`.

**Status:** enforced. Residual: anchor-header freshness bounds how quickly a revocation becomes
visible to verifiers.

### T6. Ghost derivation leakage

**Risk:** a leaked `uniqueIdentifier` lets an attacker derive the Ghost key and hijack recovery.

**Mitigation:** treat `uniqueIdentifier` as a secret — never logged, stored server-side, or
transmitted. Derivation is scoped (`magna_recovery::<credential_type>`). A2 removes it from the
issuance request entirely, and `uniqueIdentifier` is an explicitly forbidden request key.

**Status:** enforced for the A2 path. The legacy path still sends it to the API.

### T7. Root linkage leakage

**Risk:** exposing a raw identifier or a public root registry creates stable cross-credential
linkage.

**Mitigation:** `root_commitment` is an opaque field, never placed onchain in the clear and never
used as a public registry key.

**Status:** partially enforced. The verification API receives `root_commitment` as a wrapper public
output on every A2 lifecycle call. Under A2 it is a deterministic function of the passport's scoped
nullifier, so it is a stable per-passport correlator visible to the server — a deliberate tradeoff
for making issuance uniqueness enforceable, and one that keeps the preimage device-local but does
not hide the handle.

### T8. Over- vs under-revocation

**Risk:** revoking one credential kills unrelated siblings, or revoking a root leaves descendants
usable.

**Mitigation:** separate nullifier domains and separate recovery flows for root and credential
lineages; linked verifies require both lineages live; rootless credentials are root-independent by
entrypoint and note type.

**Status:** enforced, with lifecycle tests.

### T9. Orchestrator signer compromise

**Risk:** an attacker with the orchestrator signing key mints arbitrary credentials.

**Mitigation:** stable address with rotatable signing policy in the account contract, plus optional
pause controls and an incident runbook.

**Status:** partially mitigated. Compromise remains a total issuance break — there is no second
factor on issuance and no onchain rate limit. Rotation limits duration, not blast radius.

### T10. Fee sponsorship draining

**Risk:** where the platform sponsors `verify()` fees, an attacker drains the sponsor by
revert-burning (txs valid enough to include but reverting publicly) or by unbounded valid spam.

**Mitigation:** sponsorship is structurally bound to `MagnaIssuer.verify()`; eligibility is checked
in private so failures abort during proving and cost the sponsor nothing; sponsored verifies emit a
rate-limit nullifier (5 per 24h); external metering hooks are issuer-only and meter-only to avoid
public revert surfaces.

**Status:** enforced.

### T11. Credential replay / sybil

**Risk:** one passport mints many independent credentials.

**Mitigation:** A2 derives `root_commitment` in-circuit from the proof-bound `scoped_nullifier`,
giving a stable per-passport value that makes uniqueness enforceable — but nothing records it.

**Status:** **not implemented.** See §6.1. This is the largest remaining soundness gap.

### T12. Malicious dApp against the wallet

**Risk:** an integrating dApp tries to extract more than a policy answer.

**Mitigation:** the dApp only ever holds `@magna/client`. Passkeys, PXE, notes, note hints, raw
claims, and contract bindings stay inside the wallet origin. Responses are P-256 session assertions
validated against `requestId`, `sessionChallenge`, `policyHash`, `clientId`, `origin`, and expiry,
and are accepted only from the configured `walletOrigin`.

**Status:** enforced for the current development configuration. `VITE_MAGNA_SESSION_SIGNING_KEY`
is a frontend env var readable by page clients and does not provide production-grade key custody.

---

## 5. Data minimization

The A2 issuance payload does not contain:

- raw passport chip data or MRZ
- raw birthdate (age is reduced to `min_age_proven` on-device)
- nationality or passport expiry in cleartext, server-side, under schema v2
- user private keys, passkey material, or protocol keys
- revocation secrets or claim blinds
- plaintext `uniqueIdentifier` values, or any registry keyed by them
- any global registry linking identities to addresses

A2 also removes the zkPassport outer proof and its public inputs from the payload, and forbids the
root-status and root-authority note hints that A1 renewal used to send.

Still server-visible, and therefore correlators: `claims_hash`, `root_commitment`, `ghostOwner`,
and `request_context_hash`. `root_commitment` in particular is stable per passport by construction
under A2, which is what makes §6.1 fixable — and also what makes it a durable correlator.

---

## 6. Open items

### 6.1 No issuance nullifier

No used-nullifier set is persisted by the API, and `register_rooted_passport_v2` enforces only
`root_commitment != 0`, not uniqueness. One passport can mint unlimited credentials, so there is no
Sybil-resistance guarantee.

This is the largest remaining soundness gap. A2 makes it tractable: `root_commitment` is a
deterministic function of the proof-bound scoped nullifier, so it is a stable per-passport value
that can be emitted as an issuance nullifier. Placing that check in the contract rather than the API
preserves the guarantee even if the API is compromised.

### 6.2 `is_id_card` is an unconstrained prover input

`is_id_card` selects which MRZ offsets are read for nationality and expiry, but is not constrained
against the document type actually proven — the zkPassport disclosure commitment covers the mask and
disclosed bytes, not the layout.

**Impact is bounded.** A prover cannot inject arbitrary bytes, only reinterpret bytes from their own
authenticated MRZ at the alternate offsets, and only where the disclosure mask shows those bytes
were genuinely revealed. For a TD3 passport read with ID-card offsets, the nationality offset falls
in the document-number field, limiting reachable values to the characters present there.

**Status:** no satisfying witness has been demonstrated, so this is a hardening item rather than a
known exploit. An input that selects a read offset should nonetheless be constrained — either by
binding the layout into the disclosure commitment or by deriving `is_id_card` from authenticated
data.

### 6.3 Verification receipts not emitted

`MagnaIssuer.verify` updates `verify_meter_count` but emits no receipt event. A relying party
receives only the verification transaction hash through the signed session assertion. Typed private
receipt metadata, and the atomicity properties that would go with it, are not implemented.

---

## 7. Resolved items

Recorded because they shaped the current design.

### 7.1 A1 claim binding

**What it was.** The A1 wrapper circuit returned the four zkPassport disclosure and bind commitments
as pass-through parameters referenced by no `assert`, and compared its other outputs only against
`expected_*` parameters supplied by the same prover. The outer proof was never recursively verified.
The API cross-check confirmed the four commitments appeared among the outer proof's parameter
commitments — establishing they came from *a* real proof, but never that `claims_hash` described the
same passport, because nothing opened those commitments against the nationality, age, and expiry
witnesses.

**Impact while open.** Any holder of a genuine zkPassport proof could mint a credential asserting
arbitrary nationality, age, and passport expiry, including with `zkPassportDevMode=false`. The
condition was confirmed by executing a hand-written witness against the A1 circuit, which solved
with an age predicate of 99, an expiry in 2100, and placeholder disclosure commitments.

**How A2 closes it.** The wrapper circuit now:

- recursively verifies the outer proof (`verify_proof_with_type`) against a pinned verification-key
  hash and proof type, so a substituted circuit fails;
- asserts the nationality and expiry MRZ bytes are disclosed in the mask and equal the claimed
  values;
- recomputes the disclosure, age, and bind parameter commitments in-circuit from those same
  witnesses and asserts each appears among the verified outer public inputs;
- requires `min_age_proven == age_min_bound` and derives `expiry_ts` canonically from the
  authenticated MRZ bytes, with `credential_valid_until <= authenticated_expiry_ts`;
- computes every public output — no `expected_*` parameters remain.

Scope, domain, registry roots, and nullifier type are bound through `request_context_hash`, which
the API recomputes and requires to match exactly. Proof freshness is enforced by
`validatePassportA2TimeBounds`, and registry roots are validated against the onchain zkPassport
registry with mock nullifier types rejected outside development mode. The outer proof is no longer
sent to the server at all.

The A1 attack shape is not merely rejected under A2 but unrepresentable: the `expected_*` parameters
it depended on no longer exist in the circuit ABI.

### 7.2 Unbound `root_commitment` and `ghost_owner`

Both were client-supplied and accepted with only format validation. `root_commitment` is now
computed in-circuit as `H(MAGNA_ROOT_DS, scoped_nullifier)` from a verified outer public input, and
`ghost_owner` is bound into `request_context_hash`, which the server independently recomputes.
Control of the locally derived Ghost account and its recovery note remains the authorization
boundary for the recovery transaction itself.

### 7.3 Renewal note hints sent to the API

A1 renewal serialized `hintedRootStatusNote` and `hintedRootAuthorityNote` — carrying root and
authority revocation secrets, the previous authority claims hash and expiry, owner information, and
note randomness — to the verification API. Those keys are now in `PASSPORT_A2_FORBIDDEN_KEYS`, and
A2 requests reject any unexpected field outright. Renewal is split into an orchestrator call to
`authorize_root_authority_refresh` and a local private `refresh_root_authority_authorized` call from
the holder's wallet, making renewal credential-state-blind as well as passport-PII-blind.

---

## 8. Residual risks (accepted)

- Node metadata leakage from query patterns — a known Aztec tradeoff.
- Randomness oracle assumptions for note blinding.
- Upstream breaking changes across Aztec devnet versions.
- `claims_hash` as a stable per-credential correlator.
- Orchestrator compromise remains a full issuance break (T9).
