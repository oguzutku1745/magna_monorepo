# Magna Reference dApp

This app demonstrates the thin `@magna-protocol/client` Login with Magna integration. It intentionally avoids
wallet-engine and contract-binding dependencies; the SDK performs the required read-only Aztec
transaction-effect check against the configured node.

The app uses the published SDK in both local workspace commands and Docker.
Its dependency specifications pin the npm registry tarballs for client 0.2.0
and core 0.1.0; the lockfile records their integrity hashes. This prevents npm
from substituting the monorepo's SDK workspaces. Startup, tests and builds check
the resolved client and its transitive core and reject workspace resolution.

It is a relying-party login app, not an issuance app. It asks for the Instagram
handle that must be proved and sends that requirement through `@magna-protocol/client`.
The signed Instagram `.eml`, DKIM proof generation, and credential issuance
remain in the Magna management wallet at `http://localhost:5174/user/issue`.

## 3 steps to integrate

1. Configure the wallet origin, Aztec node URL, registered consumer gateway, and active session-authorization contract shown in `.env.example`.
2. Build a policy, for example passport credential with `age >= 18` and `country != USA`.
3. Call `MagnaClient.login(policy)` and unlock only when `result.verified` is true.
