# Magna Recovery Portal

This directory contains the immutable, single-wrapper-version EVM portal for
Magna Passport Recovery V3. It uses the generated zkPassport/Barretenberg
verifier ABI, the official zkPassport Root Registry `isRootValid` ABI, and the
canonical Aztec 5.1 Inbox `sendL2Message` ABI.

The developer wrapper and real EVM verifier are now generated and pinned:

- wrapper runtime bundle SHA-256: `586b05f7ed5f013211d4c313ac3a0653b9d28fef9b67959a1498cbe47ad6de1c`
- Solidity verifier SHA-256: `a93d2db0db89b064a0621de5919d95ef8beeb93ec472563a6aebae028662a8d3`
- EVM verification key SHA-256: `23e7d4b0b0d74c83dd227aa35fd1a675cddbbbe9e7e027495c5d4da6a130551e`

The local registry integration uses the unmodified, hash-pinned official
zkPassport `RootRegistry`, `RegistryInstance`, `CertificateRegistry`, and
`CircuitRegistry` source from commit
`a843c1e3c541be889e2b092efa5c04fbc80ac58f`. Unit test doubles remain only for
isolated portal rejection/rollback tests and never constitute Gate B evidence.
Gate B-dev still requires a fresh official mobile-app recovery scan to generate
the exact recovery-bound proof and submit it through the generated verifier,
official local registry stack, canonical Inbox, and private Aztec consumer.

The local bootstrap does not copy roots out of the candidate proof. It queries
the official `@zkpassport/registry` `0.14.0` client on Sepolia, independently
validates the packaged certificate set and circuit manifest, records their
content hashes, and only then seeds the official local registry contracts. The
browser has no registry oracle key. A root rotation between bootstrap and scan
therefore fails closed and requires a clean re-bootstrap plus a fresh proof.

Run the isolated portal gate after the ordinary local deployment:

```bash
npm run recovery-v3:bootstrap:local
npm run -w @magna/management dev
```

The positive live action automatically checks destination, nonce, Inbox-secret
hash, expiry, inner-proof and inner-VK witness mutations, every wrapper public
input, the wrapper proof, and replay. A UI success message is not enough by
itself: retain the displayed portal transaction, Inbox leaf/index, bootstrap
evidence hash, version output, and redacted proof metadata. Never commit or
upload the raw outer proof or its scoped identifier.

Because the V3 trust-context hash includes the portal's own address, deployment
must precompute the next ordinary `CREATE` address from the frozen deployer and
nonce, calculate the trust context with that address, deploy, and assert the
result. Do not use `CREATE2` here: its address depends on constructor arguments,
which include the trust-context hash, and would create a circular calculation.
