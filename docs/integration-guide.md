# Login with Magna - Integration Guide

This guide covers the dApp-facing connector. A third-party dApp uses `@magna/client` only; passkeys, PXE, Aztec contracts, note discovery, and verification execution stay inside the Magna wallet origin.

## 1) Configure the Connector

Install and configure `@magna/client` with the registered dApp id, the Magna wallet origin, and Magna's published P-256 session-signing public key:

```ts
import { MagnaClient } from "@magna/client";

const magna = new MagnaClient({
  clientId: "reference-dapp",
  walletOrigin: "https://wallet.magna.xyz",
  magnaPublicKeyJwk: MAGNA_SESSION_PUBLIC_JWK,
});
```

For local development, point `walletOrigin` at the local Magna web app, for example `http://localhost:5174`.

## 2) Build a Policy

Policies are pure data from `@magna/core` re-exported by `@magna/client`:

```ts
import { ClaimId, ConstraintOp, CredentialType, packAlpha3, type Policy } from "@magna/client";

const passportGate: Policy = {
  credentialType: CredentialType.Passport,
  constraints: [
    { claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n },
    { claimId: ClaimId.NationalityAlpha3, op: ConstraintOp.Neq, value: packAlpha3("USA") },
  ],
};
```

The connector computes the canonical policy hash and binds it into the wallet request. The dApp should not pass Aztec notes, claims witnesses, PXE handles, or contract instances.

## 3) Popup Flow

Use `MagnaClient.login(policy)` for the primary popup and `postMessage` flow:

```ts
const result = await magna.login(passportGate);

if (result.verified) {
  unlockProtectedAction();
}
```

The client opens `${walletOrigin}/authorize`, sends a `magna:login-request`, and only accepts `magna:login-response` messages from the configured `walletOrigin`. It validates the P-256 session assertion signature and checks `requestId`, `sessionChallenge`, `policyHash`, `clientId`, `origin`, and expiry before returning.

## 4) Redirect Fallback

Use redirect mode when popups are blocked or for mobile contexts:

```ts
import { completeRedirectLogin, loginWithRedirect } from "@magna/client";

await loginWithRedirect(
  {
    clientId: "reference-dapp",
    walletOrigin: "https://wallet.magna.xyz",
    magnaPublicKeyJwk: MAGNA_SESSION_PUBLIC_JWK,
    redirectUri: `${window.location.origin}/login/callback`,
  },
  passportGate,
);
```

On the redirect callback page, exchange the one-time code and validate the signed assertion:

```ts
const result = await completeRedirectLogin({
  clientId: "reference-dapp",
  walletOrigin: "https://wallet.magna.xyz",
  magnaPublicKeyJwk: MAGNA_SESSION_PUBLIC_JWK,
  exchangeUrl: "https://wallet.magna.xyz/api/session/exchange",
});

if (result?.verified) {
  unlockProtectedAction();
}
```

The pending redirect state is stored in `sessionStorage` and is single-use.

## 5) Magna Wallet Local Setup

For local wallet development, configure the Magna web app, not the integrating dApp, with the registered dApp origin, its consumer gateway, and the dev-only session signing key:

```dotenv
VITE_REFERENCE_DAPP_ORIGIN=http://localhost:5173
VITE_REFERENCE_DAPP_GATEWAY=0x...
VITE_MAGNA_SESSION_SIGNING_KEY=<base64-pkcs8-p256-private-key>
```

`VITE_MAGNA_SESSION_SIGNING_KEY` is local/dev only. Production must move session signing to a server-side signer or KMS-backed wallet service; do not ship a production signing private key in frontend env.

The dApp receives only the signed session assertion and optional receipt metadata. It never receives passkey material, account secrets, PXE state, private notes, note hints, raw claims, or Aztec contract bindings.
