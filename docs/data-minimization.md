# Data Minimization - Magna v1

## Stored onchain

- Private note commitments / encrypted logs for:
  - `CredentialNote`
  - `StatusNote`
  - `RecoveryNote`
  - `RootStatusNote`
  - `RootRecoveryNote`
  - linked credential note lineages that carry opaque `root_commitment`
- Revocation nullifiers
- Public metering counters/events (no user identifiers)

## Stored client-side (user device/PXE)

- Note preimages required for private proving
- Account protocol keys / signing credentials
- Scoped Ghost derivation material
- Client-side `root_commitment` derivation material

## Not stored by Magna services

- Raw passport chip data
- Raw birthdate by default (unless explicitly disclosed for a regulated flow)
- User private keys / seed backups
- Plain `uniqueIdentifier` values outside active local session handling
- Public registries keyed by `uniqueIdentifier` or `root_commitment`

## Logging rules

- Never log:
  - `uniqueIdentifier`
  - `root_commitment`
  - `revocation_secret`
  - note preimages
- Log only:
  - tx hash
  - operation type
  - non-sensitive diagnostics
