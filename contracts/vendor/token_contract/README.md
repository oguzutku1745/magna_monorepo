# V6 Token source for Noir cross-contract calls

Source: https://github.com/aztec-labs-eng/aztec-node/blob/v6.0.0/noir-projects/noir-contracts/contracts/app/token_contract/src/main.nr

Upstream release commit: d2e67c1 (v6.0.0). Original main.nr SHA-256: `f318541ef1202e4cf05ad3d19098bb6e9e2001b558a27eeb8c1c80f3cca726e5`.

The source is unchanged except omission of `mod test;` and its following blank line. The manifest replaces relative repository dependencies with the exact same aztec-nr v6.0.0 Git URL/tag as Magna. Depending on the entire aztec-node Token directory otherwise introduces a second Aztec type tree through its relative aztec-nr checkout. The omitted upstream test module and generic-proxy test dependency are not needed for this cross-contract dependency.

TXE tests and TypeScript use the official published `@aztec-labs/noir-contracts.js@6.0.0` Token artifact. This vendored source is not a separately deployed token implementation. See LICENSE for upstream Apache-2.0 terms.
