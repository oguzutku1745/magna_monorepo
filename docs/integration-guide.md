# Login with Magna - Integration Guide

## 1) Build policy request

Define the dApp gate in terms of constraints:

- credential type: `PASSPORT`
- constraints:
  - `AGE_MIN_PROVEN GTE 18`
  - `NATIONALITY_ALPHA3 NEQ USA`

## 2) Ask user wallet/PXE to prove

Use `@magna/client`:

- canonical rooted flow:
  - call `loginWithLinkedMagna(...)` (or sponsored `loginWithLinkedCompanySponsor(...)`)
  - pass rooted hints (`hintedRootStatusNote`, `hintedRootAuthorityNote`) plus linked credential hints and claims witness
- legacy compatibility flow:
  - call `loginWithMagna(...)` only when the credential lineage is explicitly rootless

Private proof generation remains local to the user PXE.

## Rooted passport authority flow

For the canonical linked model:

- onboard with `registerRootedPassport(...)` so the issuer mints:
  - `RootStatusNote`
  - `RootRecoveryNote`
  - `RootAuthorityNote`
  - the current linked passport credential lineage
- for linked passport verifies, call `loginWithLinkedMagna(...)` and pass:
  - `hintedRootStatusNote`
  - `hintedRootAuthorityNote`
  - the linked passport credential/status hints
- if the user renews or replaces their passport, have the orchestrator accept a fresh zkPassport proof and call
  `refreshRootAuthority(...)`
- root recovery should be executed from the deterministic ghost account (`recoverRoot(...)`) so old linked descendants
  become invalid immediately

Important outcomes:

- passport nullified: root dies, all linked descendants die
- passport expired only: root survives, but linked verifies pause until authority is refreshed
- passport renewed/replaced: linked credentials can continue under the same `root_commitment` after refresh

## Instagram ownership flow

Magna now also supports an Instagram credential family for proving:

- the user owns an Instagram account, and
- the credential is bound to a specific Instagram handle hash

For this family:

- issue an `INSTAGRAM` credential with the canonical `handle_hash` and `expiry_ts`
- build policy constraints using `INSTAGRAM_HANDLE_HASH EQ <hash>` and optional expiry checks
- call `loginWithInstagram(...)` for rootless mode or `loginWithLinkedInstagram(...)` for rooted mode
- rooted Instagram verifies must include both `hintedRootStatusNote` and `hintedRootAuthorityNote`
- for gasless linked verification, call `loginWithLinkedInstagramCompanySponsor(...)`

The Instagram handle hash should match the `zkPoke` username-hash convention so the issuance attestation
and the Magna witness remain aligned.

## 3) Gate action on receipt

- If tx succeeds, allow protected state transition.
- If tx fails, deny access.

## Gasless onboarding

- For legacy sandbox sponsorship, you can still use Aztec sponsored fee payment via `buildSponsoredFeeConfig(...)`.
- For Magna company-sponsored verify flows, use `loginWithCompanySponsor(...)` or attach
  `buildCompanySponsorFeeConfig(...)` so the tx reaches the account entrypoint with `MagnaCompanySponsor`
  already marked as the external fee payer.
- Company-sponsored verifies are now entitlement-gated:
  - company buys rights on L1 through `MagnaRightsPortal.purchaseRights(...)`
  - company/operator claims the L1 credit on L2 with `MagnaCompanyRightsRegistry.claim_l1_credit(...)`
  - each successful sponsored verify consumes one right through the sponsor gateway
- The opt-in live local-network suite covers the linked company-sponsor path when run with `AZTEC_E2E=1`.
- The dedicated local-network bridge suite (`rights-bridge.e2e.spec.ts`) covers L1 purchase, L2 claim, and replay
  rejection.
- This live e2e path is not part of default `test:ci` today.

## Recovery summary

- Re-derive Ghost key material from scoped identifier.
- Register stable orchestrator sender-for-tags.
- Discover and spend `RecoveryNote`.
- Emit kill-switch nullifier and re-mint fresh status.
- For rooted credentials, `recover_root(...)` is the root-wide recovery/kill-switch path, while
  `refreshRootAuthority(...)` is the non-destructive passport-renewal path.
