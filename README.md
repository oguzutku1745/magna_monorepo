# Magna — Private Credential Layer on Aztec

Magna turns a real-world proof into a reusable private credential. This monorepo
contains the Aztec/Noir contracts, Passport A2 and Instagram V2 proof adapters,
Recovery V3, the management wallet, and the `@magna-protocol/client` dApp connector.

## Review starting points

- [Milestone status and reviewer commands](docs/reviewer-guide.md)
- [Protocol specification](docs/protocol-spec.md)
- [Threat model](docs/threat-model.md)
- [SDK integration guide](docs/integration-guide.md)
- [Recovery V3 specification](docs/passport-recovery-v3-spec.md)
- [September 6 official mobile recovery evidence](docs/evidence/recovery-v3-mobile-2026-09-06.md)
- [Clock implementation and measured timings](docs/evidence/local-clock-docker-2026-09-06.md)
- [SDK release procedure](docs/sdk-release.md)
- [Apache-2.0 publication and clean-history evidence](docs/evidence/public-release-2026-09-12.md)

M1–M5 are complete for the agreed local developer scope, including SDK
publication and installation from npm. Public-network deployment, production custody and the
supported-document `SALTED=1` run remain M6 work. The local developer proof uses
the official zkPassport app with `NON_SALTED_MOCK=2`; it is not production
identity/privacy evidence.

## Run the local stack

Use Docker Desktop and Node.js 24.12+ with npm. From this checkout:

```sh
npm run docker:local
```

This clean command builds the digest-pinned Aztec 5.1.0 image, then replaces only
Magna's disposable chain and generated deployment state. A failed image build
leaves the previous stack intact. A successful reset requires fresh local
credentials; OS passkeys are not deleted.

| Service | URL |
| --- | --- |
| Management wallet | http://localhost:5174 |
| Reference dApp | http://localhost:5175 |
| Verification API health | http://localhost:4310/health |
| Aztec RPC | http://localhost:8080 |
| Docker Anvil RPC | http://127.0.0.1:18545 |

Bootstrap satisfies the existing 3,600-second gateway activation delay in
historical chain time, then catches up to wall time before starting the apps.
The sequencer paces subsequent checkpoints at the existing eight-second slots.
Passport freshness and recovery authorization checks are unchanged.

```sh
npm run localnet:drift
docker compose ps
docker compose logs -f bootstrap
```

An old latest block with a current pending timestamp means the automining
network is idle. A future pending timestamp is an actual clock problem. Use the
[Docker guide](docs/local-docker.md) for lifecycle and troubleshooting; the
unmanaged host `network:local` command does not install the Docker clock hooks.

## Application flow

1. Create or unlock a passkey wallet in management.
2. Issue Passport A2 using the official zkPassport mobile developer flow.
3. Issue Instagram V2 from a signed Instagram security email, proved locally.
4. Log in through the reference dApp. The SDK checks the request-bound
   authorization nullifier in the successful Aztec transaction.
5. Recover the passport into a new passkey using a fresh official mobile proof.
   Recovery consumes the old root lineage. Instagram uses the rootless issuance
   lane and must be issued again on the recovered wallet.

The dApp receives public request metadata and transaction hashes. Private notes,
credential witnesses, passkey secrets, and email/passport data stay in the wallet.

## SDK and validation

`@magna-protocol/client` re-exports `@magna-protocol/core` and includes the read-only Aztec primitives
needed to verify chain authorization. It does not ship the wallet engine or
contract bindings. See the [package README](packages/magna-client/README.md).

```sh
npm ci
npm run sdk:prepare
npm run test:sdk:consumer
```

These commands test and pack both SDK packages, audit their contents, install
those tarballs outside the workspace, and test/build the reference dApp using
that installation. No registry publication happens in these commands.

After building the Docker image, run the complete reviewer checks using the
[reviewer guide](docs/reviewer-guide.md). Keep live chain tests separate from
memory-intensive proof tests on an 8 GiB Docker VM.

## Repository layout

- `contracts/`: issuer, gateways, rights, metering, passkey account and recovery portal
- `l1-contracts/`: L1 rights-purchase portal
- `packages/magna-core`, `packages/magna-client`: public SDK packages
- `packages/magna-wallet`: wallet, proving and private-note operations
- `packages/magna-*-proof`, `packages/magna-recovery-v3`: proof adapters and recovery protocol
- `apps/`: management wallet, reference dApp and verification API
- `docs/`: current specifications, release instructions and dated acceptance evidence

M3 receipt events are explicitly descoped. Verification and metering remain
atomic; Login with Magna uses the passkey-authorized transaction effect rather
than a Magna-held application signing key.

## License

Apache-2.0. See [LICENSE](LICENSE). Real Instagram test emails are supplied privately
using the [fixture instructions](packages/magna-instagram-proof/fixtures/README.md);
they are not included in Git or Docker images.
