# zkPassport Mapping for Magna v1

## Why this mapping exists

Magna stores a single `claims_hash` in `CredentialNote`, so we need a deterministic canonical payload derived from zkPassport outputs.

This document is zkPassport-specific. Magna also supports non-zkPassport families such as Instagram, but those
families use their own attestation sources and canonical payloads.

## zkPassport capabilities used

- Age predicates (`gte`, `lte`, `range`)  
  Source: https://docs.zkpassport.id/examples/age-verification
- Nationality predicates and disclosure, including alpha-3 support  
  Source: https://docs.zkpassport.id/examples/nationality
- Expiry date disclosure (`expiry_date`)  
  Source: https://docs.zkpassport.id/examples/kyc
- Scoped `uniqueIdentifier` derivation by domain/scope  
  Source: https://docs.zkpassport.id/faq

## Canonical passport payload (v1)

- `schema_version: u8`
- `credential_type: u8` (`PASSPORT`)
- `nationality_alpha3_packed: Field`
- `min_age_proven: u8`
- `expiry_ts: u64`

Hash:

- `claims_hash = H(MAGNA_CLAIMS_DS, schema_version, credential_type, nationality_alpha3_packed, min_age_proven, expiry_ts)`

## Security handling notes

- `uniqueIdentifier` is treated as sensitive and device-only.
- Ghost scope uses `magna_recovery::<credential_type>`.
- Ghost seed KDF vector path (TS/Noir lock): `ghost_seed = Poseidon2(DS, uniqueIdentifier_field)` with
  `DS = MAGNA_GHOST_DS (0x4D414748)`.
- No raw identity document data is persisted in Magna contracts.
- zkPassport documents `uniqueIdentifier` as stable for the same **ID**, not as a person-wide identifier across
  renewed/replaced documents. Magna therefore does not assume passport renewal reproduces the same root seed.

## Root commitment handling

Magna's linked-credential design does **not** place raw `uniqueIdentifier` onchain.

- The contract only sees an opaque private `root_commitment: Field`.
- Current default derivation path:
  - `root_commitment = Poseidon2(MAGNA_ROOT_DS, uniqueIdentifier_field)`
- This is intentionally separate from Ghost derivation so the recovery KDF and identity-root handle do not reuse the
  same field output.
- Because zkPassport already scopes `uniqueIdentifier` by domain + request scope, the derived `root_commitment` is
  also application-scoped.
- Magna treats this derivation as the **onboarding** path for a long-lived root. After onboarding, passport renewal or
  replacement refreshes rooted passport authority rather than deriving a brand-new root from a future document.
- If zkPassport later ships salted identifiers or a vOPRF-backed variant, Magna can swap the client-side derivation
  while keeping the onchain contract interface unchanged.

## Rooted passport authority semantics

- A separate `RootAuthorityNote` stores:
  - the long-lived `root_commitment`
  - the currently authoritative passport `claims_hash`
  - `authority_expiry_ts`
- Linked passport verifies require the current authority note and the linked passport credential to agree on the
  authoritative `claims_hash`.
- Linked Instagram verifies require:
  - the shared root lineage to be live
  - the rooted passport authority note to be live and unexpired
  - the Instagram-linked credential lineage to be live
- Passport expiry does **not** nullify the root. It pauses linked authority until the orchestrator accepts a fresh
  zkPassport proof and refreshes the authority note.

## Linked credential semantics

- **Rootless path**: keep the existing passport flow where a credential stands on its own `StatusNote`.
- **Root-linked path**: social/email/other credentials carry the same `root_commitment` and depend on the rooted
  passport authority note.
- A linked credential verifies only when:
  - its own credential-specific status lineage is still live, and
  - the shared root lineage for `root_commitment` is still live, and
  - the rooted passport authority note is live.
- Root revocation disables every credential linked to that `root_commitment`.
- Credential-specific rotation/recovery disables only that credential and leaves the shared root active.
- Passport nullification is treated differently from non-passport linked credentials: it escalates to root-wide
  revocation rather than a local linked-credential revoke.

## Non-zkPassport families

- `Instagram` is not derived from zkPassport claims.
- Magna’s Instagram v1 family is backed by the external `zkPoke` ownership/handle attestation flow and uses
  a canonical `handle_hash` commitment instead of passport fields such as age or nationality.
