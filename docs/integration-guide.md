# Login with Magna — Integration Guide

This guide covers the dApp-facing connector. A third-party dApp uses `@magna-protocol/client` only. Passkeys,
PXE, Aztec contracts, note discovery, and verification execution all stay inside the Magna wallet
origin, which is served by **`apps/magna-management`**.

A working end-to-end example lives in `apps/reference-dapp` — in particular
`src/login-with-magna.ts`.

> **Pilot status.** Magna is pre-release and not deployed to a public network. Passport A2 binds
> claim values to the scanned passport, and Instagram V2 binds the blinded handle claim to an
> authentic governed DKIM key. Rooted Passport A2 issuance emits a contract-siloed nullifier that
> permits one initial lineage per zkPassport scoped identifier. Login authorization no longer uses
> a frontend-held signing key: the SDK verifies a request-bound nullifier in the successful Aztec
> transaction.

---

## 1. Configure the connector

Install `@magna-protocol/client` and pin the wallet origin, Aztec node, registered dApp gateway, and active
Magna session-authorization contract:

```sh
npm install @magna-protocol/client@0.2.0
```

Use Node.js 24.12+ for tooling. The ESM package includes TypeScript declarations
and installs `@magna-protocol/core` automatically. Until registry publication is confirmed,
use the tested tarballs described in the [release procedure](sdk-release.md).
The reference dApp's Vite configuration shows the required Node polyfills for
the read-only Aztec verification dependencies.

```ts
import { MagnaClient } from "@magna-protocol/client";

const magna = new MagnaClient({
  clientId: "dapp_reference",
  walletOrigin: "https://wallet.magna.xyz",
  aztecNodeUrl: "https://aztec-node.example",
  consumerGatewayAddress: "0x...",
  sessionAuthorizationAddress: "0x...",
});
```

For local development, point `walletOrigin` at the Magna Management wallet UI — by default
`http://localhost:5174`. The reference dApp itself runs on `http://localhost:5175`.

`clientId` must be registered with the wallet; the wallet rejects unknown ids and mismatched
origins.

---

## 2. Build a policy

Policies are pure data from `@magna-protocol/core`, re-exported by `@magna-protocol/client`:

```ts
import { ClaimId, ConstraintOp, CredentialType, packAlpha3, type Policy } from "@magna-protocol/client";

const passportGate: Policy = {
  credentialType: CredentialType.Passport,
  constraints: [
    { claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n },
    { claimId: ClaimId.NationalityAlpha3, op: ConstraintOp.Neq, value: packAlpha3("USA") },
  ],
};
```

Constraints are conjunctive — every non-NONE constraint must hold. The connector computes the
canonical policy hash and binds it into the wallet request, so the wallet cannot be asked to
answer a different policy than the one the dApp signed for.

The dApp must not pass Aztec notes, claims witnesses, PXE handles, or contract instances. There is
no API surface that accepts them.

---

## 3. Popup flow

```ts
const result = await magna.login(passportGate);

if (result.verified) {
  unlockProtectedAction();
}
```

The client opens `${walletOrigin}/authorize`, posts a `magna:login-request`, and accepts
`magna:login-response` messages only from the configured `walletOrigin`. Before resolving, it
checks `requestId`, `sessionChallenge`, `policyHash`, `clientId`, `origin`, and expiry, then derives
the expected policy-bound nullifier and requires it in the successful Aztec transaction effect.

---

## 4. Multiple requirements in one prompt

To gate on more than one credential — say an adult passport *and* a specific Instagram handle — send
them as requirements so the user sees a single approval:

```ts
import type { MagnaLoginRequirement } from "@magna-protocol/client";

const requirements: MagnaLoginRequirement[] = [
  { id: "passport", kind: "policy", policy: passportGate },
  { id: "instagram", kind: "instagram-handle", handle: "example" },
];

const result = await magna.loginWithRequirements(requirements);
```

At least one requirement must be a policy. The result is verified only if every requirement is
satisfied.

---

## 5. Redirect fallback

Use redirect mode when popups are blocked or on mobile:

```ts
import { completeRedirectLogin, loginWithRedirect } from "@magna-protocol/client";

await loginWithRedirect(
  {
    clientId: "dapp_reference",
    walletOrigin: "https://wallet.magna.xyz",
    aztecNodeUrl: "https://aztec-node.example",
    consumerGatewayAddress: "0x...",
    sessionAuthorizationAddress: "0x...",
    redirectUri: `${window.location.origin}/login/callback`,
  },
  passportGate,
);
```

On the callback page, exchange the one-time code and validate the chain-bound assertion:

```ts
const result = await completeRedirectLogin({
  clientId: "dapp_reference",
  walletOrigin: "https://wallet.magna.xyz",
  aztecNodeUrl: "https://aztec-node.example",
  consumerGatewayAddress: "0x...",
  sessionAuthorizationAddress: "0x...",
  exchangeUrl: "https://wallet.magna.xyz/api/session/exchange",
});

if (result?.verified) {
  unlockProtectedAction();
}
```

Pending redirect state is held in `sessionStorage` and is single-use. The session-code exchange is
served by `apps/magna-verification-api` (`/api/session/code` and `/api/session/exchange`); the
wallet origin proxies it.

---

## 6. What the dApp receives

**Receives:** a v2 chain-bound session assertion envelope:

```ts
type SessionAssertion = {
  v: 2;
  clientId: string;
  origin: string;
  requestId: string;
  sessionChallenge: string;
  policyHash: string;
  verified: true;
  issuedAt: number;
  expiresAt: number;
  authorizationContract: string;                           // pinned sponsor
  receipt: string;                                         // primary Aztec tx hash
  receipts: { id: string; kind: string; receipt: string }[];
};
```

For multi-requirement logins, `receipts[]` carries one transaction per requirement. The SDK does not
trust this envelope by itself. It recomputes `Poseidon2("MSA2", gateway, request, challenge, expiry,
index, normalized policy)`, silos it to the configured authorization contract using Aztec's official
hash routine, and requires the result in each mined successful transaction effect.

Privacy-preserving receipt events are formally descoped from M3. The relying party receives the
signed verification result and transaction hash; aggregate metering remains atomic. There is no
typed private verification-receipt event. Here, “signed verification result” means the successful
passkey-authorized Aztec transaction plus its request-bound authorization nullifier; it is not a
signature made by a Magna application key.

**Never receives:** passkey material, account secrets, PXE state, private notes or note hints, raw
claims, claim blinds, `root_commitment`, `claims_hash` preimages, zkPassport `uniqueIdentifier`, or
Aztec contract bindings.

Treat the accepted result as a bearer credential for the session: retain the SDK's request and chain
checks and enforce expiry before granting access. Do not treat a
`verified: true` result as an identity — it is a policy answer, and deliberately carries no stable
user identifier.

---

## 7. Wallet-side local setup

These variables belong to the **Magna Management** app, not the integrating dApp:

```dotenv
VITE_REFERENCE_DAPP_ORIGIN=http://localhost:5175
VITE_REFERENCE_DAPP_GATEWAY=0x...
```

The reference dApp needs only:

```dotenv
VITE_MAGNA_WALLET_ORIGIN=http://localhost:5174
VITE_AZTEC_NODE_URL=http://localhost:8080
VITE_MAGNA_CONSUMER_GATEWAY_ADDRESS=0x...
VITE_MAGNA_SESSION_AUTHORIZATION_ADDRESS=0x...
```

The local bootstrap writes these public addresses automatically. No application signing private key
is configured in either frontend.
