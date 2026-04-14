# Magna Verification API

Dedicated backend service for the zkPassport -> Magna issuance handoff.

## What it does

- Verifies zkPassport proofs on the server using `@zkpassport/sdk`.
- Extracts the trusted `uniqueIdentifier`.
- Normalizes disclosed zkPassport fields into Magna canonical passport claims.
- Derives `ghostOwner` and `rootCommitment` from `uniqueIdentifier`.
- Sends issuance via the Magna orchestrator path to the issuer contract.
- Defaults onboarding mode to rooted issuance unless legacy mode is explicitly requested.

## Required environment variables

- `MAGNA_ISSUER_ADDRESS`

If `MAGNA_ISSUER_ADDRESS` is not set, the API also accepts `VITE_MAGNA_ISSUER_ADDRESS`
from `apps/magna-web/.env.local`.

## Optional environment variables

- `MAGNA_VERIFICATION_API_PORT` (default: `4310`)
- `MAGNA_VERIFICATION_ALLOWED_ORIGIN` (default: `*`)
- `MAGNA_ZKPASSPORT_DOMAIN` (default: `localhost` for local dev)
- `MAGNA_ZKPASSPORT_DEV_MODE` (default: `false`; enable only for local mock-passport testing)
- `MAGNA_AZTEC_NODE_URL` (default: `http://localhost:8080`)
- `MAGNA_LOCAL_TEST_ACCOUNT_INDEX` (default: `0`)
- `MAGNA_ORCHESTRATOR_ADDRESS` (optional consistency check against imported local-test account)

At startup, the service auto-loads environment values from:

- `apps/magna-verification-api/.env.local`
- `apps/magna-verification-api/.env`
- `apps/magna-web/.env.local`
- `apps/magna-web/.env`

If `MAGNA_ZKPASSPORT_DEV_MODE` is not set, the API also accepts `VITE_MAGNA_ZKPASSPORT_DEV_MODE`
from the web env files so local mock-proof mode can be driven from one place.

## Run

```bash
npm run -w @magna/verification-api dev
```

## Endpoints

- `GET /health`
- `POST /zkpassport/verify-and-issue`

### `POST /zkpassport/verify-and-issue` body

```json
{
  "proofs": [],
  "originalQuery": {},
  "queryResult": {},
  "activeOwner": "0x...",
  "ageThreshold": 21,
  "mode": "rooted",
  "ghostDerivationVersion": "v2_scoped"
}
```

Notes:
- If `mode` is omitted, the API defaults to `"rooted"`.
- If `ghostDerivationVersion` is omitted, the API resolves it by mode:
  - rooted => `v2_scoped` (canonical)
  - passport => `v1_legacy_unscoped` (compatibility)
