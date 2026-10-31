# Magna M1–M5 reviewer guide

Current target: Aztec 6.0.0 (2026-11-01). This is the canonical status and command index.
The milestone table below records historical V5 acceptance; those live runs do
not establish V6 deployment or mobile-proof acceptance. Fresh V6 local and
production proof gates must be recorded separately.
Dated evidence files record specific runs; older evidence is retained only when
it establishes a distinct protocol or adapter acceptance result.

| Milestone | Status | Evidence |
| --- | --- | --- |
| M1 | Complete | [Protocol](protocol-spec.md), [threat model](threat-model.md), [integration](integration-guide.md) |
| M2 | Complete | Issuer, credential and recovery contract tests |
| M3 | Complete; receipt events explicitly descoped | Atomic verification/metering and request-bound authorization tests |
| M4 | Complete for the agreed local developer scope | [Official mobile recovery](evidence/recovery-v3-mobile-2026-09-06.md), [clock](evidence/local-clock-docker-2026-09-06.md), [Instagram proof](evidence/instagram-proof-portability-2026-08-30.md) |
| M5 | Complete; SDK published and npm installation verified | [SDK validation](evidence/sdk-release-2026-09-07.md), [release procedure](sdk-release.md) |

## Original review findings

Passport A2 recursively verifies the pinned zkPassport proof and binds the claim
values to authenticated disclosure, age, Bind, FaceMatch and identifier fields.
The API verifies the resulting wrapper rather than accepting detached claims.

Recovery V3 requires both the Ghost-owned capability and a fresh proof-bound
destination authorization delivered through the canonical Inbox. Destination,
root, deployment, claims, expiry, nonce and message-secret hash are bound; both
the capability and authorization are consumed. The Magna API/orchestrator is
absent from this recovery authority path.

Rooted issuance also emits a nullifier that prevents a second initial lineage
for the same scoped zkPassport identity in the same issuer deployment. This is
not a claim of global biological-human uniqueness across replacement documents.

## Automated checks

Provide a private Instagram email using the [fixture instructions](../packages/magna-instagram-proof/fixtures/README.md).
The full suite fails with setup instructions when that file is missing; it does not skip proof checks.

After `npm run docker:local`, run the reviewer suite without a concurrent live
E2E/proving process. The bounded worker/heap configuration below passed historically on V5 on an
8 GiB Docker Desktop VM; rerun it against the new V6 image:

```sh
npm run test:reviewer:critical:docker
```

The suite covers clock diagnostics and pinned-runtime integration; issuer and
session authorization contracts; core vectors, wallet and client; Passport A2
and Recovery V3 wrappers; Recovery V3 protocol and EVM portal; API, management,
reference dApp; and real Instagram DKIM proof generation and verification.

Then run live issuance uniqueness and inspect the clock:

```sh
docker compose --project-name magna-local-v6 --file compose.yaml exec -T -e AZTEC_NODE_URL=http://aztec-localnet:8080 \
  -e ETHEREUM_HOSTS=http://anvil:8545 management \
  npm run -w @magna/e2e-tests test:issuance-uniqueness
npm run localnet:drift
npm run test:localnet:clock:docker
```

The clock integration test uses an isolated chain. It preserves the 3,600-second
gateway delay, rejects future warps, checks pending timestamps during recovery
synchronization, and measures two real funding cycles plus an Aztec transaction.
Do not run time-travel contract experiments against the active demo chain.

## Manual evidence boundary

The September 6 official mobile developer run passed on the managed-clock stack.
The [record](evidence/recovery-v3-mobile-2026-09-06.md) distinguishes user-supplied
private-note/UI observations from independently checked public chain receipts.
It includes private/public mutation rejection, replay rejection, canonical
Inbox ingestion, Ghost funding and successful recovery at L2 block 45.

Recovery rotates the rooted passport note set. Instagram V2 currently uses the
rootless lane and is issued again from a fresh signed email on the new wallet.

Production `SALTED=1`, production orchestrator custody/rotation, public-network
deployment, benchmarks and a demo video
remain separate from the local acceptance evidence. None is silently claimed complete by this local acceptance.

## V6 migration gates

Network packages use `@aztec-labs/*` 6.0.0 and Noir rc.3. The independent
Passport/recovery lane remains bb.js 5.0.0 / Noir beta.22; Instagram remains
bb.js 0.84.0 / Noir beta.5. `npm run check:proof-runtimes` and
`npm run test:compiler-isolation` verify the separation.

Operational regressions: `node --test scripts/v6-operations.spec.mjs scripts/inbox-message.spec.mjs`.
Fresh bootstrap instructions, preservation boundaries, digest and trace-capable
testnet RPC requirements are in [the Docker guide](local-docker.md).
A successful build or health check does not establish issuance/link/revoke,
sponsorship, rights bridging, or fresh official-mobile recovery on V6. Retain
those as explicit gates until measured on the fresh network. Historical V5
receipts remain historical evidence.
