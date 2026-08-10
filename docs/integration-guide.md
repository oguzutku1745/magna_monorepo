# Login with Magna — Integration Guide

This guide covers the dApp-facing connector. A third-party dApp uses `@magna/client` only. Passkeys,
PXE, Aztec contracts, note discovery, and verification execution all stay inside the Magna wallet
origin, which is served by **`apps/magna-management`**.

A working end-to-end example lives in `apps/reference-dapp` — in particular
`src/login-with-magna.ts`.

> **Pilot status.** Magna is pre-release and not deployed to a public network. The passport
> issuance path (A2) now binds claim values to the scanned passport: the wrapper circuit
> recursively verifies the zkPassport proof and constrains nationality, age, and expiry against it.
> One gap remains before assertions are safe to rely on for anything of value — there is no
> issuance nullifier, so a single passport can mint unlimited credentials
> ([`threat-model.md` §6.1](./threat-model.md)). Policy answers are trustworthy; per-person
> uniqueness is not yet.

---

## 1. Configure the connector

Install `@magna/client` and configure it with your registered dApp id, the Magna wallet origin, and
Magna's published P-256 session-signing public key:

```ts
import { MagnaClient } from "@magna/client";

const magna = new MagnaClient({
  clientId: "dapp_reference",
  walletOrigin: "https://wallet.magna.xyz",
  magnaPublicKeyJwk: MAGNA_SESSION_PUBLIC_JWK,
});
```

For local development, point `walletOrigin` at the Magna Management wallet UI — by default
`http://localhost:5174`. The reference dApp itself runs on `http://localhost:5175`.

`clientId` must be registered with the wallet; the wallet rejects unknown ids and mismatched
origins.

---

## 2. Build a policy

Policies are pure data from `@magna/core`, re-exported by `@magna/client`:

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
validates the P-256 session assertion signature and checks `requestId`, `sessionChallenge`,
`policyHash`, `clientId`, `origin`, and expiry.

---

## 4. Multiple requirements in one prompt

To gate on more than one credential — say an adult passport *and* a specific Instagram handle — send
them as requirements so the user sees a single approval:

```ts
import type { MagnaLoginRequirement } from "@magna/client";

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
import { completeRedirectLogin, loginWithRedirect } from "@magna/client";

await loginWithRedirect(
  {
    clientId: "dapp_reference",
    walletOrigin: "https://wallet.magna.xyz",
    magnaPublicKeyJwk: MAGNA_SESSION_PUBLIC_JWK,
    redirectUri: `${window.location.origin}/login/callback`,
  },
  passportGate,
);
```

On the callback page, exchange the one-time code and validate the signed assertion:

```ts
const result = await completeRedirectLogin({
  clientId: "dapp_reference",
  walletOrigin: "https://wallet.magna.xyz",
  magnaPublicKeyJwk: MAGNA_SESSION_PUBLIC_JWK,
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

**Receives:** a signed v1 session assertion:

```ts
type SessionAssertion = {
  v: 1;
  clientId: string;
  origin: string;
  requestId: string;
  sessionChallenge: string;
  policyHash: string;
  verified: boolean;
  issuedAt: number;
  expiresAt: number;
  receipt: string | null;                                   // verify tx hash
  receipts?: { id: string; kind: string; receipt: string | null }[];
};
```

`receipt` is the on-chain verification transaction hash, or `null`. For multi-requirement logins,
`receipts[]` carries one entry per requirement, keyed by the `id` you supplied. The signature covers
a canonical serialization prefixed with the domain tag `magna:session-assertion:v1`.

There is no typed private verification-receipt event: the issuer contract meters verifications but
emits no receipt, so a transaction hash is the only on-chain evidence available.

**Never receives:** passkey material, account secrets, PXE state, private notes or note hints, raw
claims, claim blinds, `root_commitment`, `claims_hash` preimages, zkPassport `uniqueIdentifier`, or
Aztec contract bindings.

Treat the assertion as a bearer credential for the session: verify the signature, check that
`policyHash` is the policy you requested, and check expiry before granting access. Do not treat a
`verified: true` result as an identity — it is a policy answer, and deliberately carries no stable
user identifier.

---

## 7. Wallet-side local setup

These variables belong to the **Magna Management** app, not the integrating dApp:

```dotenv
VITE_REFERENCE_DAPP_ORIGIN=http://localhost:5175
VITE_REFERENCE_DAPP_GATEWAY=0x...
VITE_MAGNA_SESSION_SIGNING_KEY=<base64-pkcs8-p256-private-key>
```

The reference dApp needs only:

```dotenv
VITE_MAGNA_WALLET_ORIGIN=http://localhost:5174
VITE_MAGNA_PUBLIC_KEY_JWK={"kty":"EC","crv":"P-256",...}
```

`VITE_MAGNA_SESSION_SIGNING_KEY` is dev-only. A frontend env var is readable by anyone who loads the
page; the current frontend-held key does not provide production-grade signing-key custody.
