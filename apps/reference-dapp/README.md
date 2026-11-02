# Magna Reference dApp

This app demonstrates the thin `@magna-protocol/client` Login with Magna integration. It intentionally avoids
wallet-engine and contract-binding dependencies; the SDK performs the required read-only Aztec
transaction-effect check against the configured node.

Repository commands use the local V6 SDK workspace (`@magna-protocol/client` 0.3.0).
Startup, tests and builds check that the SDK and its transitive core resolve to
this repository's packages. The V5 client 0.2.1 registry tarball is immutable
and cannot be used against the V6 network.

To verify the actual package boundary, run `npm run sdk:prepare` followed by
`npm run test:sdk:consumer` from the repository root. The harness installs local
tarballs outside the monorepo and rejects workspace resolution. These commands
do not publish packages; V6 registry availability is not assumed.

It is a relying-party login app, not an issuance app. It asks for the Instagram
handle that must be proved and sends that requirement through `@magna-protocol/client`.
The signed Instagram `.eml`, DKIM proof generation, and credential issuance
remain in the Magna management wallet at `http://localhost:5174/user/issue`.

## 3 steps to integrate

1. Configure the wallet origin, Aztec node URL, registered consumer gateway, and active session-authorization contract shown in `.env.example`.
2. Build a policy, for example passport credential with `age >= 18` and `country != USA`.
3. Call `MagnaClient.login(policy)` and unlock only when `result.verified` is true.
