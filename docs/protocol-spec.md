# Magna v1 Protocol Spec (Aztec-aligned)

## 1. Core note lineages

Magna now has two credential modes:

- **Legacy/rootless**: the current passport-centric v1 flow remains valid.
- **Root-linked**: a credential depends on a shared private identity root plus a renewable passport authority note.

### Legacy rootless notes

These remain the compatibility path for the existing passport flow.

#### CredentialNote (owner: active wallet)

- `owner: AztecAddress`
- `claims_hash: Field`
- `credential_type: u8`
- `expiry_ts: u64`
- `randomness: Field`

#### StatusNote (owner: active wallet)

- `owner: AztecAddress`
- `revocation_secret: Field`
- `claims_hash: Field`
- `credential_type: u8`
- `randomness: Field`

#### RecoveryNote (owner: Ghost wallet)

- `owner: AztecAddress`
- `revocation_secret: Field`
- `claims_hash: Field`
- `credential_type: u8`
- `expiry_ts: u64`
- `randomness: Field`

### Root-linked notes

The linked model introduces an opaque private `root_commitment` that ties a set of credentials to the same
identity root without exposing the underlying `uniqueIdentifier`.

#### RootStatusNote (owner: active wallet)

- `owner: AztecAddress`
- `root_commitment: Field`
- `revocation_secret: Field`
- `randomness: Field`

#### RootRecoveryNote (owner: Ghost wallet)

- `owner: AztecAddress`
- `root_commitment: Field`
- `revocation_secret: Field`
- `randomness: Field`

#### RootAuthorityNote (owner: active wallet)

- `owner: AztecAddress`
- `root_commitment: Field`
- `claims_hash: Field` for the currently authoritative passport
- `authority_expiry_ts: u64`
- `revocation_secret: Field`
- `randomness: Field`

#### LinkedCredentialNote (owner: active wallet)

- `owner: AztecAddress`
- `root_commitment: Field`
- `claims_hash: Field`
- `credential_type: u8`
- `expiry_ts: u64`
- `randomness: Field`

#### LinkedStatusNote (owner: active wallet)

- `owner: AztecAddress`
- `root_commitment: Field`
- `revocation_secret: Field`
- `claims_hash: Field`
- `credential_type: u8`
- `randomness: Field`

#### LinkedRecoveryNote (owner: Ghost wallet)

- `owner: AztecAddress`
- `root_commitment: Field`
- `revocation_secret: Field`
- `claims_hash: Field`
- `credential_type: u8`
- `expiry_ts: u64`
- `randomness: Field`

## 2. Revocation signal

- Legacy credential kill-switch nullifier emitted when spending `RecoveryNote`:
  - `N = H(MAGNA_REVOCATION_DS, revocation_secret, credential_type, claims_hash)`
- Linked credential kill-switch nullifier emitted when spending `LinkedRecoveryNote`:
  - `N_linked = H(MAGNA_REVOCATION_DS, revocation_secret, credential_type, claims_hash)`
- Shared root kill-switch nullifier emitted when spending `RootRecoveryNote`:
  - `N_root = H(MAGNA_ROOT_REVOCATION_DS, revocation_secret, root_commitment)`
- Root authority kill-switch nullifier emitted when rotating the authority note:
  - `N_root_authority = H(MAGNA_ROOT_AUTHORITY_REVOCATION_DS, revocation_secret, root_commitment, claims_hash)`

Legacy `verify()` rejects when `N` exists and accepts only when proving non-inclusion at anchor header.

Root-linked `verify_linked()` rejects when either:

- `N_linked` exists for the credential-specific status lineage, or
- `N_root` exists for the shared root lineage, or
- `N_root_authority` exists for the currently provided rooted passport authority note.

## 3. Issuance control boundary

- Issuer contract acceptance is immutable for v1:
  - `msg_sender == ORCHESTRATOR_ADDRESS`
- Orchestrator address remains stable for note discovery compatibility.
- Orchestrator signer policy rotates inside orchestrator account contract.

## 4. Claims commitment format (Passport v1)

Single commitment field:

- `claims_hash = H(MAGNA_CLAIMS_DS, schema_version, credential_type, nationality_alpha3_packed, min_age_proven, expiry_ts)`

Canonical passport payload:

- `schema_version: u8` (initial `1`)
- `credential_type: u8` (`PASSPORT`)
- `nationality_alpha3_packed: Field` (packed ASCII, e.g. `USA`)
- `min_age_proven: u8`
- `expiry_ts: u64`

## 4b. Claims commitment format (Instagram v1)

Single commitment field:

- `claims_hash = H(MAGNA_CLAIMS_DS, schema_version, credential_type, handle_hash, expiry_ts)`

Canonical Instagram payload:

- `schema_version: u8` (initial `1`)
- `credential_type: u8` (`INSTAGRAM`)
- `handle_hash: Field`
- `expiry_ts: u64`

Semantics:

- `handle_hash` binds the credential to a specific Instagram handle.
- Ownership is established during off-chain issuance attestation and then carried onchain via the note lineage.
- Magna does not need to reveal the raw handle onchain; policy checks operate on the hashed handle value.

## 5. Root commitment model

- `root_commitment` is an opaque private `Field`.
- The contract does not interpret it as a public identifier or registry key.
- The initial onboarding derivation path is:
  - `root_commitment = H(MAGNA_ROOT_DS, uniqueIdentifier_field)`
- `uniqueIdentifier_field` remains device-local and is not sent to the contract directly.
- Because zkPassport `uniqueIdentifier` is already scoped by domain + request scope, `root_commitment` remains scoped
  to the Magna application context as well.
- Root renewal does **not** assume a renewed or replaced passport will reproduce the same zkPassport
  `uniqueIdentifier`. Instead, Magna treats `root_commitment` as the long-lived identity anchor and refreshes
  passport authority through `RootAuthorityNote`.
- Future migration to salted or vOPRF-backed identifiers only changes client derivation, not onchain note layout.

## 6. Policy model (magna-lib v1)

### Policy

- `credential_type: u8`
- `constraints: [Constraint; MAX_CONSTRAINTS]`

### Constraint

- `claim_id: u8`
- `op: u8`
- `value: Field`

`MAX_CONSTRAINTS` bounds circuit size (recommended v1 value: `8`).

### Claim IDs (v1)

- `0`: NONE
- `1`: AGE_MIN_PROVEN
- `2`: NATIONALITY_ALPHA3
- `3`: EXPIRY_TS
- `4`: INSTAGRAM_HANDLE_HASH

### Operators (v1)

- `0`: NONE
- `1`: EQ
- `2`: NEQ
- `3`: GTE
- `4`: LTE

### Multi-check support

Policy is conjunctive (AND over all non-NONE constraints).  
Example:

- `AGE_MIN_PROVEN GTE 18`
- `NATIONALITY_ALPHA3 NEQ "USA"`

No separate credential per field is required.

## 7. Verify flows (private entrypoints)

### Legacy rootless verify

1. Read caller-owned `CredentialNote` + `StatusNote`.
2. Recompute `claims_hash` from private witness payload and enforce equality with note.
3. Evaluate each policy constraint.
4. Check expiry using Aztec-compatible time model:
   - enqueued public timestamp check and/or tx expiration safeguards.
5. Compute revocation nullifier `N`.
6. Prove `N` did not exist at anchor header.
7. Enqueue public metering call (atomic with proof gate result).

### Root-linked verify

1. Read caller-owned `LinkedCredentialNote` + `LinkedStatusNote` + `RootStatusNote` + `RootAuthorityNote`.
2. Enforce shared linkage:
   - `LinkedCredentialNote.root_commitment == LinkedStatusNote.root_commitment`
   - `LinkedCredentialNote.root_commitment == RootStatusNote.root_commitment`
   - `RootAuthorityNote.root_commitment == RootStatusNote.root_commitment`
3. Recompute `claims_hash` from private witness payload and enforce equality with the linked credential note.
4. For linked passport verifies, also require `RootAuthorityNote.claims_hash == LinkedCredentialNote.claims_hash`.
5. Evaluate each policy constraint.
6. Check inclusion against the minimum of:
   - linked credential `expiry_ts`
   - rooted passport authority `authority_expiry_ts`
   - sponsored window end when sponsored mode is active
7. Compute the linked credential revocation nullifier `N_linked`.
8. Compute the shared root revocation nullifier `N_root`.
9. Compute the rooted authority revocation nullifier `N_root_authority`.
10. Prove all required nullifiers did not exist at the anchor header.
11. Enqueue metering/public sponsorship logic exactly as in the legacy verify path.

Root-linked credentials are optional. A rootless credential never performs the root check.

For Instagram-linked credentials, step 3 recomputes the Instagram `claims_hash` from the private
`handle_hash` witness instead of the passport witness tuple, while the rooted passport authority note still gates
validity and expiry.

## 8. Recovery flows

### Legacy rootless recovery

1. Re-derive Ghost account from scoped identifier.
2. Register orchestrator sender-for-tags and discover `RecoveryNote`.
3. Spend `RecoveryNote`:
   - emit kill-switch nullifier `N`
   - mint fresh `StatusNote` to new active wallet
   - mint fresh `RecoveryNote` to Ghost
   - optional `CredentialNote` refresh preserving semantic claim commitment

### Linked credential recovery

1. Discover `LinkedRecoveryNote`.
2. Spend `LinkedRecoveryNote`:
   - emit credential kill-switch nullifier `N_linked`
   - mint fresh `LinkedStatusNote` to the active wallet
   - mint fresh `LinkedRecoveryNote` to Ghost
   - optional `LinkedCredentialNote` refresh preserving `root_commitment`
3. `RootStatusNote` remains untouched, so other linked credentials remain usable.

### Root recovery

1. Discover `RootRecoveryNote`.
2. Spend `RootRecoveryNote`:
   - emit root kill-switch nullifier `N_root`
   - mint fresh `RootStatusNote` to the new active wallet
   - mint fresh `RootRecoveryNote` to Ghost
3. Previously issued linked credentials remain present but unusable until re-linked/re-issued, because their old root
   lineage is now nullified.

### Root authority refresh

1. Discover the current `RootStatusNote`.
2. Discover the current `RootAuthorityNote` for the authoritative passport `claims_hash`.
3. The orchestrator accepts a fresh zkPassport proof off-chain and calls `refresh_root_authority(...)`.
4. The contract:
   - proves the shared root lineage is still live
   - emits `N_root_authority` for the previous authority note
   - mints a fresh `RootAuthorityNote`
   - mints a fresh linked passport credential lineage under the same `root_commitment`
5. Linked Instagram/email/social credentials keep the same `root_commitment` and become usable again once the new
   authority note is supplied.

### Outcome matrix

- Passport nullified: root dies, all linked descendants die.
- Passport expired only: root survives, linked authority pauses until `refresh_root_authority(...)`.
- Passport renewed/replaced: the same Magna root can refresh authority without recomputing `root_commitment`.

## 9. Randomness

All note randomness fields are generated with Aztec oracle randomness (`random()` or equivalent) and used for note blinding.
