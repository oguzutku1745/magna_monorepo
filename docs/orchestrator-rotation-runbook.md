# Orchestrator Rotation Runbook (v1)

## Objective

Rotate orchestrator signing/auth credentials **without changing orchestrator address** to preserve sender-for-tags compatibility for recovery discovery.

## Preconditions

- Issuer contract immutable allowlist still points to `ORCHESTRATOR_ADDRESS`.
- Account contract supports signer/passkey policy updates.

## Procedure

1. Prepare new signing/passkey material.
2. Submit orchestrator account-policy update transaction.
3. Validate that new signatures authorize expected calls.
4. Revoke old signer material in account policy.
5. Run issuance smoke test:
   - register test credential
   - verify note delivery/discovery in test PXE

## Emergency mode

If compromise suspected:

1. Suspend orchestrator issuance operations immediately.
2. Rotate account auth policy as highest priority.
3. Resume issuance only after policy update confirmation.
