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

Stop any host processes already using ports `8080`, `18545`, `4310`, `5174`, or `5175`, and make sure Docker Desktop is running. Then run:

```bash
npm run docker:local
```

This is intentionally a destructive reset of **only the `magna-local` Compose project**. Every invocation:

1. removes the previous Magna containers and the named volumes containing Anvil/Aztec state, the deployment manifest, generated runtime configuration, and frontend bundles;
2. removes the previously tagged `magna-local-app:aztec-5.1.0` image;
3. creates a dedicated empty `magna-local-clean-builder`, rebuilds with `--no-cache --load`, and then deletes that builder and all of its cache;
4. starts new L1/L2 processes and performs a completely new application and Recovery V3 deployment.

The command cannot and must not delete the user's OS/cloud passkey credentials. Each fresh bootstrap does, however, generate a new deployment-instance ID. On the next page load, the management and login apps detect that ID, clear the prior Aztec `pxe_data` and `wallet_data` SQLite-OPFS stores for this local network, and discard chain-specific credential metadata before allowing automatic wallet restoration. The underlying passkey remains available and can be used to deploy the same user-controlled address on the fresh chain, or the tester can create a new passkey.

The image build runs the repository build on Node 24 inside the official Aztec image. Because cached layers are deliberately ignored, the build and one-shot deployment can take several minutes. Follow deployment separately with:

```bash
docker compose logs -f bootstrap
```

The bootstrap writes the generated deployment addresses and browser-safe local URLs before it exits. The verification API starts only after bootstrap exits successfully. The frontend services start only after the API passes its health check; management and the reference dApp are then health-gated in that order. Each frontend copies its generated environment file and starts the same Vite development server used by the manual local workflow. This keeps Aztec's worker and WASM resolution on the already-tested development path instead of introducing a second static-bundle runtime solely for Docker.

The bootstrap still validates its inputs defensively, but `npm run docker:local` never reaches it with the previous run's volumes. Restarting an already-created stack is available through the explicitly named resume command:

```bash
npm run docker:local:resume
```

This command uses `docker compose start` on the existing long-running containers. It does not build an image, compile contracts, run the bootstrap service, recreate containers, or replace volumes. It returns after starting the containers, so use `docker compose logs -f` separately when live logs are needed. Use it only when the containers were previously created and you intentionally want to keep the current disposable chain, deployment, and generated runtime configuration.

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

To pause and resume the same disposable chain containers, use `docker compose stop` and `npm run docker:local:resume`. To remove the current project without immediately rebuilding it, use:

```bash
npm run docker:local:down
```

That command removes only this Compose project's containers and named volumes. It destroys the disposable local chain and deployment. Browser passkeys are not deleted, but credentials tied to the removed chain are no longer usable, so create new local wallets after the reset.

Docker build cache is different from Magna runtime state: it contains immutable intermediate image layers, not an Anvil database, Aztec state, a deployment manifest, or browser/PXE data. The clean command nevertheless isolates and deletes Magna's build cache on every run. It does not run a global `docker builder prune`; caches belonging to unrelated projects are untouched. After a successful build, Docker retains only the runnable Magna image rather than Magna's intermediate builder cache.

## Configuration boundary

- Aztec is pinned to `aztecprotocol/aztec:5.1.0` and immutable multi-architecture digest `sha256:dd26a01042caf0f34760c4221bd1c855862181842e0cbe3c8c6b4e3f6a5b4128`.
- Anvil is the Foundry binary bundled in that same immutable image. There is exactly one L1 process; the Aztec local-network service receives it through the documented `--l1-rpc-urls` option rather than silently starting another chain.
- The image installs the portal's exactly pinned Solidity `0.8.30` compiler during the build and immediately proves that the same portal compiles in Foundry offline mode. Runtime Recovery V3 bootstrap remains offline for compilation and cannot silently select another compiler.
- The Instagram/zkEmail circuit is an isolated `zkemail.nr v2.0.0` / Noir `1.0.0-beta.5` lane, matching upstream zkEmail CI. Its Noir.js runtime is also beta.5 and its `@aztec/bb.js` backend is `0.84.0`, matching Noir beta.5's own integration tests. The image downloads the official beta.5 Nargo archive for its target architecture, verifies the pinned SHA-256, checks the reported compiler version, and compiles the Instagram artifact from a clean dependency cache. It never uses the Aztec Nargo, a host-specific absolute path, or the host's Nargo dependency cache for that circuit. Real-DKIM input checks and full proof generation are the explicit `npm run test:instagram-proof` acceptance test because the full proof takes about 80 seconds and close to 1 GiB for the optimized circuit.
- The local timing profile is the validated 4-second Ethereum slot, 8-second Aztec slot, and 1-second block cadence.
- The disposable Anvil account-zero key is injected only into the Vite development bundle for portal relaying and the chain-`31337` Fee Juice faucet. It is not a production custody design.
- A fresh local P-256 session assertion keypair is generated per bootstrap. The private half goes only to the local wallet environment and the public JWK goes to the reference dApp.
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

## Remaining evidence gate

The Compose definition and static configuration are testable without a passport. Final Docker acceptance still requires a clean-volume, official-mobile proof run that repeats the positive recovery plus the mutation, replay, registry-revocation, and API-offline assertions from the Recovery V3 specification. A container build or health check alone cannot close that evidence gate.
