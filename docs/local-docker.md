# Magna local Docker stack

This Aztec 6.0.0 Compose profile implements the existing local developer flow. The dated Recovery V3 Gate B-dev evidence was produced on V5 and must be repeated on a fresh V6 deployment. It does not replace the official zkPassport mobile scan and does not weaken any proof, mutation, replay, Inbox, Ghost, or issuer check.

## What starts

One command starts, in dependency order:

1. one Anvil process from the official digest-pinned Aztec `6.0.0` image;
2. the official Aztec `6.0.0` local-network process connected explicitly to that Anvil RPC;
3. a one-shot bootstrap that deploys the rights/application contracts and then Recovery V3;
4. the verification API;
5. the management wallet and reference dApp running through their Vite development servers with the generated deployment configuration.

The bootstrap uses Docker-internal URLs for deployment processes and writes separate `localhost` URLs for browser clients. It resolves and content-validates the zkPassport developer roots through the official Sepolia registry client. No proof fixture, mocked Inbox, injected tree witness, or generated mock proof is used.

## Clean start (the default)

Stop any host processes already using ports `8080`, `18545`, `4310`, `5174`, or `5175`, and make sure Docker Desktop is running. The clean builder checks for at least 12 GiB free inside Docker and 8 GiB on the host temporary filesystem before compilation. These are separate disks on Docker Desktop. Then run:

```bash
npm run docker:local
```

This is intentionally a destructive reset of **only the `magna-local-v6` Compose project**. Every invocation:

1. removes unused prior Magna application-image generations, identified by both `io.magna.local-app=true` and `io.magna.aztec-version=6.0.0`, without globally pruning Docker;
2. creates a dedicated empty `magna-local-v6-clean-builder`, rebuilds with `--no-cache`, exports the result to a temporary host file, loads it, and then deletes that builder and all of its cache;
3. only after that replacement image is safely loaded, removes the previous Magna containers and named volumes containing Anvil/Aztec state, the deployment manifest, generated runtime configuration, and frontend bundles;
4. removes the now-unused previous Magna image and starts new L1/L2 processes for a completely new application and Recovery V3 deployment.

If image construction fails, the command removes its temporary builder and export file but leaves an already-running Magna stack and its chain volumes untouched. This prevents a compiler, network, or storage failure from destroying the last usable local environment.

To verify a fresh image without resetting or starting the stack, use
`npm run docker:local -- --build-only`. This uses the same isolated builder,
space checks, export and cleanup path, then stops after loading the image.
Avoid ad hoc builds on Docker's shared builder: their retained intermediate
cache can consume the space required by the next clean build. The preflight
does not globally prune caches, containers or volumes; if it reports low space,
inspect `docker system df` and remove only cache you can identify or increase
Docker Desktop's disk allocation. Its 12 GiB reserve is an early guard, not a
guarantee against concurrent disk use by other projects.

V5 images, Compose volumes and stopped resources are preserved. The V6 project uses
`deployments/local-v6.json`, separate named volumes and generated runtime files.
Old or unversioned manifests are rejected before reuse or writes. The browser uses
new V6 PXE and wallet store names, preserving V5 stores. Passkeys remain available,
but V6 requires fresh contract deployments, accounts and credential issuance.
Recovery V3 transfers a root lineage within its deployed network; it does not
export/import credentials across the V5/V6 network boundary.

The image build runs the repository build on Node 24 inside the official Aztec image. Because cached layers are deliberately ignored, the build and one-shot deployment can take several minutes. Follow deployment separately with:

```bash
docker compose --project-name magna-local-v6 --file compose.yaml logs -f bootstrap
```

The bootstrap writes the generated deployment addresses and browser-safe local URLs before it exits. The verification API starts only after bootstrap exits successfully. The frontend services start only after the API passes its health check; management and the reference dApp are then health-gated in that order. Each frontend copies its generated environment file and starts the same Vite development server used by the manual local workflow. This keeps Aztec's worker and WASM resolution on the already-tested development path instead of introducing a second static-bundle runtime solely for Docker.

Changes to `MagnaCompanySponsor` require `npm run docker:local`, not a frontend refresh or container
resume: the new contract class and generated binding must be deployed together, and both frontends
must receive that deployment's gateway and active sponsor addresses.

The bootstrap still validates its inputs defensively, but `npm run docker:local` never reaches it with the previous run's volumes. Restarting an already-created stack is available through the explicitly named resume command:

```bash
npm run docker:local:resume
```

This command starts existing containers in the explicitly pinned V6 project without building
or bootstrapping. It is not a chain-persistence guarantee: this local profile's
Anvil and Aztec processes keep chain state in memory. If those processes exited,
retained application configuration does not restore their chain. Use a fresh
`npm run docker:local` deployment after such a restart. To refresh an app while
keeping the running chain, use the frontend-only command below.

The two Vite frontends mount their `src`, `index.html`, and Vite configuration from the current checkout. This is intentionally limited to the development Compose profile: dependency installation, generated contract bindings, and backend/package builds remain pinned inside the image. After changing frontend source, refresh only those containers without compiling contracts or touching the chain:

```bash
npm run docker:local:refresh-frontends
```

The command requires an already-bootstrapped stack with a healthy verification API. It uses the existing image and recreates only `management` and `reference-dapp`; it does not start the bootstrap service.

Changes outside those mounted frontend paths—such as dependencies, shared packages, generated bindings, contracts, scripts, or the verification API—still require rebuilding the application image. To rebuild it while retaining the existing Compose volumes and local chain, use the separately named command:

```bash
npm run docker:local:rebuild
```

That command intentionally runs the Dockerfile build, including dependency installation and contract compilation. It may recreate application containers, and the bootstrap service will validate the retained completion marker, but it does not begin with the destructive volume reset performed by `npm run docker:local`.

Open:

- Management: <http://localhost:5174>
- Reference dApp: <http://localhost:5175>
- Verification API health: <http://localhost:4310/health>

The repository and Docker reference dApp use the workspace V6 SDK: `@magna-protocol/client@0.3.0` and `@magna-protocol/core@0.1.1`. Its startup/build checks explicitly enable workspace mode. Separately, `npm run sdk:prepare` and `npm run test:sdk:consumer` pack and install the SDK tarballs outside the workspace; that strict consumer harness rejects workspace resolution. Those commands do not publish a registry release. Rebuild the image after changing SDK code or versions.

When the reference dApp opens `http://localhost:5174/authorize`, the authorization popup first
discovers an already-open management wallet through a same-origin `BroadcastChannel`. The tab that
already owns the persistent PXE executes the private verification and returns only the login outcome;
the popup does not open a second SQLite-OPFS instance. If no open passkey session answers, the popup
opens the selected stored wallet itself and owns that session only for the authorization request.

Docker publishes its Anvil RPC only at <http://127.0.0.1:18545>. The internal Aztec node still connects to `http://anvil:8545`. The dedicated host port prevents a separately running manual Anvil on `127.0.0.1:8545` from silently receiving browser-side Docker transactions.

The management flow remains `devMode=true`: scan the official zkPassport developer QR with the official mobile app and selected mock passport. The browser still generates and verifies the real recursive proof locally. Docker never fabricates that user interaction.

Docker uses `VITE_MAGNA_DEPLOYMENT_PROFILE=development`. Only an explicit `VITE_MAGNA_DEPLOYMENT_PROFILE=production` selects mainnet-safe frontend restrictions such as rejecting the local faucet, local test accounts, zkPassport developer mode, and developer orchestrator.

## Inspecting and stopping

```bash
docker compose --project-name magna-local-v6 --file compose.yaml ps
docker compose --project-name magna-local-v6 --file compose.yaml logs -f anvil aztec-localnet verification-api management
docker compose --project-name magna-local-v6 --file compose.yaml down
```

To remove the current project without immediately rebuilding it, use:

```bash
npm run docker:local:down
```

That command removes only this Compose project's containers and named volumes. It destroys the disposable local chain and deployment. Browser passkeys are not deleted, but credentials tied to the removed chain are no longer usable, so create new local wallets after the reset.

Docker build cache is different from Magna runtime state: it contains immutable intermediate image layers, not an Anvil database, Aztec state, a deployment manifest, or browser/PXE data. The clean command nevertheless isolates and deletes Magna's build cache on every run. It does not run a global `docker builder prune`; caches belonging to unrelated projects are untouched. Only V6 application images carrying both version and application labels are eligible for cleanup. Unlabelled legacy images and labelled V5 images remain untouched.

## Configuration boundary

- Aztec is pinned to `azteclabs/aztec:6.0.0` and immutable multi-architecture digest `sha256:59b10cc8e89bb9226db1f771a5abbe5d5f8d71483c00c7472187e6ddc7adab8d`.
- Anvil is the Foundry binary bundled in that same immutable image. There is exactly one L1 process; the Aztec local-network service receives it through the documented `--l1-rpc-urls` option rather than silently starting another chain.
- The image installs the portal's exactly pinned Solidity `0.8.30` compiler during the build and immediately proves that the same portal compiles in Foundry offline mode. Runtime Recovery V3 bootstrap remains offline for compilation and cannot silently select another compiler.
- The Instagram/zkEmail circuit is an isolated `zkemail.nr v2.0.0` / Noir `1.0.0-beta.5` lane, matching upstream zkEmail CI. Its Noir.js runtime is also beta.5 and its `@aztec/bb.js` backend is `0.84.0`, matching Noir beta.5's own integration tests. The image downloads the official beta.5 Nargo archive for its target architecture, verifies the pinned SHA-256, checks the reported compiler version, and compiles the Instagram artifact from a clean dependency cache. It never uses the Aztec Nargo, a host-specific absolute path, or the host's Nargo dependency cache for that circuit. Real-DKIM input checks and full proof generation are the explicit `npm run test:instagram-proof` acceptance test because the full proof takes about 80 seconds and close to 1 GiB for the optimized circuit.
- Network Nargo is `1.0.0-rc.3` at `/root/.aztec/versions/6.0.0/bin/aztec-nargo`, alongside the exact V6 CLI shim. Passport/recovery standalone compilation explicitly selects checksum-pinned `1.0.0-beta.22` via `AZTEC_NARGO_BIN`; Instagram explicitly selects beta.5 via `NARGO_BIN`. The frozen recovery bundle and verification key remain unchanged.
- The local timing profile uses the source-checked 4-second Ethereum slot, 8-second Aztec slot, and 1-second block cadence.
- The disposable Anvil account-zero key is injected only into the Vite development bundle for portal relaying and the chain-`31337` Fee Juice faucet. It is not a production custody design.
- Login with Magna uses no shared frontend signing key. Bootstrap writes the public Aztec node,
  consumer-gateway, and active sponsor addresses to the two app environments. The relying party
  accepts a result only when the passkey-authenticated verification transaction contains the exact
  request- and policy-bound authorization nullifier emitted by that sponsor.
- `MAGNA_ZKPASSPORT_EVM_RPC_URL` may override the default public Sepolia RPC used to resolve developer registry roots:

```bash
MAGNA_ZKPASSPORT_EVM_RPC_URL=https://your-sepolia-rpc.example npm run docker:local
```

The developer Instagram key is pinned by default. To add a newly governed
current/historical key list without redeploying the chain, provide the complete
comma-separated list on the next Compose run and restart the verification API:

```bash
MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES=0xkey1,0xkey2 npm run docker:local
```

Instagram V2 proving runs in the management browser. Selecting a signed `.eml` does not upload the
file or handle to the verification API; only the serialized proof, its seven public inputs, and the
destination owner are posted. The handle hash and random blind stay in the wallet-origin local
credential reference and are required later for private Aztec login.

The image also carries the isolated Instagram compiler and proof stack. Run its
explicit real-email proof acceptance test without relying on any host Nargo:

```bash
npm run test:instagram-proof:docker
```

This test verifies the committed email's real DKIM signature, builds the circuit
witness, generates an UltraHonk proof, and verifies that proof. It does not mock
the email, witness, prover, or verifier.

## Official mobile developer evidence

The historical V5 September 6 managed-clock deployment passed an official mobile developer
recovery with mutation/replay rejection, canonical Inbox ingestion and successful
Aztec execution at block 45. See the [public receipt and browser evidence](evidence/recovery-v3-mobile-2026-09-06.md).
Future acceptance runs still require a fresh official mobile proof; a container
build or health check is not a substitute. Independent-root and registry-negative
checks remain part of Recovery V3 bootstrap and its protocol evidence.

zkPassport confirmed on 2026-08-25 that OPRF does not currently work with dev mode and provided no
ETA. Consequently, Docker deliberately requests `NON_SALTED_MOCK = 2` and does not attempt
`SALTED = 1`. The real supported-document, production-registry, strict-FaceMatch, `SALTED = 1` run
is a separate testnet-deployment gate before release, not a local Docker or M1-M5 acceptance step.


### Managed local clock

Docker starts the fresh Anvil genesis two hours in the past and injects the same
clock into Aztec. The existing 3,600-second consumer-gateway delay elapses during
bootstrap without putting the chain ahead of real time. Bootstrap then advances
L1/L2 forward to the host clock, removes Anvil's synthetic per-block timestamp
increment, resets the injected clock, and verifies readiness before the API and
apps start. Authenticated passport dates and contract freshness rules are unchanged.

The local-only loader in `docker/local-clock` checks exact integration points in
the digest-pinned Aztec 6.0.0 runtime and refuses an unsupported runtime. It paces
both ordinary and explicit checkpoints at the sequencer: a future slot waits for
wall time instead of making L1 advance ahead of it. The 8s Aztec / 4s Ethereum
protocol slot configuration is preserved. The internal clock control endpoint
on port 8090 is not published to the host. Its readiness marker is bound to the
Anvil genesis hash; a fresh chain cannot reuse an old marker.

Run `npm run localnet:drift` on the host. It reads the running management
container's public RPC configuration, so Docker recovery and the diagnostic
both inspect Anvil on `127.0.0.1:18545`. To select another network, provide both
`L1_RPC_URL` and `AZTEC_NODE_URL`, or `MAGNA_DEPLOYMENT_MANIFEST` for a host deployment.
Inaccessible Docker configuration fails closed instead of reporting another chain.

The output shows latest and pending L1 timestamps and signed drift (`L1 minus
host`). Both differences are checked by magnitude. A stale latest block with a
current pending timestamp is explicitly classified as idle, rather than future
drift; recovery already synchronizes an idle chain forward before submission.
The diagnostic never mines or changes time. Recovery logs its sampled block,
endpoint, host time and drift under `[recovery-v3:local-clock]` in the console.

`npm run test:localnet:clock:docker` runs an isolated Anvil/Aztec integration test
using the actual loader and compiled Magna gateway contracts. It verifies the
gateway delay, rejects future debug warps, runs two real Fee Juice bridge/claim
cycles and an additional Aztec transaction within 180 seconds, and checks clock
drift and idle pending time. It uses the standard local bootstrap proving mode;
it does not substitute for official zkPassport mobile recovery evidence.

The local recovery Inbox loop stops retrying after a three-minute budget instead
of entering an additional six-minute polling wait. RPC/proof processing has its
own latency; this is not a three-minute guarantee for mobile scanning and the
complete browser proof/recovery flow. A wait timeout does not cancel a submitted
portal transaction.

## Host configuration and V6 acceptance

Host bootstraps default to `deployments/local-v6.json` and generate
`.runtime/aztec6/management/.env` and `.runtime/aztec6/reference-dapp/.env`.
They refuse existing output files at the start of a fresh bootstrap; preserve
those files and choose new output paths when creating another deployment.
The existing apps' `.env` files are not overwritten. The complete supported fresh
local bootstrap uses `npm run docker:local` and its managed historical clock.
The plain-host `network:local` / `bootstrap:local` sequence is not a validated
complete bootstrap: the V6 CLI requires an external L1 RPC and does not start
Anvil, and the activation warp on an unmanaged wall-time chain conflicts with
the local drift guard. Do not weaken the guard to run that sequence.

For an operator-configured compatible node and generated deployment environment,
host frontend selection remains explicit:

```sh
MAGNA_ENV_DIR="$PWD/.runtime/aztec6/management" npm run -w @magna/management dev
MAGNA_ENV_DIR="$PWD/.runtime/aztec6/reference-dapp" npm run -w @magna/reference-dapp dev
```

Set `MAGNA_ENV_DIR` to an absolute generated directory for each host frontend;
Vite then loads that directory's environment instead of the old app `.env`.
Host mode does not install the Docker clock hooks. Its operator must supply the
L1/node/clock prerequisites and the verification API's explicit deployment
configuration; the frontend commands alone do not establish those prerequisites.

V6 Fast Inbox has no `LAG()` contract method. Funding/recovery/rights waits
observe committed inclusion, then require the exact message leaf and global
index; Fee Juice and rights consumption retain the nullifier/replay checks.
Local debug advancement remains restricted to chain 31337, paced by wall time,
and bounded by a three-minute deadline. No fixed two-checkpoint delay remains.

The Passport issuance freshness bound is **300 seconds**. Recovery V3 retains
its existing **3600-second** proof freshness bound; the consumer-gateway and
sponsorship-policy activation delay is separately **3600 seconds**. Historical
bootstrap time may satisfy activation delays; it cannot make a stale live proof
fresh. A new official mobile developer proof and a supported-document production
`SALTED=1` proof are separate acceptance gates.

For public testnet, supply a trace-capable L1 RPC with `debug_traceTransaction`
support, matching V6 node/RPC endpoints, and fresh V6 manifests/accounts. Read-only
Sepolia registry access is a separate dependency. No remote deployment is
performed by this migration's verification.

## Migration validation (2026-11-01)

Runtime fixes are committed as `229ee14`. The successful clean arm64 base from
`cf8c18f` is
`sha256:8cd42486087a496995fa50d40ba69a053dacce9f6d86ce429e96c914b3b96b03`.
It compiled all eight V6 network contracts/VKs, both isolated circuit lanes,
generated bindings, and built all packages/apps/E2E TypeScript. The tracked
[validation overlay](../docker/Dockerfile.v6-validation) installs the corrected
root lockfile with `npm ci`, rebuilds all workspaces, then adds the narrowly
tested waiter/monitor corrections. It retains those clean compiled artifacts;
it is not a second clean full-source build. `Dockerfile.local` remains the
clean-build recipe. Final image:
`sha256:4c64445e3bae5fb331bb57a4dcbfe0fc5286590ed3c47427b3bef8cafb4f67cf`.
All 46 captured source hashes and the frozen Recovery bundle match. Root,
E2E and wallet actually resolve upstream `viem@2.57.1`; all independent proof
runtime checks pass.

After the dependency fix, serial host verification passed all 381 workspace
tests and all workspace builds. Final-image operational tests pass **35/35**,
with no skips, including actual V6 compiled clock hooks. Earlier unchanged
evidence includes 183 Noir tests, 14 compiler-isolation tests and the
Recovery/rights Solidity suites. The clean-image Instagram gate passed 7 unit
tests and 1 real private-email proof/verification test; its fixture stayed private.

Actual managed-clock integration passed the full activation delay, future-warp
refusal, two Fee Juice bridge/inclusion/claim cycles and a subsequent Aztec
transaction (40.28s combined). The first fresh bootstrap exposed a clock bug:
the idle Inbox waiter jumped historical L1 to wall time before Recovery setup,
so final activation refused future mined time. A regression reproduced it;
requesting only `latest L1 + 1` preserves historical headroom while V6 rounds
to a new checkpoint. The second genuinely fresh bootstrap passed sponsor
funding/claim, both generated-env refreshes, Recovery portal/verifier and issuer
initialization, and real-time activation with zero pending drift. API and both
frontend endpoints returned HTTP200. The rights suite passed all 3 cases
(initialization, exact Inbox credit/replay, sponsor isolation); the separate
issuance-uniqueness case passed. No unrelated L2 producer supplied Inbox progress.

The clock test used the initial dependency-corrected overlay; bootstrap/rights/
issuance used its waiter-corrected image `72e9119079d1`. The final image adds only
the read-only monitor pin. API/frontends were refreshed to it without resetting
the chain, and their health checks passed again. All local protocol execution
used actual V6 contracts with `realProofs=false`. Issuance uniqueness uses
administrative synthetic credential inputs. The default host command skipped
29 live cases; 4 were later executed as above. The other 25 main cases, fresh
official human Passport/recovery, production `SALTED=1`, actual browser passkey/
OPFS and public real proving remain unverified. No remote deployment occurred.

Old V5 resources were preserved. The temporary clean builder/export were removed;
remaining overlay cache shares the retained images, and older unrelated cache
was left alone. Final Docker free space was about **8.33 GiB**, below the existing
**12 GiB** clean-build guard. Additional free space is required before another
clean rebuild; the guard was not lowered and no global prune or resize was used.


## Final-source clean build after cleanup (2026-11-01)

After user-authorized removal of obsolete builds/cache, the runtime source at
`16d5683` passed `npm run docker:local -- --build-only` through
`Dockerfile.local`, with no cached build layers or validation overlay. Image:
`sha256:53787516abcf2fe2b4e810cc1e7886790e825d67d4342c92452d8e982a1238fe`.
All eight network contracts/VKs, isolated Instagram and Recovery circuits,
generated bindings, packages/apps and E2E TypeScript built successfully.

Inside that clean image, all six runtime-resolution lanes and **35/35**
operational tests passed with no skips. All **134** changed source files copied
into the image matched the committed source, the frozen Recovery bundle was
unchanged, and all eight contract class IDs matched the previous deployed V6
image. This closes the earlier clean-final-source build limitation.

Only the API and frontend containers were refreshed. Their endpoints returned
HTTP200; Anvil/node container IDs, chain genesis, deployment-manifest hash and
all three shared runtime-configuration hashes stayed unchanged. No contracts
were redeployed and no chain or data volume was reset.

Superseded validation images/cache and the completed old bootstrap job container
were removed; named volumes and unrelated projects were retained. Docker then
had **17.93 GiB free**, and the existing 12 GiB rebuild-space check passed.
The earlier overlay recipe and image IDs above are historical validation evidence.
No runtime source or product feature was added in this continuation; this is a
documentation-only follow-up. Manual/browser/public-proof acceptance gates above
remain open.
