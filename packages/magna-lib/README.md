# `magna-lib` (Noir)

Shared policy primitives for dApps integrating Magna.

## Included v1 primitives

- `Policy` with fixed `MAX_CONSTRAINTS`
- `Constraint` tuple `{ claim_id, op, value }`
- Passport-oriented claim evaluator helpers
- Country alpha-3 packing helper (`pack_alpha3`)

This package is intentionally small and deterministic so both issuer-side and dApp-side Noir code can share policy semantics.
