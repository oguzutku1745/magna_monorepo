# Magna Verification API

Dedicated backend service for the zkPassport -> Magna issuance handoff.

## What it does

- Verifies the local A2 wrapper proof while keeping the zkPassport outer proof, passport claims,
  and scoped identifier out of the server request.
- Checks the profile-pinned nullifier type, OPRF public-key-hash field, registry roots, request
  context, FaceMatch mode, and proof time bounds. Production accepts only strict + `SALTED = 1`
  with OPRF key ID `1`; explicit developer mode accepts only regular +
  `NON_SALTED_MOCK = 2` with `oprf_pk_hash = 0` through a separate artifact.
- Sends issuance via the Magna orchestrator path to the issuer contract.
- Verifies a browser-generated Instagram V2 proof and accepts it only when its proof-bound
  DKIM public-key hash is present in the configured governed Instagram key list. The API never
  receives the `.eml`, handle, handle hash, or handle blind.
- Does not authorize Recovery V3. Recovery proof generation, Ethereum portal submission, canonical
  Inbox inclusion, and private Aztec consumption are client-driven and remain available when this
  service is offline.

## Required environment variables

- `MAGNA_ISSUER_ADDRESS`

If `MAGNA_ISSUER_ADDRESS` is not set, the API also accepts `VITE_MAGNA_ISSUER_ADDRESS`
from `apps/magna-management/.env` or `.env.local`.

## Optional environment variables

- `MAGNA_VERIFICATION_API_PORT` (default: `4310`)
- `MAGNA_VERIFICATION_ALLOWED_ORIGIN` (default: `*`)
- `MAGNA_ZKPASSPORT_DOMAIN` (default: `localhost` for local dev)
- `MAGNA_ZKPASSPORT_DEV_MODE` (default: `false`; enable only for local mock-passport testing)
- `MAGNA_AZTEC_NODE_URL` (default: `http://localhost:8080`)
- `MAGNA_LOCAL_TEST_ACCOUNT_INDEX` (default: `0`)
- `MAGNA_ORCHESTRATOR_ADDRESS` (optional consistency check against imported local-test account)
- `MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES` (comma/space-separated Noir-field hashes;
  required to enable Instagram issuance and checked fail-closed per proof)

At startup, the service auto-loads environment values from:

- `apps/magna-verification-api/.env.local`
- `apps/magna-verification-api/.env`
- `apps/magna-management/.env.local`
- `apps/magna-management/.env`

If `MAGNA_ZKPASSPORT_DEV_MODE` is not set, the API also accepts `VITE_MAGNA_ZKPASSPORT_DEV_MODE`
from the management env files so local mock-proof mode can be driven from one place.

## Run

```bash
npm run -w @magna/verification-api dev
```

## Endpoints

- `GET /health`
- `POST /zkpassport/verify-and-issue`
- `POST /zkpassport/verify-and-refresh-root-authority`
- `POST /instagram/verify`

### `POST /zkpassport/verify-and-issue` body

```json
{
  "activeOwner": "0x...",
  "schema": "passport-a2-v1",
  "wrapperProof": {},
  "wrapperPublicInputs": [],
  "registryContext": {},
  "credentialValidUntil": "...",
  "mode": "rooted",
  "ghostDerivationVersion": "v2_scoped"
}
```

Notes:
- Rooted A2 with `v2_scoped` is the supported pre-release product path. There is no deployed
  compatibility surface to preserve.

### `POST /zkpassport/verify-and-refresh-root-authority` body

```json
{
  "schema": "passport-a2-v1",
  "wrapperProof": {},
  "wrapperPublicInputs": [],
  "registryContext": {},
  "credentialValidUntil": "...",
  "activeOwner": "0x...",
  "ghostOwner": "0x..."
}
```

Notes:
- This endpoint is the real rooted passport renewal path.
- The backend verifies a fresh zkPassport proof first.
- The backend publishes only the renewal authorization commitment. Rooted note hints stay in the
  holder wallet and are consumed by the later local private call.
- Renewal keeps the same rooted lineage anchor and refreshes authority on-chain rather than
  deriving a brand-new root.

`POST /zkpassport/verify-for-root-recovery` was removed. A caller attempting the retired service
method fails closed; see `docs/passport-recovery-v3-spec.md` for the permissionless portal path.

### `POST /instagram/verify` body

```json
{
  "schema": "instagram-v2",
  "proof": {
    "proof": [1, 2, 3],
    "publicInputs": ["... seven proof-bound fields ..."]
  },
  "activeOwner": "0x..."
}
```

The wallet browser verifies DKIM and generates the proof locally. The seven public inputs are the
DKIM-key hash, email nullifier, opaque blinded `claims_hash`, expiry, active owner, issuer address,
and L1 chain ID. The API verifies that exact proof, checks all deployment bindings, requires the
DKIM key to match `MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES`, and only then submits issuance. Unknown
fields—including the retired `emlBase64` and `claimedHandle` fields—are rejected. An empty key list
disables this endpoint. Adding or removing current/historical DKIM hashes is an operator-governed
trust decision.
