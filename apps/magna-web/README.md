# Magna Web

Browser app scaffold for Magna on Aztec.

## What is implemented

- External wallet discovery and secure-channel confirmation via `@aztec/wallet-sdk`
- Local managed wallet onboarding via browser `EmbeddedWallet`
- Dev-only orchestrator issuance path for local network
- Magna hinted-note sync and passport verify flows
- Company-sponsored verify flow when the sponsor contract address is configured
- Browser passkey spike UI to capture WebAuthn credential metadata for the future custom account path

## Environment

Copy these into a local `.env` file as needed:

```bash
VITE_AZTEC_NODE_URL=http://localhost:8080
VITE_MAGNA_APP_ID=magna-web
VITE_MAGNA_ISSUER_ADDRESS=0x...
VITE_MAGNA_COMPANY_SPONSOR_ADDRESS=0x...
VITE_MAGNA_ORCHESTRATOR_ADDRESS=
VITE_MAGNA_ENABLE_MANAGED_WALLETS=true
VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR=true
VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP=true
VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX=0
```

## Commands

```bash
npm run -w @magna/web dev
npm run -w @magna/web lint
npm run -w @magna/web test
npm run -w @magna/web build
```

## Notes

- The managed-wallet path is intended for local/devnet development. Production onboarding should move the issuer/orchestrator flow behind a service boundary.
- The passkey section is intentionally an implementation spike. It records WebAuthn outputs without claiming that the full Aztec/WebAuthn signer bridge is finished.
