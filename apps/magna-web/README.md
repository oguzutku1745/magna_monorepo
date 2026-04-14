# Magna Web

Browser app for Magna testnet-readiness on Aztec.

## What is implemented

- External wallet discovery and secure-channel confirmation via `@aztec/wallet-sdk`, with discovery cancellation, reconnect hygiene, and provider disconnect handling
- In-app **passkey wallet path**: create/authenticate passkey, derive deterministic secp256r1 account material, and open embedded wallet session
- Managed embedded wallet as an explicitly local/dev fallback
- Primary zkPassport issuance path: browser request lifecycle + dedicated verification API handoff
  - primary issuance mode defaults to rooted onboarding (`register_rooted_passport`)
  - ghost derivation defaults to scoped `v2_scoped` (legacy `v1_legacy_unscoped` remains compatibility-only)
- Dev-only orchestrator issuance fallback that remains clearly separated from the primary path
  - primary zkPassport flow asks only for the age-threshold request input up front
  - nationality and passport expiry are populated from the verified zkPassport response, not manual entry
- Magna hinted-note sync, verify, and sponsored verify flows
- Sponsor/operator rights surface with **L1-first funding**:
  - primary: L1 `MagnaRightsPortal.purchaseRights(...)` + L2 `claim_l1_credit(...)`
  - fallback: L2 `MagnaRightsPurchaseL2.purchase_rights_public(...)`
- Ghost derivation and root commitment preview surface for recovery-oriented context
- Contract-compatibility matrix panel for browser support visibility
- Chain/deployment fingerprint guard that warns and resets in-app sessions on local restart divergence

## Environment

Copy `.env.example` to `.env` and fill real values:

```bash
cp apps/magna-web/.env.example apps/magna-web/.env
```

```bash
VITE_AZTEC_NODE_URL=http://localhost:8080
VITE_MAGNA_APP_ID=magna-web
VITE_MAGNA_VERIFICATION_API_URL=http://localhost:4310
VITE_MAGNA_ZKPASSPORT_REQUEST_NAME=Magna
VITE_MAGNA_ZKPASSPORT_REQUEST_LOGO=https://magna.identity/logo.png
VITE_MAGNA_ZKPASSPORT_REQUEST_PURPOSE=Issue a Magna passport credential using zkPassport verification.
VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE=magna-passport-onboarding
VITE_MAGNA_ZKPASSPORT_DEV_MODE=false
VITE_MAGNA_ZKPASSPORT_PRIMARY_ISSUANCE_MODE=rooted
VITE_MAGNA_ZKPASSPORT_GHOST_DERIVATION_VERSION=v2_scoped
VITE_MAGNA_ISSUER_ADDRESS=0x...
VITE_MAGNA_COMPANY_SPONSOR_ADDRESS=0x...
VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES=0x...,0x...
VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS=0x...
VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS=0x...
VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS=0x...
VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS=0x...
VITE_MAGNA_SPONSOR_PROFILE_NAME=default-sponsor-profile
VITE_MAGNA_L1_RPC_URL=http://127.0.0.1:8545
VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS=0x...
VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS=0x...
VITE_MAGNA_L1_BUYER_PRIVATE_KEY=0x... # local dev only
VITE_MAGNA_ORCHESTRATOR_ADDRESS=
VITE_MAGNA_WALLET_DISCOVERY_TIMEOUT_MS=60000
VITE_MAGNA_WALLET_EXTENSION_ALLOW_LIST=
VITE_MAGNA_WALLET_EXTENSION_BLOCK_LIST=
VITE_MAGNA_REQUIRE_REAL_SENDS=true
VITE_MAGNA_ENABLE_MANAGED_WALLETS=true
VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR=true
VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP=true
VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX=0
```

### Local-only vs testnet values

- `VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR`, `VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP`, and managed-wallet bootstrap are local/dev-only.
- `VITE_MAGNA_ZKPASSPORT_DEV_MODE=true` is local/dev-only and should be enabled only when intentionally using zkPassport mock passports.
- `VITE_MAGNA_REQUIRE_REAL_SENDS=true` should stay enabled for all readiness and testnet checks.
- `VITE_MAGNA_VERIFICATION_API_URL` points to the dedicated backend that verifies zkPassport proofs and issues via orchestrator.
- `VITE_MAGNA_ZKPASSPORT_REQUEST_*` values define user-visible zkPassport request metadata and scope.
- `VITE_MAGNA_ISSUER_ADDRESS` is the canonical issuer address.
- `VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES` configures available company sponsor gateways.
- `VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS` picks the default sponsor gateway in the UI.
- `VITE_MAGNA_COMPANY_SPONSOR_ADDRESS` is kept as a backward-compatible alias for single-sponsor envs.
- Rights/purchase/token addresses are required for real contract flows.
- L1 funding vars are required for the primary operator top-up path.
- `VITE_MAGNA_ORCHESTRATOR_ADDRESS` is optional and mostly useful for local note-tag/bootstrap behavior.

### Auto-fill from local deployment manifest

If you deployed with `scripts/magna-testnet-validate.mjs deploy`, you can populate web env values from
`deployments/<network>.json`:

```bash
npm run -w @magna/web env:from-local-deploy -- --network-name local \
  --issuer-address 0x... \
  --company-sponsor-address 0x... \
  --company-sponsor-addresses 0x...,0x... \
  --active-company-sponsor-address 0x...
```

Notes:
- This command fills `.env.local`.
- It auto-fills rights-registry / purchase-adapter / L2-token / L1 portal / L1 payment token / node URLs from the manifest.
- It preserves your existing `VITE_MAGNA_L1_BUYER_PRIVATE_KEY` value (manual secret input).
- Issuer and sponsor values are still explicit inputs unless you already persisted them in `.env.local`.
- E2E test deployments are ephemeral and do not produce a reusable manifest by default.

### Full local bootstrap

If you want a single command that prepares the reusable rights stack, deploys the missing web-facing contracts
(`MagnaIssuer`, `MagnaCompanySponsor`, `MagnaConsumer`), seeds sponsor rights, funds the sponsor with Fee Juice,
and writes `apps/magna-web/.env.local`, run:

```bash
npm run web:bootstrap:local
```

Notes:
- This command assumes your Aztec local network is already running.
- By default it refreshes the rights-stack manifest first via `scripts/magna-testnet-validate.mjs deploy`.
- To reuse an existing `deployments/local.json` without re-running the rights deploy, pass:

```bash
npm run web:bootstrap:local -- --skip-rights-deploy
```

After bootstrap, run the dedicated verification API in a separate terminal:

```bash
npm run verification-api:dev
```

## Browser contract compatibility matrix

The app now tracks these browser-critical contract methods:

- Issuer: `register_credential`, `verify`, `verify_linked`, `add_company_sponsor_gateway`, `remove_company_sponsor_gateway`, `is_company_sponsor_gateway`, `refresh_root_authority`, `recover`, `recover_root`
- Sponsor: `sponsored_verify`, `sponsored_verify_linked`, `sponsored_verify_instagram`, `get_sponsored_verify_count`
- Rights registry: `get_company_rights`, `get_remaining_verifies`, `get_consumed_verifies`, `credit_from_l2_payment`, `claim_l1_credit`, `consume_right`
- Rights purchase: `purchase_rights_public`, `get_next_purchase_id`, `get_price_per_verify`, `get_payment_token`, `get_rights_registry`, `get_treasury`

Unsupported/advanced flows intentionally deferred from this browser slice:

- Legacy/rootless migration and compatibility management tooling

## Commands

```bash
npm run -w @magna/web dev
npm run -w @magna/verification-api dev
npm run -w @magna/web lint
npm run -w @magna/web test
npm run -w @magna/web test:e2e
npm run -w @magna/web build
```

## Browser E2E (real-send policy)

Playwright specs are under `apps/magna-web/e2e`. These tests are readiness-focused and do not mock wallet or chain responses.

- They are gated behind `MAGNA_WEB_E2E_REAL=1`.
- Start your local Aztec network yourself.
- Provide `.env` values with real local contract addresses.

## Notes

- External wallet remains the extension-based path; in-app passkey wallet is now a first-class browser path.
- Managed fallback remains local/dev-focused for bootstrap and troubleshooting.
- Production-oriented L1 funding alternative is documented in `docs/l1-funding-option-b.md`.
