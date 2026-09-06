# `@magna/client`

Relying-party connector for Login with Magna.

```sh
npm install @magna/client@0.2.0
```

ESM with TypeScript declarations. Use Node.js 24.12+ for tooling and a modern
browser with Web Crypto. `@magna/core@0.1.0` is installed automatically. Aztec
read-only verification dependencies are pinned to 5.1.0. Vite applications need
Node global/module polyfills, as configured in `apps/reference-dapp/vite.config.mjs`
in the source repository.

The package contains no wallet, PXE, note-discovery, issuance, recovery, or private witness code.
It does contain the read-only Aztec primitives needed to verify the transaction authorization
returned by the wallet.

## Configuration

```ts
import { CredentialType, MagnaClient, ageGteConstraint } from "@magna/client";

const magna = new MagnaClient({
  clientId: "dapp_reference",
  walletOrigin: "https://wallet.magna.xyz",
  aztecNodeUrl: "https://aztec-node.example",
  consumerGatewayAddress: "0x...",       // gateway registered for this dApp
  sessionAuthorizationAddress: "0x...",  // pinned active Magna sponsor contract
});

const result = await magna.login({
  credentialType: CredentialType.Passport,
  constraints: [ageGteConstraint(18)],
});

if (!result.verified) throw new Error("Magna policy was not satisfied");
```

`loginWithRequirements(...)` supports a single prompt containing multiple credential requirements,
including a specific Instagram handle. `loginWithRedirect(...)` and `completeRedirectLogin(...)`
provide the full-page fallback.

## Authorization boundary

There is no shared Magna session-signing private key. For every requirement, the wallet submits a
fee-sponsored Aztec transaction from the user's WebAuthn account. The sponsor verifies the private
credential policy and then emits a one-time private nullifier in that same transaction:

```text
Poseidon2("MSA2", consumer gateway, request id, challenge, expiry,
          requirement index, normalized policy)
```

Aztec silos that nullifier to the pinned sponsor contract. Before returning `verified: true`, this
SDK independently:

- checks the response against the original request id, challenge, policy hash, client id, origin,
  five-minute lifetime, requirement ids, and order;
- recomputes each policy-bound nullifier;
- fetches each transaction receipt from the configured Aztec node;
- requires the transaction to be mined and successful; and
- requires its transaction effect to contain the exact siloed nullifier.

Changing the requested policy, destination dApp gateway, challenge, expiry, requirement order,
transaction hash, or sponsor address therefore fails verification. A copied frontend response is
not an authority. The transaction is authorized through the user's chain account/AuthWit path,
which in the shipped wallet is the WebAuthn passkey account.

The dApp receives transaction hashes and public request metadata only. It never receives private
notes, note hints, witnesses, passport data, Instagram email/handle witness data, passkey material,
or wallet keys.

Privacy-preserving receipt events are formally descoped from M3. The relying party receives the
signed verification result and transaction hash; aggregate metering remains atomic. In the current
v2 implementation, “signed verification result” is realized by the chain-authorized transaction
effect rather than a separate application signing key.
