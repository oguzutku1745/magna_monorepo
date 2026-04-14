# Aztec 4.2.0 Multi-Sponsor Source-of-Truth

This document is the implementation guardrail for Magna's multi-sponsor issuer refactor.
It maps each Magna design decision to an official Aztec source for the pinned version family.

## Pinned version

- Repo pin: `.aztecrc` -> `4.2.0-aztecnr-rc.2`
- JS package pins:
  - root `package.json` (`aztec:version`)
  - `apps/magna-web/package.json` (`@aztec/*` deps at `4.2.0-aztecnr-rc.2`)

## Verification matrix

| Magna decision | Official source | Constraint we enforce |
|---|---|---|
| Replace single sponsor gateway with issuer-managed allowlist using public state | [Aztec state/storage reference](https://docs.aztec.network/developers/reference/smart_contract_reference/storage) | Keep issuer-managed gateway authorization readable in private verify paths and represent irreversible allowlisting + delayed disablement with Aztec state vars compatible with private reads (`Map` + `PublicImmutable` + `DelayedPublicMutable`). |
| Keep sponsored verify fee-payment path through sponsor contract | [Aztec Paying Fees](https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees) | Continue to use a fee payment method built from the selected sponsor contract address (`buildCompanySponsorFeeConfig`) and do not change issuer-side verification semantics. |
| Keep authwit-based L2 payment/top-up rail unchanged while supporting many sponsors | [Aztec Authwit framework](https://docs.aztec.network/developers/docs/aztec-nr/framework-description/how_to_use_authwit) | Continue to authorize token transfer calls with authwits; only sponsor selection/authorization surface changes. |
| Keep delayed sponsorship policy readable in private proving | [Aztec state/storage reference](https://docs.aztec.network/developers/reference/smart_contract_reference/storage) | Preserve `DelayedPublicMutable` for `sponsored_credential_type_mask`; do not migrate this to plain `PublicMutable`. |
| Keep one sponsor contract per company, one issuer selected per sponsor contract | [Aztec Paying Fees](https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees) | Sponsor contract remains a fee-payer gateway instance; multi-company support is achieved by multiple sponsor contract addresses, not by shared in-contract company accounting. |

## Frontend integration checklist

Use this checklist whenever changing browser/client code that sends transactions, configures fee payment, or performs
authwit-backed rights top-up.

### 1) Fee-payment wiring (sponsored verifies)

- Official references:
  - [Paying Fees](https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees)
  - [Sending Transactions](https://docs.aztec.network/developers/docs/aztec-js/how_to_send_transaction)
- Repo callsites to verify:
  - `packages/magna-client/src/sponsorship.ts` (`buildCompanySponsorFeeConfig`)
  - `packages/magna-client/src/client.ts` (`loginWith*CompanySponsor`)
  - `apps/magna-web/src/lib/magna.ts` (`verifyPassportWithCompanySponsor`)
- Enforcement:
  - Sponsored verify sends must use a fee config derived from the selected sponsor contract address.
  - No custom fee shortcut path is allowed outside `buildCompanySponsorFeeConfig(...)`.

### 2) Public authwit wiring (L2 rights top-up)

- Official references:
  - [Using Authentication Witnesses (Aztec.js)](https://docs.aztec.network/developers/docs/aztec-js/how_to_use_authwit)
  - [Authwit framework (aztec-nr)](https://docs.aztec.network/developers/docs/aztec-nr/framework-description/how_to_use_authwit)
- Repo callsites to verify:
  - `apps/magna-web/src/lib/magna.ts` (`topUpSponsorRightsFromL2Payment`)
  - `packages/e2e-tests/src/magna.e2e.spec.ts` (`SetPublicAuthwitContractInteraction.create`)
- Enforcement:
  - Public rights purchases must set authwit for the exact `caller + action` tuple before send.
  - Sponsor selection may vary, but authwit semantics must remain unchanged.

### 3) Expiration timestamp / delayed-public reads

- Official references:
  - [Storage / DelayedPublicMutable](https://docs.aztec.network/developers/reference/smart_contract_reference/storage)
  - [Delayed public mutable implementation (pinned)](https://github.com/AztecProtocol/aztec-packages/blob/v4.2.0-aztecnr-rc.2/noir-projects/aztec-nr/aztec/src/state_vars/delayed_public_mutable.nr)
  - [Private context implementation (pinned)](https://github.com/AztecProtocol/aztec-packages/blob/v4.2.0-aztecnr-rc.2/noir-projects/aztec-nr/aztec/src/context/private_context.nr)
- Repo surfaces to verify:
  - Browser/client retry and send paths that call sponsored verifies.
  - Any UX logic that assumes retries are always safe without rebuilding fresh tx context.
- Enforcement:
  - Do not introduce frontend behavior that depends on stale tx contexts after delayed-public horizon changes.
  - Keep retry logic conservative and aligned with Aztec's expiration semantics.

### 4) Multi-sponsor env and selection semantics

- Official references:
  - [Paying Fees](https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees)
  - [Sending Transactions](https://docs.aztec.network/developers/docs/aztec-js/how_to_send_transaction)
- Repo surfaces to verify:
  - `apps/magna-web/src/lib/env.ts`
  - `apps/magna-web/src/lib/magna.ts`
  - `apps/magna-web/src/App.tsx`
- Enforcement:
  - Sponsor address selection must be explicit and deterministic.
  - `sponsorSlot` remains an issuer verify argument and must not be conflated with sponsor contract selection.

## Magna-specific implications

1. `MagnaIssuer` authorization must move from one `PublicImmutable` sponsor gateway to a membership check.
2. `MagnaCompanyRightsRegistry` per-sponsor balance model remains valid (already keyed by sponsor contract address).
3. Client and web surfaces must select a sponsor address explicitly for sponsored verify.
4. Existing direct verify (`issuer.verify(...)`) remains unchanged.
5. Integration tests must prove one issuer with two sponsors, plus balance isolation.
