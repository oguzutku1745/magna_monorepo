# Magna Reference dApp

This app demonstrates the thin `@magna/client` Login with Magna integration. It intentionally avoids
wallet-engine and contract-binding dependencies; the SDK performs the required read-only Aztec
transaction-effect check against the configured node.

It is a relying-party login app, not an issuance app. It asks for the Instagram
handle that must be proved and sends that requirement through `@magna/client`.
The signed Instagram `.eml`, DKIM proof generation, and credential issuance
remain in the Magna management wallet at `http://localhost:5174/user/issue`.

## 3 steps to integrate

1. Configure the wallet origin, Aztec node URL, registered consumer gateway, and active session-authorization contract shown in `.env.example`.
2. Build a policy, for example passport credential with `age >= 18` and `country != USA`.
3. Call `MagnaClient.login(policy)` and unlock only when `result.verified` is true.
