# Magna Verify Meter Hook Contract (v1)

This contract provides issuer-only, meter-only public metering for verification calls.

## Scope

- Maintains a delayed, publicly readable allowlist mask for credential types.
- Exposes a public `meter_verify_or_revert(credential_type)` hook (meter-only; does not gate eligibility).
- Restricts `meter_verify_or_revert` to a configured `issuer` (set by admin) to prevent direct external calls.
- Intended to be called by the verify path via enqueued public call for atomic metering.

## Notes

This package is a public metering hook, not a fee-paying sponsor contract. Integrating Magna with a full Aztec fee-paying contract should follow the sponsored fee-payment interfaces and test patterns used in `@aztec/noir-contracts`.
