# `@magna/recovery-v3`

This is the dependency-isolated protocol foundation for Magna Passport Recovery V3.
It pins Aztec `5.1.0` and implements the shared field encodings, identity derivation,
official Aztec Inbox secret hash, zkPassport Bind bytes, claim derivation, recovery
intent, authorization, and trust-context formulas from the V3 specification.

The shared derivation consumes authenticated outer public input `10` as
`identityValue`. Production permits only `SALTED = 1` with a non-zero, separately
pinned OPRF key hash; the isolated developer profile permits only
`NON_SALTED_MOCK = 2` with `oprf_pk_hash = 0`. The two pairs cannot be mixed.

It does not verify a zkPassport proof and does not authorize recovery by itself.
The dedicated wrapper, generated Solidity verifier, portal, and Aztec message
consumer must all reproduce these formulas and pass the gates in
`docs/passport-recovery-v3-spec.md`.
