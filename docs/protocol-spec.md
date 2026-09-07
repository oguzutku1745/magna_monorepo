# Magna Protocol Spec

**Status:** pre-release. Not deployed to a public network. Passport schema v2 (PII-blind) is
canonical; schema v1 remains in the contract as a compatibility path.

**Scope:** this document describes the protocol — note lineages, commitments, nullifiers, policy
evaluation, and the issuance/verification flows. Application-level integration is covered in
[`integration-guide.md`](./integration-guide.md); adversary analysis and known gaps are in
[`threat-model.md`](./threat-model.md).

---

## 0. System map

| Role | Current implementation |
| --- | --- |
| Wallet + management UI, issuance, renewal, recovery, `/authorize` | `apps/magna-management` |
| zkPassport verification + orchestrator-backed issuance | `apps/magna-verification-api` |
| Third-party "Login with Magna" example | `apps/reference-dapp` |
| Wallet/contract execution engine used by management | `packages/magna-wallet` |
| Protocol primitives (hashes, policy, packing) | `packages/magna-core` |
| dApp-facing connector SDK | `packages/magna-client` |
| A2 recursive wrapper circuit + prover/verifier bindings | `packages/magna-passport-wrapper-proof` |
| Credential contract | `contracts/magna-issuer` |

Default dev ports: management `5174`, reference-dapp `5175`, verification API per its own
`.env`.

### 0.1 Production-live credential adapters

Magna currently names exactly two live adapters:

1. **Passport A2** — recursive zkPassport verification, blinded passport claims, rooted issuance,
   private login, renewal/revocation, and destination-bound Root Recovery V3.
2. **Instagram V2** — client-side proof of an authentic DKIM-signed Instagram recovery email,
   blinded handle claims, governed historical/current DKIM key commitments, rootless issuance, and
   private handle login. After Passport Root Recovery V3, the holder issues Instagram again on the
   recovered wallet using a fresh signed Instagram security email.

`X`, `StudentEmail`, and `WorkEmail` are reserved enum values only. They are not implemented
adapters and must not be presented as live. Instagram's evidence and exact semantic limits are in
`docs/evidence/instagram-proof-portability-2026-08-30.md`.

---

## 1. Note lineages

Two credential modes exist. Root-linked is canonical; rootless is the compatibility path.

Definitions live in `contracts/magna-issuer/src/types/`. Each is an `#[note]` struct, so the fields
below are the declared payload only: note randomness is supplied by the Aztec note macro, and
ownership is a property of note delivery and discovery (surfaced as `HintedNote.owner` when a note
is consumed) rather than a declared field. Note randomness is drawn from the Aztec randomness
oracle and used only for note blinding — it never influences public state branching.

### 1.1 Rootless notes (compatibility)

| Note | Held by | Declared fields |
| --- | --- | --- |
| `CredentialNote` | active wallet | `claims_hash`, `credential_type`, `expiry_ts` |
| `StatusNote` | active wallet | `revocation_secret`, `claims_hash`, `credential_type` |
| `RecoveryNote` | Ghost wallet | `revocation_secret`, `claims_hash`, `credential_type`, `expiry_ts` |

### 1.2 Root-linked notes (canonical)

The linked model introduces an opaque private `root_commitment` that ties a set of credentials to
the same identity root without exposing the underlying identifier.

| Note | Held by | Declared fields |
| --- | --- | --- |
| `RootStatusNote` | active wallet | `root_commitment`, `revocation_secret` |
| `RootRecoveryNote` | Ghost wallet | `root_commitment`, `revocation_secret` |
| `RootAuthorityNote` | active wallet | `root_commitment`, `claims_hash`, `authority_expiry_ts`, `revocation_secret` |
| `LinkedCredentialNote` | active wallet | `root_commitment`, `claims_hash`, `credential_type`, `expiry_ts` |
| `LinkedStatusNote` | active wallet | `root_commitment`, `revocation_secret`, `claims_hash`, `credential_type` |
| `LinkedRecoveryNote` | Ghost wallet | `root_commitment`, `revocation_secret`, `claims_hash`, `credential_type`, `expiry_ts` |

`RootAuthorityNote.claims_hash` is the currently authoritative passport credential.

---

## 2. Revocation signals

Revocation is a kill-switch nullifier emitted by *spending* a recovery note. There is no public
revocation registry.

| Lineage | Nullifier |
| --- | --- |
| Rootless credential | `N = H(MAGNA_REVOCATION_DS, revocation_secret, credential_type, claims_hash)` |
| Linked credential | `N_linked = H(MAGNA_REVOCATION_DS, revocation_secret, credential_type, claims_hash)` |
| Shared root | `N_root = H(MAGNA_ROOT_REVOCATION_DS, revocation_secret, root_commitment)` |
| Root authority | `N_root_authority = H(MAGNA_ROOT_AUTHORITY_REVOCATION_DS, revocation_secret, root_commitment, claims_hash)` |

Rootless `verify()` accepts only on proven non-inclusion of `N` at the anchor block header.

Root-linked `verify_linked()` rejects if **any** of `N_linked`, `N_root`, or `N_root_authority`
exists at the anchor header.

Separating the root domain from the credential domain is what makes selective revocation possible:
revoking one linked credential does not kill siblings, while revoking the root kills all
descendants.

---

## 3. Issuance control boundary

Issuer contract acceptance is a single immutable rule:

```
assert(msg_sender == ORCHESTRATOR_ADDRESS)
```

The orchestrator address is intended to stay stable so recovering devices can register it as a
known sender-for-tags and rediscover notes. The current local verification API imports an Aztec
initial test account, and the pinned `SchnorrInitializerlessAccount` binds its signing public key
into the account instance's immutable hash. It does **not** currently provide in-account signer
rotation. Local-testnet use is expected; production requires a separately reviewed stable-address
rotation/emergency design and production signer custody before deployment.

This rule governs **who may call**. It says nothing about whether the claims being minted are
truthful; that property comes from the proof pipeline in §5.

Renewal uses a two-step split of this boundary. The orchestrator calls
`authorize_root_authority_refresh(...)`, which records an authorization commitment in public
storage; the holder then calls `refresh_root_authority_authorized(...)` privately from their own
wallet. The orchestrator authorizes the refresh without ever handling the holder's note material.

---

## 4. Claims commitments

### 4.1 Passport schema v2 (canonical, PII-blind)

`claims_hash` commits to *blinded* nationality and expiry, so possession of `claims_hash` reveals
nothing about the holder even to the issuer:

```
nationality_commitment = H(MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS,
                           nationality_alpha3_packed, nationality_blind)

expiry_commitment      = H(MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS,
                           expiry_ts, expiry_blind)

claims_hash            = H(MAGNA_CLAIMS_DS, 2, credential_type,
                           nationality_commitment, min_age_proven, expiry_commitment)
```

Domain separators are the ASCII tags `MAGC`, `MANC`, `MAEX`. `min_age_proven` is committed in the
clear inside `claims_hash` — it is a coarse predicate result, not a birthdate.

The blinds (`nationality_blind`, `expiry_blind`) are device-local secrets. They must be retained by
the wallet: without them the holder cannot reopen the commitments during `verify`, and the
credential becomes unusable.

Canonical implementation: `packages/magna-core` (hashing), the wrapper circuit at
`packages/magna-passport-wrapper-proof/circuit/src/main.nr`, and
`claims_from_committed_passport_witness` in `contracts/magna-issuer/src/main.nr`. All three must
agree bit-for-bit.

### 4.2 Passport schema v1 (legacy)

```
claims_hash = H(MAGNA_CLAIMS_DS, 1, credential_type,
                nationality_alpha3_packed, min_age_proven, expiry_ts)
```

Unblinded. Anyone holding `claims_hash` and a candidate claim tuple can confirm it by
recomputation, so v1 leaks claims to the issuer and to anyone who can guess. It is retained only as
a migration path; schema v2 is canonical for new issuance.

### 4.3 Instagram schema v2

```
handle_hash       = Pedersen(MAGNA_INSTAGRAM_HANDLE_DS, handle_len, handle_packed)
handle_commitment = Pedersen(MAGNA_INSTAGRAM_HANDLE_COMMITMENT_DS, handle_hash, handle_blind)
claims_hash       = Pedersen(MAGNA_CLAIMS_DS, 2, CredentialType.Instagram,
                             handle_commitment, expiry_ts)
```

`CredentialType` values: `None = 0`, `Passport = 1`, `X = 2`, `Instagram = 3`, `StudentEmail = 4`,
`WorkEmail = 5`.

The browser samples the non-zero `handle_blind`; the handle, hash, and blind remain local. The
zkEmail circuit verifies the Instagram DKIM signature and signed ownership text, then exposes only
the opaque `claims_hash` plus the DKIM key hash, email nullifier, expiry, active owner, issuer, and
chain ID. The API verifies the proof and deployment bindings but cannot dictionary-test the handle
against `claims_hash`. During private login, Aztec recomputes `handle_commitment` and `claims_hash`
from the local witness while applying handle policy to the private `handle_hash`.

---

## 5. A2 issuance flow (recursive, PII-blind passport)

A2 is the current passport onboarding path. It supersedes A1, which passed the zkPassport outer
proof to the server and left claim values unconstrained. Under A2 the outer proof is verified
*inside* the wrapper circuit and never leaves the device.

Design goal: the verification API learns the credential commitment and a request-context hash, but
never the nationality, expiry date, birthdate, zkPassport `uniqueIdentifier`, or the outer proof
itself.

```
magna-management (browser)
  ├─ zkPassport SDK 0.16.1 scan → outer_count_7 proof + vkey + 12 outer public inputs
  ├─ derive nationality_blind / expiry_blind locally
  ├─ prove wrapper locally — recursively verifies the outer proof
  │                        → wrapper proof + 8 public outputs
  └─ POST /zkpassport/verify-and-issue { schema: "passport-a2-v1", ... }
        │           (outer proof is NOT sent)
        ▼
magna-verification-api
  ├─ verify wrapper proof (public inputs proof-bound or verifier-attested)
  ├─ time bounds: proof freshness, credentialValidUntil ≤ 30 days
  ├─ registry trust: certificate + circuit roots valid onchain; profile nullifier/OPRF field pinned
  ├─ recompute request_context_hash and require equality
  └─ orchestrator → MagnaIssuer.register_rooted_passport_v2 / register_credential_v2
```

### 5.1 What the circuit constrains

`packages/magna-passport-wrapper-proof/circuit/src/main.nr` is the production profile. The
separately compiled `circuit-dev/src/main.nr` retains the same recursive-proof, disclosure, Bind,
official-app-attestation, and output constraints. Its isolated identity profile uses regular
FaceMatch, `NON_SALTED_MOCK = 2`, and `oprf_pk_hash = 0`; production uses strict FaceMatch,
`SALTED = 1`, and the pinned OPRF-key hash.

- `verify_proof_with_type(...)` recursively verifies the zkPassport outer proof against a **pinned**
  verification-key hash (`ZKPASSPORT_OUTER_COUNT_7_VKEY_HASH`) and proof type, so a different
  circuit cannot be substituted.
- `assert_disclosed_claims` requires the nationality and expiry MRZ bytes to be *disclosed* in the
  mask and to equal the claimed values.
- The same disclosure authenticates both MRZ document-type bytes. The circuit accepts `P`
  (passport) or `I` (ID card) and derives the nationality and expiry offsets from that byte; the
  prover cannot select a layout independently.
- The disclose, age, bind, and profile-selected FaceMatch parameter commitments are recomputed in-circuit from those same
  witnesses and each asserted to appear among the outer proof's parameter commitments — this is the
  link that was missing in A1.
- FaceMatch must use the official application attestation environment, an official zkPassport
  iOS/Android application identity, an approved Apple/Google attestation root, and the
  platform-appropriate integrity key. Its mode is strict in production and regular only in the
  explicit developer artifact.
- Outer public input 9 must be production `SALTED = 1` in the production artifact or
  `NON_SALTED_MOCK = 2` in the isolated developer artifact. Public input 11 must equal the
  documented OPRF key-ID-1 public-key hash
  `1178201404428554206520802247552222388413553631367032661928167491793274360628`
  in production and exactly `0` in development.
- `min_age_proven == age_min_bound`, tying the committed age predicate to the authenticated one.
- `expiry_ts` must equal `canonical_expiry_timestamp(expiry_mrz, proof_current_date)`, and
  `credential_valid_until <= authenticated_expiry_ts`.
- `root_commitment = H(MAGNA_ROOT_DS, scoped_nullifier)`, derived from outer public input 10 rather
  than accepted from the client.
- `request_context_hash` binds action, issuer, owner, ghost owner, credential mode, root commitment,
  validity, service scope/subscope, registry roots, nullifier type, and the bind commitment.

Every public output is now *computed*; there are no `expected_*` pass-through parameters.

### 5.2 Wrapper circuit public outputs

Eight fields, in order:

1. `claims_hash`
2. `nationality_commitment`
3. `expiry_commitment`
4. `min_age_proven`
5. `credential_valid_until`
6. `root_commitment`
7. `request_context_hash`
8. `proof_current_date`

### 5.3 What the API checks

`verifyPassportA2Proof` in `apps/magna-verification-api/src/service.ts`:

- the wrapper proof verifies, and its public inputs are proof-bound or verifier-attested — never
  taken from the request body alone;
- `validatePassportA2TimeBounds`: `proof_current_date` is not in the future (5 min skew) and not
  older than the configured validity window; `credential_valid_until` is in the future and within
  30 days;
- `assertPassportA2RegistryTrust`: the certificate and circuit registry roots are valid against the
  onchain zkPassport registry, while the salted nullifier type and OPRF public-key hash must match
  the circuit-pinned production values even in local development;
- `assertPassportA2RequestContext`: the server recomputes `request_context_hash` from its own
  issuer address, domain/scope hashes, the requested action and owner, and the client-supplied
  registry context, then requires exact equality with the proof output. Because the circuit built
  that hash from *verified* outer public inputs, this transitively pins scope, domain, registry
  roots, and nullifier type without the server ever seeing the outer proof.

### 5.4 Passport-PII boundary

The A2 proof payload excludes `nationality_alpha3_packed`, passport `expiry_ts`, birthdate,
`nationality_blind`, `expiry_blind`, zkPassport `uniqueIdentifier`, `scopedNullifier`, Ghost account
seeds, raw `queryResult`, and the zkPassport outer proof and its public inputs. The A2 request
validator (`assertNoPassportA2PrivateArtifacts`) rejects the named artifacts and also rejects any
unexpected request field.

Under A1 this boundary covered passport PII but not credential state: rooted renewal serialized
`hintedRootStatusNote` and `hintedRootAuthorityNote` — including revocation secrets — to the
verification API. A2 forbids those keys and executes `refresh_root_authority` locally, so renewal is
now credential-state-blind too. Recovery preflight sends no recovery-note hints; the recovery
transaction is executed locally by the transient Ghost wallet.

What the API still sees, and what therefore remains a server-visible correlator: `claims_hash`,
`root_commitment`, `ghostOwner`, and `request_context_hash`.

---

## 6. Root commitment model

`root_commitment` is an opaque private `Field`. The contract treats it as a linkage handle, never as
a registry key, and never interprets its preimage.

**A2 derivation (canonical).** The wrapper circuit computes

```
root_commitment = H(MAGNA_ROOT_DS, scoped_nullifier)
```

where `scoped_nullifier` is outer public input 10 of the recursively verified zkPassport proof, and
emits it as a public output. The client cannot choose it, and the API can trust it without ever
learning `uniqueIdentifier`. Because zkPassport's scoped nullifier is already bound to the
configured domain and scope, `root_commitment` is scoped to the Magna application context and is
stable for a given passport.

**Legacy derivation.** The pre-A2 path derived `root_commitment = H(MAGNA_ROOT_DS,
uniqueIdentifier_field)` device-side. `deriveRootCommitment` in `packages/magna-wallet` still
implements this shape — A2 calls it with the scoped nullifier in place of the unique identifier.

**Ghost derivation** is versioned so migrations stay safe:

- `v1_legacy_unscoped`: `ghost_seed = H(MAGNA_GHOST_DS, uniqueIdentifier_field)`
- `v2_scoped` (canonical, and the only version A2 accepts):
  `ghost_seed = H(MAGNA_GHOST_DS, uniqueIdentifier_field, credential_type)`

Ghost seeds remain device-local; `ghost_owner` reaches the API only as an address, and is bound
into `request_context_hash`.

Renewal does **not** assume a replaced passport reproduces the same zkPassport `uniqueIdentifier`.
`root_commitment` is the long-lived anchor; passport authority is refreshed through
`RootAuthorityNote`. Migrating to salted or vOPRF-backed identifiers would change derivation only,
not the onchain note layout.

---

## 7. Policy model

### Policy

- `credential_type: u8`
- `constraints: [Constraint; MAX_CONSTRAINTS]`

### Constraint

- `claim_id: u8`, `op: u8`, `value: Field`

`MAX_CONSTRAINTS` bounds circuit size (v1 value: `8`).

**Claim IDs:** `0` NONE, `1` AGE_MIN_PROVEN, `2` NATIONALITY_ALPHA3, `3` EXPIRY_TS,
`4` INSTAGRAM_HANDLE_HASH.

**Operators:** `0` NONE, `1` EQ, `2` NEQ, `3` GTE, `4` LTE.

Policy is conjunctive — AND over all non-NONE constraints. Example: `AGE_MIN_PROVEN GTE 18` and
`NATIONALITY_ALPHA3 NEQ packAlpha3("USA")`. One credential satisfies multi-field policies; no
per-field credential is needed.

Under schema v2 the policy is still evaluated over cleartext claim values, but only inside the
holder's private execution: the holder supplies the blinded witness, the contract recomputes
`claims_hash` and asserts equality, and then evaluates constraints on the recovered values. The
verifier learns the boolean outcome, not the claims.

---

## 8. Verify flows (private entrypoints)

Entrypoints come in families. The base name is the schema-v1 path; the `_v2` suffix takes the
blinded schema-v2 passport witness of §4.1. `_linked` operates on the root-linked lineage,
`_sponsored` applies the fee-sponsorship path of §10, and `_instagram` takes the Instagram witness.
`_consumer` is a separately available gateway-mediated issuer path: an allowlisted consumer gateway
contract calls it on behalf of an explicit `caller`, and the issuer checks that gateway against its
`consumer_gateways` allowlist and `disabled_consumer_gateways` kill-list. The current Login with
Magna path uses the company sponsor's `_session` entrypoints described in §8.3. These suffixes compose
— for example `verify_linked_sponsored_v2`.

### 8.1 Rootless verify

1. Read caller-owned `CredentialNote` + `StatusNote`; prove both existed at the anchor header.
2. Recompute `claims_hash` from the private witness and assert equality with the note.
3. Evaluate each policy constraint.
4. Check expiry against the Aztec time model (enqueued public timestamp check and/or tx expiration).
5. Compute `N` and prove non-inclusion at the anchor header.
6. Enqueue public metering, atomic with the proof gate result.

### 8.2 Root-linked verify

1. Read `LinkedCredentialNote` + `LinkedStatusNote` + `RootStatusNote` + `RootAuthorityNote`.
2. Enforce shared linkage across all four `root_commitment` values.
3. Recompute `claims_hash` from the private witness; assert equality with the linked credential
   note. For v2 passports this is the blinded recomputation of §4.1.
4. For linked passport verifies, require
   `RootAuthorityNote.claims_hash == LinkedCredentialNote.claims_hash`.
5. Evaluate policy constraints.
6. Check validity against the minimum of linked credential `expiry_ts`, `authority_expiry_ts`, and
   the sponsored window end when sponsored mode is active.
7. Compute `N_linked`, `N_root`, `N_root_authority`; prove all required non-inclusions.
8. Enqueue metering / sponsorship logic as in the rootless path.

Rootless credentials never perform the root check. For Instagram-linked credentials, step 3
recomputes the Instagram V2 `handle_commitment` and `claims_hash` from the private handle-hash and
blind witness while the rooted passport authority note still gates validity.

### 8.3 Login with Magna session authorization

Login authorization is part of the same private, user-passkey-authenticated transaction as policy
verification. The active `MagnaCompanySponsor` exposes six `_session` lanes covering rootless and
root-linked schema-v1 Passport, schema-v2 Passport, and Instagram witnesses. Each lane:

1. receives the relying party's consumer-gateway field, request ID, session challenge, expiry, and
   requirement index along with the normalized policy;
2. calls the matching sponsored issuer verification, so credential ownership, witness binding,
   revocation, expiry, rate limits, rights consumption, and metering all remain atomic;
3. only after successful verification, computes
   `Poseidon2(MSA2, gateway, request, challenge, expiry, index, normalized policy)` and emits it as a
   private nullifier siloed to the active sponsor contract.

The transport response is a version-2 envelope carrying the original request bindings and the Aztec
transaction hash for each requirement. It is not trusted as a browser signature. `@magna-protocol/client`
recomputes the expected inner nullifier from its own in-flight request, uses Aztec's official
`siloNullifier` construction with its pinned sponsor address, fetches each transaction receipt from
its configured Aztec node, and accepts only a mined successful effect containing that exact
nullifier. The wallet origin therefore holds no shared session-signing private key, and moving login
authority to a Magna backend is unnecessary.

---

## 9. Recovery flows

### 9.1 Rootless recovery

The generic rootless `recover(...)` entrypoint has been removed and is not part of the pre-release
rooted passport product. A future rootless recovery design requires a
separate proof source and threat-model review; it must not reuse Ghost possession as sole authority.

### 9.2 Instagram after passport recovery

Instagram V2 uses the rootless credential lane. Passport Root Recovery V3 rotates the rooted
passport note set only; it does not copy the prior wallet's Instagram notes. Once the recovered
wallet is open, the holder obtains a fresh signed Instagram security email and uses the normal
client-side Instagram issuance flow. The browser verifies the email, generates a new blinded-handle
proof, and issues an active Instagram credential to the recovered wallet without sending the email
or plaintext handle to Magna API.

### 9.3 Root recovery

1. The browser chooses the destination, recovery nonce, and Aztec message secret before proving.
2. A fresh zkPassport proof binds those values plus the Ethereum/Aztec deployment domain. The
   recursive Recovery V3 wrapper authenticates the root, Ghost identity, claims, credential expiry,
   proof date, registry context, and message-secret hash.
3. The browser submits the wrapper proof directly to `MagnaRecoveryPortal`. The portal verifies it,
   checks current zkPassport Ethereum registry validity and the one-hour proof-age policy, rejects
   replay, and sends the resulting authorization through the canonical Aztec Inbox.
4. After Aztec reports the exact Inbox leaf/index, the reconstructed Ghost discovers its private
   `RootRecoveryNote` and calls
   `recover_root_v3(hinted_note, destination, nonce, claims_hash, credential_valid_until,
   message_secret, message_leaf_index)`.
5. The issuer recomputes the proof-bound intent/authorization from its anchor chain and protocol
   version, immutable portal, issuer address, destination, nonce, secret hash, root, claims, and
   expiry. It consumes the canonical portal message and spends the Ghost-owned note.
6. The same private transaction emits `N_root` and mints the complete fresh root status, root
   recovery, root authority, and linked passport credential/status/recovery note set. A successful
   V3 recovery never ends in `recovery_pending`.

Possession of the salted identifier/Ghost key alone is therefore insufficient. A valid portal
authorization alone is also insufficient because only the Ghost can spend the private recovery
note. The API and orchestrator are absent from the authorization path and may be offline.

### 9.4 Root authority refresh

Renewal is split so the orchestrator authorizes the refresh but never touches note material.

1. The wallet produces a fresh A2 proof with `action = "renew"` and posts it to
   `/zkpassport/verify-and-refresh-root-authority`.
2. The API verifies it as in §5.3, then the orchestrator calls
   `authorize_root_authority_refresh(active_owner, ghost_owner, root_commitment, claims_hash,
   authority_expiry_ts)`, which records an authorization commitment in public storage.
3. The holder discovers their current `RootStatusNote` and `RootAuthorityNote` locally and calls
   `refresh_root_authority_authorized(...)` privately from their own wallet.
4. The contract proves the shared root lineage is still live, emits `N_root_authority` for the
   previous authority note, mints a fresh `RootAuthorityNote`, and mints a fresh linked passport
   credential lineage under the same `root_commitment`.
5. Contract-level linked credential lineages that already share the root can use the refreshed
   authority note. The shipped Instagram V2 adapter is rootless and is not affected by this step.

`refresh_root_authority(...)` remains available as the single-call variant for flows where the
caller already holds the notes.

### 9.5 Outcome matrix

| Event | Root | Linked descendants |
| --- | --- | --- |
| Passport nullified | dies | die |
| Passport expired only | survives | paused until `refresh_root_authority(...)` |
| Passport renewed/replaced | survives, same `root_commitment` | refreshed under existing root |

---

## 10. Fee sponsorship

Sponsorship is structurally tied to `MagnaIssuer.verify()` — by construction nothing else is
sponsored. Eligibility is enforced in *private*, so a failing check aborts during proving and the
sponsor pays nothing. Sponsored verifies emit a rate-limit nullifier (5 per 24h window). Any
external public metering hook is issuer-only and meter-only, to avoid public revert surfaces.

---

## 11. Known limitations

These define the limits of the properties described above. Security analysis of each item is in
[`threat-model.md`](./threat-model.md) — §6 for accepted limits and open items, §7 for resolved
attack findings.

### 11.1 Issuance uniqueness boundary

`register_rooted_passport_v2` derives and emits a contract-siloed issuance nullifier from the A2
schema version, Passport credential type, and proof-bound `root_commitment`. Aztec rejects a second
initial rooted issuance carrying the same scoped passport identity even if the destination owner,
Ghost owner, claims, or expiry are changed. Recovery and renewal preserve the existing lineage and
therefore do not emit the initial-issuance nullifier again.

This is one rooted Magna lineage per zkPassport scoped identifier and issuer deployment. It is not a
claim that one biological person can possess only one physical passport, or that replacement
documents necessarily retain the same zkPassport identifier.

### 11.2 M3 receipt-event decision

Privacy-preserving receipt events are formally descoped from M3. The relying party receives the
signed verification result and transaction hash; aggregate metering remains atomic.

`MagnaIssuer.verify` therefore updates `verify_meter_count` but deliberately emits no typed private
receipt event. This is an accepted M3 product boundary rather than unfinished M3 implementation.
The quoted “signed verification result” is implemented as the passkey-authorized verification
transaction and request-bound authorization nullifier described in §8.3; no frontend development
signing key remains.

### 11.3 Residual risks

- Node metadata leakage from query patterns (a known Aztec tradeoff).
- Randomness oracle assumptions for note blinding.
- `claims_hash` and `root_commitment` are stable correlators visible to the verification API.
- Upstream breaking changes across Aztec devnet versions.

### 11.4 Previously open, now closed

Recorded because these shaped the current design:

- **A1 claim binding.** The A1 wrapper circuit returned the zkPassport disclosure and bind
  commitments as unconstrained pass-through parameters and did not verify the outer proof, so a
  holder of a genuine passport proof could mint a credential with arbitrary nationality, age, and
  expiry. A2 closes this by recursively verifying the outer proof against a pinned verification-key
  hash and recomputing those commitments in-circuit from the same witnesses that produce
  `claims_hash` (§5.1).
- **Unbound `root_commitment` and `ghost_owner`.** Both were client-supplied and accepted with only
  format validation. `root_commitment` is now derived in-circuit from a verified outer public
  input, and `ghost_owner` is bound into `request_context_hash` (§6).
- **Renewal note hints.** A1 renewal serialized `RootStatusNote` and `RootAuthorityNote` hints —
  including revocation secrets — to the verification API. A2 forbids those keys and splits renewal
  into orchestrator authorization plus a local private call (§9.4).
- **Prover-selected MRZ layout.** The first A2 circuit accepted `is_id_card` as a private input.
  The current circuit instead authenticates the MRZ document-type bytes through the disclosure
  commitment and derives the layout internally (§5.1).
