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
- Instagram `handle_hash` and `handle_blind` — device-local; the random blind prevents backend
  dictionary attacks against the otherwise low-entropy handle, and losing either bricks login
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
`assert(msg_sender == ORCHESTRATOR_ADDRESS)`. The address should stay stable for note discovery,
but the pinned `SchnorrInitializerlessAccount` binds its signing public key into the immutable
account instance and does not expose signer rotation.

**Status:** caller enforcement is implemented. Local development intentionally uses an Aztec
initial test account. Production custody and a stable-address rotation/emergency design are not
implemented and block non-local deployment, not local-testnet development.

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

### T2a. Instagram plaintext exposure or handle substitution

**Risk:** sending the signed `.eml` or claimed handle to Magna reveals the social identity; exposing
only an unsalted handle hash still permits inexpensive dictionary recovery. A detached proof could
also be replayed for another wallet or deployment.

**Mitigation:** Instagram V2 verifies DKIM and proves the signed handle entirely in the wallet
browser. The circuit commits `handle_hash` with a fresh non-zero field blind, binds the resulting
`claims_hash` to expiry, owner, issuer, and L1 chain, and exposes no handle-derived value other than
that blinded commitment. The API accepts only `{schema, activeOwner, proof}`, verifies the exact
proof/public-input pair, checks the governed DKIM key and all context fields, and rejects legacy
plaintext fields. Aztec login privately recomputes the commitment from the locally retained
`{handle_hash, handle_blind}` witness before applying handle policy.

**Status:** production-live adapter implementation. It is covered by real-DKIM proof generation,
API substitution/privacy and governed-key tests, issuer witness-mismatch tests, and adversarial
execution mutations over the exact signed-header, RSA, REDC-commitment, partial-hash, and signed-body
boundaries. The pinned compiler still emits five conservative Brillig diagnostics. Magna's compile
command accepts only those exact source-hash-pinned locations after a source-level manual-constraint
audit and fails closed on any diagnostic or dependency-source drift. The audit and exact hashes are
recorded in `docs/evidence/instagram-proof-portability-2026-08-30.md`.

Residual: code executing in the trusted wallet origin can access the local handle witness. The
adapter proves possession of an authentic DKIM-signed Instagram recovery email naming the handle;
it does not claim one-person/one-handle uniqueness or continuous control after issuance.

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

**Mitigation:** the production SDK query requires the salted OPRF nullifier and strict production
FaceMatch. Its wrapper pins the OPRF key hash, keeps the identifier off the API request, and binds
the scoped nullifier into the root. The isolated developer profile uses an official non-salted
mock identifier and therefore provides no production identifier-privacy assurance. Most
importantly, rooted recovery requires a fresh passport proof bound to the destination and deployment.
The Ethereum portal validates that proof against zkPassport's authoritative registries and sends a
one-use authorization through the canonical Aztec Inbox; Ghost possession by itself no longer
authorizes `recover_root_v3(...)`.

**Status:** enforced for the rooted A2 launch path. The generic rootless `recover(...)` entrypoint
was removed because there is no deployed compatibility requirement.
The frozen OPRF dependency and same-document continuity boundary are recorded in §6.3.

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

**Mitigation:** local development is limited to a disposable testnet. A non-local deployment must
use reviewed signer custody, backup ownership, and an incident runbook, and must fail closed if the
known initial-test-account import path is selected.

**Status:** production mitigation is not implemented and remains a release blocker. The pinned
initializerless Schnorr account commits its signer into its immutable account hash and exposes no
rotation entrypoint, so the previous stable-address rotation claim must not be relied on. A signer
compromise would remain a total issuance break and would let the attacker publish arbitrary
recovery-authorization hashes, though it would not reveal or spend Ghost notes by itself.

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

**Status:** **not implemented and not claimed.** See §6.1. This is a missing Sybil-resistance
feature, not a way to forge the policy claims inside an otherwise valid credential.

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

## 6. Open items and accepted non-goals

### 6.1 No issuance nullifier

No used-nullifier set is persisted by the API, and `register_rooted_passport_v2` enforces only
`root_commitment != 0`, not uniqueness. One passport can mint unlimited credentials, so there is no
Sybil-resistance guarantee.

Magna therefore must not market one-person/one-credential uniqueness. A2 makes such a future
feature tractable: `root_commitment` is a
deterministic function of the proof-bound scoped nullifier, so it is a stable per-passport value
that can be emitted as an issuance nullifier. Placing that check in the contract rather than the API
preserves the guarantee even if the API is compromised.

### 6.2 M3 receipt events — formally descoped

Privacy-preserving receipt events are formally descoped from M3. The relying party receives the
signed verification result and transaction hash; aggregate metering remains atomic.

`MagnaIssuer.verify` deliberately emits no typed private receipt event. This is an accepted product
boundary and no longer an open M3 deliverable. It does not resolve the distinct production session-
assertion authority issue in §6.4.

### 6.3 Frozen OPRF dependency

The implementation pins documented zkPassport OPRF key ID `1` and its current public-key hash.
On 2026-08-23, Magna recorded the zkPassport team's response that no change to the current
integration is planned. V3 therefore freezes SDK `0.16.1`, production `SALTED`, key ID `1`, its
published public key/hash, and the authenticated outer-proof layout. A different SDK, key, circuit,
or layout requires a new recovery protocol version and migration review; it must never be adopted
silently.

The continuity guarantee is deliberately document-scoped: the same supported physical document
and identical Magna domain/scope/subscope are expected to reproduce the V3 identifier. Magna does
not claim that a renewed or replacement passport is the same zkPassport ID. OPRF or zkPassport
service downtime temporarily blocks fresh recovery authorization and is an accepted availability
dependency. Neither boundary weakens the separate destination-bound proof requirement.

### 6.4 Production Login with Magna assertion authority

The current local profile signs relying-party session assertions with
`VITE_MAGNA_SESSION_SIGNING_KEY`. It is a Magna development key embedded in the management Vite
bundle, not the user's passkey or Aztec account key. Anyone who loads that bundle can extract it and
forge a development assertion, although it cannot spend the user's Aztec notes.

Moving the same key to a backend KMS would hide it but would make that backend the login authority
and availability dependency. The preferred production design is a user-passkey signature over the
session challenge and policy result, cryptographically bound to the Aztec account that submitted the
successful verification transaction (or to a chain-verifiable opaque receipt commitment). That
design requires its own protocol spec and reviewer tests. Until then, the current session assertion
lane is local-development only.

### 6.5 Gate B-production

The production `SALTED = 1` Passport A2/Recovery V3 artifacts still require an empirical run with a
supported physical document through the unmodified official zkPassport application and the pinned
production wrapper/EVM verifier. The developer Gate B proof cannot establish production OPRF or
strict-FaceMatch behavior. This does not require cloning zkPassport's app; cloning/local TACEO nodes
was only a discarded workaround for the developer mock-passport OPRF mismatch.

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

Scope, domain, registry roots, salted nullifier type, and OPRF public-key hash are bound through `request_context_hash`, which
the API recomputes and requires to match exactly. Proof freshness is enforced by
`validatePassportA2TimeBounds`, and registry roots are validated against the onchain zkPassport
registry. The outer proof is no longer
sent to the server at all.

The A1 attack shape is not merely rejected under A2 but unrepresentable: the `expected_*` parameters
it depended on no longer exist in the circuit ABI.

### 7.2 Unbound `root_commitment` and `ghost_owner`

Both were client-supplied and accepted with only format validation. `root_commitment` is now
computed in-circuit as `H(MAGNA_ROOT_DS, scoped_nullifier)` from a verified outer public input, and
`ghost_owner` is bound into `request_context_hash`, which the server independently recomputes.
The locally derived Ghost still owns the recovery note, but it is only one half of rooted recovery:
the contract also consumes a fresh, destination-bound authorization commitment emitted by the EVM
recovery portal after proof and registry verification.

### 7.3 Renewal note hints sent to the API

A1 renewal serialized `hintedRootStatusNote` and `hintedRootAuthorityNote` — carrying root and
authority revocation secrets, the previous authority claims hash and expiry, owner information, and
note randomness — to the verification API. Those keys are now in `PASSPORT_A2_FORBIDDEN_KEYS`, and
A2 requests reject any unexpected field outright. Renewal is split into an orchestrator call to
`authorize_root_authority_refresh` and a local private `refresh_root_authority_authorized` call from
the holder's wallet, making renewal credential-state-blind as well as passport-PII-blind.

### 7.4 Prover-selected MRZ layout

The first A2 circuit accepted `is_id_card` as a private prover input. Although nationality and
expiry still had to be authenticated disclosed bytes, a prover could ask the circuit to interpret
those bytes using the wrong document layout.

A2 now requires the zkPassport disclosure proof to include both MRZ document-type bytes. The
wrapper accepts only authenticated `P` (passport) or `I` (ID card) document types and derives the
nationality and expiry offsets from that proof-bound byte. `is_id_card` no longer exists in the
circuit ABI.

---

## 8. Residual risks (accepted)

- Node metadata leakage from query patterns — a known Aztec tradeoff.
- Randomness oracle assumptions for note blinding.
- Upstream breaking changes across Aztec devnet versions.
- `claims_hash` as a stable per-credential correlator.
- Orchestrator compromise remains a full issuance break (T9).
- JavaScript cannot promise deterministic zeroization of immutable identifier strings; the browser
  minimizes references, never persists/transmits the identifier, and disposes transient Ghost
  sessions, but a dedicated production recovery realm without third-party scripts is still required.
