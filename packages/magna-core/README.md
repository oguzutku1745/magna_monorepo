# `@magna-protocol/core`

Dependency-free TypeScript primitives for Magna policies, popup/redirect messages,
and chain-bound session authorization fields. ESM with TypeScript declarations;
Node.js 24.12+ or a modern browser with Web Crypto.

```sh
npm install @magna-protocol/core@0.1.1
```

```ts
import { CredentialType, ageGteConstraint, normalizePolicy } from "@magna-protocol/core";

const policy = normalizePolicy({
  credentialType: CredentialType.Passport,
  constraints: [ageGteConstraint(18)],
});
```

These primitives do not verify a login or establish chain state. For dApp login,
install `@magna-protocol/client`, which re-exports these helpers and verifies the wallet's
transaction authorization against the configured Aztec node. Wallets, private
notes, proving, and recovery are outside this package.

## License

Apache-2.0. See [LICENSE](LICENSE).
