# L1 Funding Option B (Production-Oriented)

## Context

The implemented browser flow is intentionally local-dev-first:

- frontend submits L1 `approve` + `purchaseRights` using a local operator key from env
- frontend then claims on L2 via `claim_l1_credit`

This is useful for local testing and rapid iteration, but it is not a production key-management model.

## Option B Goal

Keep L1 as the primary sponsor-funding path while removing operator private keys from browser env.

## Option B Architecture

1. **Operator service owns L1 signer**
   - Store signer in backend/HSM/KMS
   - Frontend never receives the private key
2. **Frontend creates signed funding intent**
   - Sponsor address
   - Rights amount
   - Package id / policy hash
   - Optional replay guard fields
3. **Operator service executes L1 purchase**
   - `approve(paymentToken, portal, paymentAmount)`
   - `purchaseRights(...)`
   - Returns purchase metadata (`purchaseId`, `creditNonce`, `messageLeafIndex`, tx hashes)
4. **L2 claim execution**
   - Either backend triggers `claim_l1_credit` with an authorized Aztec operator account
   - Or frontend claims with user account once metadata is available
5. **Frontend polling UX**
   - `queued -> purchased-on-l1 -> claimable-on-l2 -> claimed`
   - Clear, step-by-step status for operators and testers

## Why keep this as Option B

- Requires backend trust and auth model decisions
- Requires API design and replay protection
- Requires audit scope extension for signer custody

For current local scope, in-browser L1 flow keeps integration velocity high. Option B is the next step for production readiness.

## Migration Checklist

- Add backend endpoint for funding intents and execution
- Remove `VITE_MAGNA_L1_BUYER_PRIVATE_KEY` from browser env
- Add request authentication/authorization for operator actions
- Add idempotency keys and replay-safe intent IDs
- Add backend observability for L1/L2 funding lifecycle
- Update browser panel copy from "local-dev signer" to "operator service request"
