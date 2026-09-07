# Magna local Docker stack

This Compose profile packages the same local developer flow that passed the manual Recovery V3 Gate B-dev run. It does not replace the official zkPassport mobile scan and does not weaken any proof, mutation, replay, Inbox, Ghost, or issuer check.

## What starts

One command starts, in dependency order:

1. one Anvil process from the official digest-pinned Aztec `5.1.0` image;
2. the official Aztec `5.1.0` local-network process connected explicitly to that Anvil RPC;
3. a one-shot bootstrap that deploys the rights/application contracts and then Recovery V3;
4. the verification API;
5. the management wallet and reference dApp running through their Vite development servers with the generated deployment configuration.

The bootstrap uses Docker-internal URLs for deployment processes and writes separate `localhost` URLs for browser clients. It resolves and content-validates the zkPassport developer roots through the official Sepolia registry client. No proof fixture, mocked Inbox, injected tree witness, or generated mock proof is used.

## Clean start (the default)

Stop any host processes already using ports `8080`, `18545`, `4310`, `5174`, or `5175`, and make sure Docker Desktop is running. The clean builder checks for at least 12 GiB free inside Docker and 8 GiB on the host temporary filesystem before compilation. These are separate disks on Docker Desktop. Then run:

```bash
npm run docker:local
```

This is intentionally a destructive reset of **only the `magna-local` Compose project**. Every invocation:

1. removes unused prior Magna application-image generations, identified by Magna's image label, without globally pruning Docker;
2. creates a dedicated empty `magna-local-clean-builder`, rebuilds with `--no-cache`, exports the result to a temporary host file, loads it, and then deletes that builder and all of its cache;
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

The command cannot and must not delete the user's OS/cloud passkey credentials. Each fresh bootstrap does, however, generate a new deployment-instance ID. On the next page load, the management and login apps detect that ID, clear the prior Aztec `pxe_data` and `wallet_data` SQLite-OPFS stores for this local network, and discard chain-specific credential metadata before allowing automatic wallet restoration. The underlying passkey remains available and can be used to deploy the same user-controlled address on the fresh chain, or the tester can create a new passkey.

The image build runs the repository build on Node 24 inside the official Aztec image. Because cached layers are deliberately ignored, the build and one-shot deployment can take several minutes. Follow deployment separately with:

```bash
docker compose logs -f bootstrap
```

The bootstrap writes the generated deployment addresses and browser-safe local URLs before it exits. The verification API starts only after bootstrap exits successfully. The frontend services start only after the API passes its health check; management and the reference dApp are then health-gated in that order. Each frontend copies its generated environment file and starts the same Vite development server used by the manual local workflow. This keeps Aztec's worker and WASM resolution on the already-tested development path instead of introducing a second static-bundle runtime solely for Docker.

Changes to `MagnaCompanySponsor` require `npm run docker:local`, not a frontend refresh or container
resume: the new contract class and generated binding must be deployed together, and both frontends
must receive that deployment's gateway and active sponsor addresses.

The bootstrap still validates its inputs defensively, but `npm run docker:local` never reaches it with the previous run's volumes. Restarting an already-created stack is available through the explicitly named resume command:

```bash
npm run docker:local:resume
```

This command uses `docker compose start` on existing containers without building
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

The reference dApp installs the published `@magna-protocol/client@0.2.0` and
`@magna-protocol/core@0.1.0` registry tarballs. Startup checks reject SDK workspace
resolution. After changing its pinned SDK versions, rebuild the application
image before recreating the reference frontend.
- Verification API health: <http://localhost:4310/health>

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
docker compose ps
docker compose logs -f anvil aztec-localnet verification-api management
docker compose down
```

To remove the current project without immediately rebuilding it, use:

```bash
npm run docker:local:down
```

That command removes only this Compose project's containers and named volumes. It destroys the disposable local chain and deployment. Browser passkeys are not deleted, but credentials tied to the removed chain are no longer usable, so create new local wallets after the reset.

Docker build cache is different from Magna runtime state: it contains immutable intermediate image layers, not an Anvil database, Aztec state, a deployment manifest, or browser/PXE data. The clean command nevertheless isolates and deletes Magna's build cache on every run. It does not run a global `docker builder prune`; caches belonging to unrelated projects are untouched. Runnable Magna images carry `io.magna.local-app=true`, and the clean command removes unused older generations with that label. A narrowly matched legacy signature cleans images built before the label existed. After a successful build, Docker retains only the current runnable Magna image rather than Magna's intermediate builder cache.

## Configuration boundary

- Aztec is pinned to `aztecprotocol/aztec:5.1.0` and immutable multi-architecture digest `sha256:dd26a01042caf0f34760c4221bd1c855862181842e0cbe3c8c6b4e3f6a5b4128`.
- Anvil is the Foundry binary bundled in that same immutable image. There is exactly one L1 process; the Aztec local-network service receives it through the documented `--l1-rpc-urls` option rather than silently starting another chain.
- The image installs the portal's exactly pinned Solidity `0.8.30` compiler during the build and immediately proves that the same portal compiles in Foundry offline mode. Runtime Recovery V3 bootstrap remains offline for compilation and cannot silently select another compiler.
- The Instagram/zkEmail circuit is an isolated `zkemail.nr v2.0.0` / Noir `1.0.0-beta.5` lane, matching upstream zkEmail CI. Its Noir.js runtime is also beta.5 and its `@aztec/bb.js` backend is `0.84.0`, matching Noir beta.5's own integration tests. The image downloads the official beta.5 Nargo archive for its target architecture, verifies the pinned SHA-256, checks the reported compiler version, and compiles the Instagram artifact from a clean dependency cache. It never uses the Aztec Nargo, a host-specific absolute path, or the host's Nargo dependency cache for that circuit. Real-DKIM input checks and full proof generation are the explicit `npm run test:instagram-proof` acceptance test because the full proof takes about 80 seconds and close to 1 GiB for the optimized circuit.
- The local timing profile is the validated 4-second Ethereum slot, 8-second Aztec slot, and 1-second block cadence.
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

The September 6 managed-clock deployment passed an official mobile developer
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
the digest-pinned Aztec 5.1.0 runtime and refuses an unsupported runtime. It paces
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
