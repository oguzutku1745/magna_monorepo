# Magna Reference dApp

This app demonstrates the thin `@magna/client` Login with Magna integration. It intentionally avoids direct chain, wallet-engine, or contract-binding dependencies.

It is a relying-party login app, not an issuance app. It asks for the Instagram
handle that must be proved and sends that requirement through `@magna/client`.
The signed Instagram `.eml`, DKIM proof generation, and credential issuance
remain in the Magna management wallet at `http://localhost:5174/user/issue`.

## 3 steps to integrate

1. Configure the dApp with `VITE_MAGNA_WALLET_ORIGIN` and `VITE_MAGNA_PUBLIC_KEY_JWK`.
2. Build a policy, for example passport credential with `age >= 18` and `country != USA`.
3. Call `MagnaClient.login(policy)` and unlock only when `result.verified` is true.
