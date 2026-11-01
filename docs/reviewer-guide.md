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

Recovery restores the Passport credential. Instagram V2 can be standalone or
attached to a Passport root; it must be issued again from a fresh signed email
on the recovered wallet.

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
sponsorship, rights bridging, or fresh official-mobile recovery on V6. The
[recorded V6 validation](local-docker.md#migration-validation-2026-11-01) now
includes managed clock, fresh sponsor bootstrap/Recovery initialization, rights
bridging and issuance uniqueness with the local simulated protocol prover.
The main lifecycle cases now have split V6 acceptance as recorded below; fresh
official-mobile recovery remains unverified. Historical V5 receipts remain
historical evidence.

## Upstream proof upgrade availability (2026-11-01)

`npm run readiness:zkpassport-v6` is a read-only public availability check for
zkPassport's candidate circuits 0.22.0 at commit
`b04153038a7ee9f80f4ae93fd1b9ea32eaf833e3` (Noir rc.3 / BB6). It checks the
official manifest/key artifact endpoints and the published RootRegistry at the
same observed block on Ethereum and Sepolia. Nonzero means no cutover. Passing
this check establishes availability only; official mobile proof, recursive
wrapper, EVM verifier and browser acceptance remain required.

The candidate manifests returned 404 and its root was invalid on both chains
during the 2026-11-01 investigation. The active beta.22/BB5 Passport and Recovery
tuple and beta.5/BB0.84 Instagram tuple therefore remain selected. The SDK's
published BB6 support alone is not evidence that issuance can use 0.22.0.
Run `npm run test:zkpassport-v6-readiness` for the availability gate regressions.


## Login preservation boundary (2026-11-01)

The user's migration constraint is to keep the existing login implementation.
The assistant's out-of-scope connector/popup edits and their new tests have
been removed; both connector files match pre-continuation commit `3eb3d32`.
Migration work must validate the current flow without redesigning its popup,
wallet selection, passkey handling or session broker.

The read-only upstream availability check above remains. The active proof
runtimes are unchanged, including Instagram's functional beta.5 / BB0.84 lane.
Exact stable Noir and the full BB6 Passport/Recovery cutover remain blocked on
official upstream availability and end-to-end proof validation. See the
[corrected scope record](local-docker.md#proof-stack-availability-and-login-preservation-2026-11-01).

Restoration checks: client18/18, management135/135 plus WASM routing, readiness13/13,
and the freshly rebuilt SDK's isolated consumer5/5 plus TypeScript/Vite passed.
Both connector source/test files match `3eb3d32` exactly.


## V6 acceptance continuation (2026-11-01)

The first full V6 critical run exposed resolver connection failures (42 issuer
tests passed, 72 failed). V6 defaults to a CPU-sized TXE worker pool; this host
selected ten workers despite serial Noir tests. The supported `TXE_WORKERS=1`
mode passed all 114 issuer tests and the full critical suite. The test tooling
now defaults to this mode and the Docker wrapper forwards it, while preserving
explicit caller overrides. `npm run test:compiler-isolation` includes the two
worker-budget regressions and passes 16 tests.

The full critical run passed existing contract, wallet/client, API/UI, recovery
wrapper/protocol/portal checks and real Instagram proof generation/verification.
This does not activate the unavailable BB6/stable tuple or establish fresh
hardware/mobile/public-proving acceptance. Login source/tests remain exactly
at `3eb3d32`.

A temporary exact-Noir-stable probe against PR170 also failed on four upstream
`SaltedValue.get_hash` type ambiguities at utils test lines 496/512/518/539.
See the [source-check scope](superpowers/specs/2026-11-01-proof-stack-login-design.md#exact-stable-compiler-probe).


### Live lifecycle acceptance

The existing 25-case main suite ran against a fresh disposable stock V6 network.
The full run passed 24 cases and exposed the final WebAuthn fixture's missing
V6 account metadata. After fixing that fixture, its targeted rerun passed
(1 passed, 24 filtered). This is split acceptance, not a single green 25-case
run. The final helper is used only by that last case.

Test-only compatibility fixes align the gateway delay with the existing
3,600-second contract policy, use V6's coordinated L1/L2 clock API, unwrap nested
simulation results, and fund the separate Instagram fixture owner through the
existing FeeJuice bridge/claim helpers. The WebAuthn fixture now stores metadata
**after** deployment and calls the application's existing signing-key note
discovery helper before authorization. The real custom account signs the
transaction; account validation was not replaced or bypassed.

Linked Instagram verification passed through Passport authority expiry and
renewal, along with consumer routing, sponsor isolation/limits and secp256r1
account authorization. These live cases use local simulated protocol proving
and administrative credential fixtures. Real Instagram proof verification is
covered separately by the critical suite. Hardware-passkey, official-mobile,
OPFS and public real-proving gates remain open.


The six remaining native contract projects also passed on V6: meter hook 7,
instant hook 5, rights registry 9, L2 purchase 12, WebAuthn 23 and WebAuthn account
4. With issuer 114 and sponsor 9 from the critical suite, all **183** network
contract tests now have fresh V6 results. Recovery protocol's 3 Noir cases and
portal's 10 Solidity cases passed separately in the critical suite.

A read-only code review found no actionable issue in the final test/infrastructure
changes. The existing Anvil/node IDs, start times and genesis were preserved;
API and both frontend endpoints returned HTTP200. No app image or running stack
was refreshed for this test-only continuation.
