# Magna - Private Credential Layer (Aztec)

This repository contains the implementation of Magna v1:

- Aztec/Noir protocol contracts for private credential issuance and verification.
- A recovery model based on three notes:
  - `CredentialNote`
  - `StatusNote`
  - `RecoveryNote`
- A rooted passport-authority model for linked credentials:
  - `RootStatusNote`
  - `RootRecoveryNote`
  - `RootAuthorityNote`
- A TypeScript client SDK (`magna-client`) for register / login / recovery flows.
- A Noir helper library (`magna-lib`) for dApp policy verification helpers.
- A reference dApp integration package.
- A root-linked credential model for shared identity revocation across multiple credentials.

## Repository layout

- `contracts/magna-issuer/` - Noir contract implementing issuer / verify / recover logic.
- `contracts/magna-company-sponsor/` - dedicated company-owned sponsor gateway for sponsored verify flows.
- `contracts/magna-company-rights-registry/` - L2 rights ledger consumed by sponsor verifies.
- `contracts/magna-verify-meter-hook/` - Noir public meter hook for verification sponsorship metering.
- `contracts/magna-consumer/` - Tiny consumer dApp gate contract using `magna-lib` helpers.
- `contracts/magna-verify-meter-hook-instant/` - Zero-delay verify meter hook used for live E2E sponsorship checks.
- `l1-contracts/magna-rights-portal/` - Solidity L1 purchase portal that emits Aztec Inbox credits.
- `packages/magna-client/` - TypeScript SDK for app integrations.
- `packages/magna-lib/` - Noir policy primitives for dApps.
- `packages/contracts-bindings/` - generated/typed contract bindings consumed by TS packages.
- `packages/e2e-tests/` - aztec.js integration tests against local network.
- `apps/reference-dapp/` - Minimal integration flow demonstrating Login with Magna.
- `docs/` - Threat model, protocol spec, and integration guidance.
- `Diagrams/` - Product and flow diagrams used as design references.

## Tooling commands

- Pinned Aztec CLI/toolchain version for repo scripts: `4.2.0-aztecnr-rc.2`.
- `npm run aztec:version` - verify the pinned Aztec CLI version.
- `npm run compile:contracts` - compile contract crates via toolchain-aware wrapper.
- `npm run codegen:contracts` - generate TypeScript contract bindings under `packages/contracts-bindings/src`.
- `npm run vectors:sync` - sync shared golden vectors JSON into TS/Noir generated constants.
- `npm run test:ci` - run pinned contract tests (`magna-verify-meter-hook`, `magna-issuer`, `magna-company-rights-registry`, `magna-company-sponsor`) and `@magna/client` tests.
- `npm run -w @magna/e2e-tests test` - run e2e tests (set `AZTEC_E2E=1` to enable integration suite).

## v1 scope

- Primary credential source: `zkPassport`.
- First non-passport credential family: `Instagram` ownership + specific handle binding, backed by the
  `zkPoke` email/DKIM attestation flow.
- Recovery uses deterministic Ghost account derivation with scoped identifiers.
- Issuance origin is a stable orchestrator account to satisfy Aztec sender-for-tags discovery constraints.
- Issuer contract accepts issuance only from immutable `ORCHESTRATOR_ADDRESS`.
- Root-linked credentials now depend on a renewable rooted passport authority note.
- Root revocation still kills every linked descendant.
- Passport expiry pauses linked authority until `refresh_root_authority(...)` refreshes the authority note and
  remints the current linked passport lineage under the same `root_commitment`.
- Rooted passport onboarding is the canonical default path (`register_rooted_passport` + linked verify paths).
- Legacy rootless passport flows are compatibility-only and must be explicitly selected.
- Sponsored verify bounds remain credential-scoped today, not root-scoped.

## Status

Implementation is organized to mirror the approved project plan and is intentionally explicit about all Aztec-coupled assumptions and constraints.

## Sponsorship and rights

Magna now treats fee sponsorship and entitlement as separate rails:

- **No-drain sponsorship (Option A):** fee-cap + rate-limit controls.
- **Rights rail (Phase 1 Option B):** L1 purchase -> L2 claim -> per-verify rights consumption.

Full details are documented in:

- `docs/no-drain-sponsorship.md`

## Current credential families

- `Passport`: zkPassport-backed canonical claims (`age`, `nationality`, `expiry`).
- `Instagram`: custom attested claim family proving ownership of a specific Instagram handle via a
  hashed-handle witness.

## Stability notes

- `root_commitment` derivation is version-1 stable and currently derived client-side from the scoped
  zkPassport `uniqueIdentifier` during onboarding.
- Ghost derivation is now versioned to avoid silent recovery breakage:
  - `v1_legacy_unscoped`: compatibility path for existing rootless lineage.
  - `v2_scoped`: canonical path for rooted onboarding (scope-aware by credential type).
- Passport renewal/replacement does not assume the renewed document reproduces the same zkPassport
  `uniqueIdentifier`; the long-lived Magna root is refreshed through a separate rooted authority note instead.
- If upstream identity primitives later move to salted or vOPRF-backed identifiers, Magna should add an
  explicit migration/versioning path rather than silently changing the derivation.
