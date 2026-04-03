# `@magna/client`

TypeScript SDK for Magna v1 lifecycle management.

## Flows

- `registerPassport()`:
  - computes canonical `claims_hash`
  - sends issuance request from orchestrator address
- `registerInstagram()`:
  - computes the Instagram ownership/handle `claims_hash`
  - sends issuance request from orchestrator address
- `loginWithMagna()`:
  - normalizes policy constraints
  - calls private `verify(...)`
- `loginWithInstagram()`:
  - normalizes policy constraints
  - calls private `verify_instagram(...)`
- `loginWithLinkedInstagram()` / `loginWithLinkedInstagramCompanySponsor()`:
  - prove a root-linked Instagram credential, optionally through the company sponsor gateway
- `recover()`:
  - spends `RecoveryNote` as Ghost account and remints active state
- `deriveGhost()`:
  - derives deterministic Ghost seed from `Poseidon2(DS, uniqueIdentifier_field)`
  - defaults to `MAGNA_GHOST_DS` (separate from revocation DS)
  - `uniqueIdentifier` must be Field-compatible (`bigint` or decimal/hex string)

## Security notes

- Do not persist raw zkPassport `uniqueIdentifier`.
- Instagram handle verification in Magna v1 is based on a hashed-handle witness aligned with the external
  `zkPoke` attestation flow.
- SDK default hasher is Poseidon2-with-separator (`@aztec/foundation`) to match Noir formulas.
- Golden vector tests lock TS outputs against Noir vectors for claims hash, revocation nullifier, and ghost seed KDF.

## Contract typing

`@magna/client` accepts either:

- a generic Aztec contract-like object (`methods.*.send()`), or
- generated bindings from `@magna/contracts-bindings` for stronger typing.
