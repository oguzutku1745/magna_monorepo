# `@magna/client`

Thin TypeScript connector for relying-party applications using Login with Magna.

The package intentionally contains no Aztec wallet, PXE, contract-binding, passkey, note-discovery,
issuance, or recovery implementation. Those responsibilities stay inside the Magna wallet origin,
currently served by `apps/magna-management`.

## Popup login

```ts
import {
  CredentialType,
  MagnaClient,
  ageGteConstraint,
  type Policy,
} from "@magna/client";

const magna = new MagnaClient({
  clientId: "dapp_reference",
  walletOrigin: "http://localhost:5174",
  magnaPublicKeyJwk: JSON.parse(MAGNA_PUBLIC_KEY_JWK),
});

const policy: Policy = {
  credentialType: CredentialType.Passport,
  constraints: [ageGteConstraint(18)],
};

const result = await magna.login(policy);
if (!result.verified) throw new Error("Magna policy was not satisfied");
```

Use `loginWithRequirements(...)` when a login request combines a policy with additional
wallet-validated requirements, such as an Instagram handle requirement.

## Redirect fallback

`loginWithRedirect(...)` and `completeRedirectLogin(...)` provide the full-page fallback for
popup-blocked or mobile contexts. The wallet returns a one-time code; the connector exchanges it
and validates the signed session assertion against the original request context.

## Security boundary

Every successful result is validated against Magna's configured P-256 public key and bound to the
request id, session challenge, policy hash, client id, relying-party origin, and expiry. Integrating
dApps receive only the signed verification result and transaction receipt references. They do not
receive credentials, private notes, witnesses, passport data, Instagram email data, or wallet keys.

See `apps/reference-dapp` and `docs/integration-guide.md` for the current integration example.
