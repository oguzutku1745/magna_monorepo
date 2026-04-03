# Magna Company Sponsor Contract

`contracts/magna-company-sponsor/src/main.nr` implements Magna's dedicated sponsored-verify gateway.

## Scope

- Becomes the transaction fee payer for a sponsored verification flow.
- Forwards only the Magna issuer sponsored verify path.
- Preserves the original user as the logical caller by passing it explicitly into `MagnaIssuer.verify_sponsored(...)`.
- Rejects over-budget transactions in private using the tx gas settings and the contract-owned `max_fee_cap`.
- Maintains an internal public counter for sponsored verify metering.

## Current shape

- This is a dedicated Magna gateway, not a generic arbitrary-call sponsor.
- The contract is intentionally narrow in v1: it sponsors the issuer verify flow only.
- This keeps the onchain allowlist structural instead of trying to infer arbitrary app targets at runtime.
- The wallet must still attach an external fee configuration at send-time so the account entrypoint treats this
  contract as the tx fee payer before `sponsored_verify(...)` runs.
- `issuer` is initialized once after deployment, and the issuer separately initializes this contract as its allowed
  company sponsor gateway.

## Important note

The contract-side fee-payer phase (`set_as_fee_payer()` / `end_setup()`) is exercised by the live-network e2e path.
The TXE-based unit environment is kept for logic-only checks (meter surface, admin initialization, issuer allowlist),
while the real fee-payer behavior is validated in aztec.js / live-network tests.
