# Magna — Private Credential Layer (Aztec)

Magna turns a real-world proof (e.g. a zkPassport scan) into a **reusable, recoverable, revocable** private credential on [Aztec](https://aztec.network). This monorepo contains the Noir/Aztec protocol contracts, the TypeScript SDK, the off-chain verification API, and the front-end apps.

This README is a **from-scratch setup guide**: clone → install toolchains → compile contracts → build packages → run the **Management dApp** and the **Reference dApp** locally.

---

## 1. Prerequisites

Install these before anything else:

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | `>= 24.12.0` | Enforced by `engines` in `package.json`. Use `nvm`/`fnm` to manage it. |
| **npm** | bundled with Node | The repo uses **npm workspaces** (no pnpm/yarn). |
| **Aztec toolchain** | `5.1.0` | Provides `aztec` and `aztec-nargo`. Pinned in `.aztecrc`. |
| **Docker** | latest | Required by the Aztec local network / sandbox. |
| **Foundry** (`forge`) | latest | *Optional* — only needed to build the L1 Solidity contracts (`l1-contracts/`). Not required to run the two apps. |

Install the Aztec toolchain and pin the version this repo expects:

```bash
# Install the Aztec installer (provides `aztec`, `aztec-nargo`, `aztec-up`)
bash -i <(curl -s https://install.aztec.network)

# Pin to the version used by this repo
aztec-up 5.1.0

# Verify (this script forces the pinned version)
npm run aztec:version    # expects 5.1.0
```

> If `aztec` is not on your PATH after install, follow the path hint printed by the installer, then re-open your shell.

---

## 2. Quick start (TL;DR)

### Dockerized local stack

After the manual Recovery V3 flow has been validated, the same pinned stack can be started from a clean clone with Docker Desktop and one command:

```bash
npm run docker:local
```

This builds against the immutable official Aztec `5.1.0` image, starts its single local network/Anvil, deploys the ordinary application stack followed by Recovery V3, and starts the API plus both frontends. Open **http://localhost:5174** for management. The official zkPassport mobile scan is still a real manual step; Compose does not substitute a fixture or synthetic proof. See [the local Docker guide](docs/local-docker.md) for lifecycle, reset, ports, and evidence requirements.

### Host toolchain

Five terminals. Run from the repo root unless noted.

```bash
# ── one-time setup ──────────────────────────────────────────────
git clone <repo-url> magna_monorepo && cd magna_monorepo
nvm use 24.12.0 || true                 # ensure Node >= 24.12.0
npm install                             # install all workspaces
npm run compile:contracts               # compile Noir/Aztec contracts
npm run codegen:contracts               # generate TS bindings → packages/contracts-bindings/src
npm run build                           # build all TS packages + apps

# ── env files ───────────────────────────────────────────────────
cp apps/magna-management/.env.example      apps/magna-management/.env
cp apps/reference-dapp/.env.example        apps/reference-dapp/.env
cp apps/magna-verification-api/.env.example apps/magna-verification-api/.env

# ── run (each line = its own terminal) ──────────────────────────
# T1: local Aztec network (PXE + sequencer + anvil L1) on :8080
npm run network:local

# T2: deploy contracts + populate addresses into the .env files
npm run bootstrap:local

# T3: off-chain verification API on :4310
npm run verification-api:dev

# T4: Management dApp on :5174
npm run -w @magna/management dev

# T5: Reference dApp on :5175
npm run -w @magna/reference-dapp dev
```

Then open **http://localhost:5174** (Management) and **http://localhost:5175** (Reference dApp).

Two small **manual env values** are still required after bootstrap — see [§5](#5-environment-configuration). Read the detailed steps below the first time through.

---

## 3. What the steps do

### 3.1 Install
```bash
npm install
```
Installs every workspace under `packages/*` and `apps/*` in one pass (npm workspaces, hoisted).

### 3.2 Compile contracts
```bash
npm run compile:contracts
```
Compiles all Noir/Aztec contract crates in `contracts/` (issuer, company-sponsor, company-rights-registry, verify-meter-hook[-instant], consumer, rights-purchase-l2, webauthn-account) via `scripts/aztec-tooling.mjs`, which pins the toolchain to `5.1.0`.

### 3.3 Generate TypeScript bindings
```bash
npm run codegen:contracts
```
Generates typed contract bindings into `packages/contracts-bindings/src`. **This must run before building the packages**, because `@magna/wallet` (and therefore the apps) import these bindings.

### 3.4 Build packages and apps
```bash
npm run build      # = npm run -ws build, in dependency order
```
Build order is handled by npm workspaces:

```
contracts/ ──compile──▶ codegen ──▶ packages/contracts-bindings/
@magna/core ─────────────────────────────┐
@magna/contracts-bindings ────────────────┼─▶ @magna/wallet ─┐
@magna/passport-wrapper-proof ────────────┘                  ├─▶ @magna/management
@magna/client (← @magna/core) ───────────────────────────────┼─▶ @magna/verification-api
                                                              └─▶ @magna/reference-dapp (← @magna/client)
```

> `npm run build` does **not** compile contracts or run codegen — those are explicit steps (3.2 + 3.3) and only need to be re-run when a contract changes.

### 3.5 Start the local Aztec network
```bash
npm run network:local      # wraps `aztec start --local-network`, listens on :8080
```
Leave this running in its own terminal. It spins up the PXE, sequencer, and an anvil L1 fork.

> ⚠️ **Clock profile:** always start the network through `npm run network:local`. Magna pins the empirically validated Aztec 5.1 local profile (4s Ethereum slots, 8s Aztec slots, 1s block cadence) because the default 72s Automine slots accumulate future L1 time during rapid testing. Recovery and Fee Juice helpers also pace each forced Inbox checkpoint against wall time. `npm run localnet:drift` verifies both the on-chain slot duration and current drift. A network created with the former 72s profile is monotonic and must be restarted once, followed by both local bootstraps.

### 3.6 Deploy + bootstrap local env
```bash
npm run bootstrap:local
```
With the local network running, this deploys the contracts and writes deployment addresses into:

- `apps/magna-management/.env`
- `apps/reference-dapp/.env`
- a deployment manifest under `deployments/*.json`

Re-run it any time you restart the local network.

### 3.6.1 Deploy the isolated Recovery V3 Gate B-dev stack

After the ordinary bootstrap, and before starting the management app:

```bash
npm run recovery-v3:bootstrap:local
```

This command reads and content-validates the current certificate and circuit
roots independently through zkPassport's official Sepolia registry client,
deploys the hash-pinned generated EVM verifier and the unmodified official
registry contracts to the shared Anvil instance, proves that unseeded and
temporarily revoked roots are rejected, deploys the portal against Aztec's
canonical Inbox, and writes the resulting addresses and evidence hash to
`deployments/local.json`. It never learns roots from the proof under test.

Set the local Anvil relayer key in `apps/magna-management/.env` (development
only; account zero is the default bootstrap deployer):

```dotenv
VITE_MAGNA_L1_RPC_URL=http://127.0.0.1:8545
VITE_MAGNA_LOCAL_FAUCET_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
VITE_MAGNA_RECOVERY_V3_RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

The faucet key is accepted only by the local development build, and the
funding implementation independently rejects any L1/Aztec network other than
chain `31337`. It is never a production user-funding mechanism.

Restart the management app after every bootstrap. The live recovery action
then requests a fresh proof through the unmodified zkPassport app, generates
the dedicated wrapper locally, runs private-witness and EVM mutations, sends
the authorization through the real portal and canonical Inbox, and verifies
replay rejection. On chain `31337` only, it reads the canonical Inbox's actual
`LAG()` and uses Aztec's official debug API to build a bounded number of empty
checkpoints; polling alone cannot ingest an L1 message on the transaction-driven
local network. It then requires actual leaf/index membership, reconstructs the
authenticated Ghost locally, calls private `recover_root_v3(...)`, and checks
that the destination received the complete rooted passport note set. The clean
Gate B-dev run passed on 2026-08-28; its redacted proof, transaction, Inbox,
mutation, issuer-execution, and chain-state evidence is retained in
`docs/evidence/recovery-v3-gate-b-dev-2026-08-28.md`. A Docker run must reproduce
this sequence and cannot replace its live official-mobile-proof requirement.

### 3.7 Run the services
```bash
npm run verification-api:dev          # @magna/verification-api → http://localhost:4310
npm run -w @magna/management dev      # Management dApp        → http://localhost:5174
npm run -w @magna/reference-dapp dev  # Reference dApp         → http://localhost:5175
```

---

## 4. Apps & ports

| App | Workspace | Dev command | Dev URL |
| --- | --- | --- | --- |
| **Management dApp** | `@magna/management` | `npm run -w @magna/management dev` | http://localhost:5174 |
| **Reference dApp** | `@magna/reference-dapp` | `npm run -w @magna/reference-dapp dev` | http://localhost:5175 |
| **Verification API** | `@magna/verification-api` | `npm run verification-api:dev` | http://localhost:4310 |
| Aztec local network | — | `npm run network:local` | http://localhost:8080 |
---

## 5. Environment configuration

`npm run bootstrap:local` fills in all **contract addresses** and Login with Magna chain-authorization
configuration automatically.

### 5.1 Login with Magna authorization (Management ↔ Reference dApp)

No shared application signing key is used. Each login requirement is authorized inside the same
passkey-authenticated Aztec transaction that verifies the credential and consumes the sponsor right.
The sponsor emits a request-, challenge-, expiry-, requirement-index-, policy-, and gateway-bound
nullifier. `@magna/client` recomputes that nullifier and requires it in the successful transaction
effect from the configured Aztec node.

The generated public configuration is:

```dotenv
VITE_AZTEC_NODE_URL=http://localhost:8080
VITE_MAGNA_CONSUMER_GATEWAY_ADDRESS=0x...
VITE_MAGNA_SESSION_AUTHORIZATION_ADDRESS=0x...
```

The last address is the active `MagnaCompanySponsor` whose transaction effects the relying party
accepts. A fresh deployment changes these values, so the dApp configuration must come from the same
bootstrap/deployment manifest as the wallet.

### 5.2 Verification API addresses

`apps/magna-verification-api/.env` needs the issuer and orchestrator addresses. After bootstrap, copy them from the generated deployment manifest (`deployments/*.json`) or from `apps/magna-management/.env`:

```dotenv
MAGNA_ISSUER_ADDRESS=<VITE_MAGNA_ISSUER_ADDRESS from management .env>
MAGNA_ORCHESTRATOR_ADDRESS=<VITE_MAGNA_ORCHESTRATOR_ADDRESS from management .env>
```

The rest of `apps/magna-verification-api/.env.example` works as-is for local dev (`MAGNA_ZKPASSPORT_DEV_MODE=true` verifies mock-passport roots on Sepolia via the public RPC).

The intended Dockerized passport flow uses this official zkPassport developer profile. It must
consume a genuine proof generated by the official mock-passport flow, not a fixture or verifier
bypass. With `devMode=true`, Magna requests the SDK's non-salted identifier, regular FaceMatch, and a
separate hash-pinned wrapper requiring `NON_SALTED_MOCK = 2` and `oprf_pk_hash = 0`. zkPassport
confirmed on 2026-08-25 that OPRF does not currently work with dev mode and has no ETA, so
`SALTED = 1` is intentionally not a local-Docker acceptance requirement. The developer app still
requires FaceMatch against the selected official mock-passport portrait, but regular mode removes
the strict liveness requirement.

The isolated production profile remains `devMode=false`, strict FaceMatch, mainnet registry context,
and `SALTED = 1` pinned to OPRF key ID `1`. Its supported-physical-passport empirical run will be
performed during testnet deployment before any production release; it does not require a fork of the
zkPassport mobile application.

The fast local-network target uses Anvil chain ID `31337`. The official SDK still performs its own read-only developer-root check against Sepolia while the Magna integration independently exercises the pinned official registry/verifier contracts on the shared local Anvil. This permits the combined local portal-to-Inbox test without deploying Magna to a public Aztec testnet. Generating a new official developer proof still needs the zkPassport application and its proof resources, but the non-salted developer request makes no TACEO OPRF authorization or evaluation request.

> **Scope must match:** `MAGNA_ZKPASSPORT_SCOPE` (verification API) must equal `VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE` (management), or `verify()` returns `verified=false`. Both default to `magna-passport-onboarding`.

---

## 6. Additional components

These are **not** required to run the two apps:

- **Instagram V2 production-live adapter** — `npm run instagram-proof:prepare` builds `@magna/instagram-proof` against `zkemail.nr` v2.0.0 and compiles it with exactly `nargo 1.0.0-beta.5`, matching upstream zkEmail CI. Its isolated Noir.js runtime is also beta.5 and its Barretenberg backend is `@aztec/bb.js 0.84.0`. The executable ACIR is pinned by SHA-256. The management browser reads the signed `.eml`, verifies DKIM, samples a private handle blind, and generates the proof locally; neither the email nor the handle/hash/blind is sent to Magna API. The API receives only the proof and its seven public outputs, checks the owner/issuer/chain/expiry bindings, and fails closed unless the proof-bound modulus+REDC commitment is governed by `MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES`. The compiler command force-builds the circuit, enables Brillig lookback, accepts exactly five source-hash-pinned diagnostics whose manual constraints were audited, and fails on diagnostic/source drift. Private Aztec login recomputes the blinded commitment from the locally retained witness. `npm run test:instagram-proof` uses a committed, independently DKIM-verified real Instagram email and rejects mutations across the audited header, RSA, and partial-body-hash boundaries. Exact scope and evidence are in `docs/evidence/instagram-proof-portability-2026-08-30.md`.
- **L1 rights portal (Solidity/Foundry)** — `cd l1-contracts/magna-rights-portal && forge build`. Needed only for the L1→L2 rights-purchase rail.
- **Fee Juice funding** — in the chain-31337 developer profile, use **Fund active wallet** in Settings or **Fund recovery target** on the Recovery page. Recovery funds its transient Ghost automatically. The browser performs the canonical L1→L2 bridge and claim directly; the Magna API is not involved. The CLI command remains an operator diagnostic, not a user step.
- **Golden vectors sync** — `npm run vectors:sync` (regenerates shared TS/Noir constants; part of `test:ci`).

---

## 7. Testing

```bash
npm run test:ci                       # pinned contract tests + core/wallet/client unit tests
npm run test:contracts:issuer         # a single contract's Noir tests
npm run -w @magna/client test         # one package's unit tests
npm run test:instagram-proof:docker   # exact compiler + real DKIM proof and verification (~80s)
AZTEC_E2E=1 npm run -w @magna/e2e-tests test   # aztec.js integration suite (needs local network)
```

### M3 verification and metering decision

Privacy-preserving receipt events are formally descoped from M3. The relying party receives the
signed verification result and transaction hash; aggregate metering remains atomic. Typed private
receipt events are therefore not an unfinished M3 deliverable. The “signed verification result” is
now the passkey-authorized Aztec transaction plus its request-bound authorization nullifier, not a
signature produced by a Magna application key.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Fresh zkPassport proof reported stale / `Tx dropped by P2P node` | Run `npm run localnet:drift`. If it reports 72s slots or excessive drift, restart with `npm run network:local`, then rerun `bootstrap:local` and `recovery-v3:bootstrap:local`. The pinned short-slot profile plus clock-paced Inbox checkpoints prevents the former per-attempt accumulation. |
| App can't reach contracts / blank state | Bootstrap not run, or run before the network was ready. Restart network, wait until ready, re-run `bootstrap:local`. |
| `verify()` returns `verified=false` | `MAGNA_ZKPASSPORT_SCOPE` ≠ `VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE`, or the verification API is missing `MAGNA_ISSUER_ADDRESS` / `MAGNA_ORCHESTRATOR_ADDRESS`. |
| Reference dApp rejects the login result | The dApp and wallet may point at different Aztec nodes, consumer gateways, or session-authorization sponsor deployments. Regenerate both app environments from the same bootstrap (§5.1). |
| `aztec`/`aztec-nargo` not found | Re-run `aztec-up 5.1.0` and confirm with `npm run aztec:version`. |
| Build errors about missing contract bindings | Run `npm run compile:contracts && npm run codegen:contracts` before `npm run build`. |

---

## 9. Repository layout

```
contracts/                       Noir/Aztec protocol contracts
  magna-issuer/                  issuer / verify / recover logic (sole issuer = ORCHESTRATOR_ADDRESS)
  magna-company-sponsor/         company-owned sponsor gateway for sponsored verifies
  magna-company-rights-registry/ L2 rights ledger consumed by sponsor verifies
  magna-verify-meter-hook[-instant]/  public metering hooks for sponsorship
  magna-consumer/                tiny consumer dApp gate using magna-lib helpers
  magna-rights-purchase-l2/      L2 rights purchase
  magna-webauthn-account/        WebAuthn (passkey) account contract
l1-contracts/magna-rights-portal/  Solidity L1 purchase portal (Foundry)
packages/
  magna-core/                    core primitives & types
  magna-client/                  thin "Login with Magna" SDK for dApps
  magna-wallet/                  wallet engine (notes, proving, Aztec bindings)
  magna-passport-wrapper-proof/  PII-blind passport wrapper circuit + helpers
  magna-instagram-proof/         production-live Instagram DKIM/handle proof adapter
  magna-lib/                     Noir policy primitives for dApps
  contracts-bindings/            generated TS contract bindings
  e2e-tests/                     aztec.js integration tests
apps/
  magna-management/              Management dApp (issuance, recovery, sponsor flows)
  reference-dapp/                Minimal "Login with Magna" integration demo
  magna-verification-api/        off-chain zkPassport verification + issuance service
docs/                            protocol spec, threat model, integration guide
Diagrams/                        product & flow diagrams
scripts/                         tooling: contract compile/codegen, bootstrap, local network
```

---

## 10. Tooling command reference

| Command | What it does |
| --- | --- |
| `npm run aztec:version` | Verify the pinned Aztec CLI version (`5.1.0`). |
| `npm run compile:contracts` | Compile all Noir/Aztec contract crates. |
| `npm run codegen:contracts` | Generate TS bindings → `packages/contracts-bindings/src`. |
| `npm run build` | Build all workspace packages + apps (`npm run -ws build`). |
| `npm run network:local` | Start the local Aztec network on `:8080`. |
| `npm run localnet:drift` | Report how far the local-network clock has drifted. |
| `npm run bootstrap:local` | Deploy contracts and populate the app `.env` files. |
| `npm run docker:local` | Delete the previous Magna chain/runtime/image/cache, rebuild without cache, and perform a fresh ordered deployment. |
| `npm run docker:local:resume` | Deliberately resume/rebuild against the current disposable Compose chain and volumes. |
| `npm run docker:local:down` | Remove the disposable Compose stack and its local-chain/runtime volumes. |
| `npm run verification-api:dev` | Run the verification API on `:4310`. |
| `npm run fund:fee-juice` | Operator-only Fee Juice diagnostic/fallback; normal local users fund from the management UI. |
| `npm run vectors:sync` | Sync shared golden vectors into generated constants. |
| `npm run test:ci` | Run the pinned contract + unit test suite. |
| `npm run test:reviewer:critical:docker` | Run the blocker, Recovery V3, API/UI, and real Instagram proof acceptance suite in the already-built pinned Docker image. |

---

## 11. Current scope & stability notes

- **Primary credential source:** `zkPassport` (canonical claims: `age`, `nationality`, `expiry`), issued via the **A2 recursive / PII-blind** flow. The browser recursively proves a pinned zkPassport outer proof and sends only the wrapper proof, its eight public outputs, registry context, owner addresses, and lifecycle metadata. Raw passport claims, outer proofs, identifiers, and private note hints must remain local.
- **Rooted Passport is the launch path:** `register_rooted_passport_v2` plus linked Passport verification paths. The project has never been deployed, so the unsafe generic rootless `recover(...)` and legacy root-authorization surfaces were removed rather than retained for backward compatibility. Rootless issuance remains only where the shipped adapter requires it, currently Instagram V2, whose wallet-loss lifecycle is fresh proof and re-issuance.
- **Root recovery is proof-bound and backend-optional:** the Ghost-owned `RootRecoveryNote` identifies the lineage but is not sufficient to recover it. The browser creates a fresh zkPassport proof bound to the destination, nonce, deployment, and Aztec message secret. `MagnaRecoveryPortal` verifies the recursive wrapper against zkPassport's authoritative Ethereum registries and sends the proof-authenticated authorization through the canonical Aztec Inbox. The Ghost then calls private `recover_root_v3(...)`, which consumes that exact L1→L2 message and atomically rotates the root plus the complete rooted passport note set to the approved destination. The Magna API is not used in this recovery authority path.
- **Social recovery scope is explicit, but acceptance is still required:** the shipped Instagram
  adapter issues a rootless credential. Magna never implemented a `recover_linked(...)` entrypoint;
  the old generic rootless `recover(...)` was removed because Ghost possession alone was unsafe.
  Root Recovery V3 rotates only the rooted passport lineage, so Instagram is currently re-issued
  from a fresh signed email after wallet loss. The original proposal did not use the later
  rooted/linked terminology, but it promised recovery per credential and a complete SDK lifecycle;
  therefore this re-issuance boundary is a scope deviation that must be implemented or accepted in
  writing before M4 is called closed.
- **M3 is explicitly closed by scope decision:** privacy-preserving receipt events are formally descoped. Relying parties receive the signed verification result and transaction hash, while aggregate metering remains atomic. The current result is authorized by the user's passkey-backed Aztec transaction and its request-bound nullifier; no Magna signing key is involved.
- **Identifier profiles fail closed:** production SDK `0.16.1` uses `NullifierType.SALTED`, explicit OPRF key ID `1`, strict FaceMatch, and a wrapper requiring `SALTED = 1`. Explicit developer mode uses the official non-salted request, regular FaceMatch, and a separate wrapper requiring `NON_SALTED_MOCK = 2`. The exact query selects zkPassport `outer_count_7` version `0.20.0` (12 public inputs; VK hash `0x19d93a8a69386b80903a8559d884bea729dc1ecc1db48afc6d3bb73d4ed3abbe`). Production pins public input `11`, `oprf_pk_hash`, to `1178201404428554206520802247552222388413553631367032661928167491793274360628`; development requires it to equal `0`. Neither profile accepts the other's artifact. zkPassport confirmed that OPRF is not available in dev mode, so local Docker intentionally validates only the non-salted developer profile. The real-passport `SALTED = 1` run belongs to testnet deployment. Salted OPRF remains the production privacy defense; the separate proof-bound authorization closes recovery even after identifier disclosure.
- **Production OPRF integration is a frozen V3 dependency:** zkPassport reported no planned change to the current integration. Magna permanently pins SDK `0.16.1`, production `SALTED`, OPRF key ID `1`, its published public-key hash, and the authenticated outer-proof layout for V3. A newer SDK/key/circuit is a new protocol version, never an automatic upgrade. V3 continuity is defined for the same supported document and exact Magna scope; replacement documents are outside that identity-continuity boundary. The official developer/mock-passport flow instead uses `NON_SALTED_MOCK = 2` and no OPRF solely to keep local integration testable; it is not production-equivalent identifier/privacy evidence. A real supported-document, production `SALTED = 1` artifact and production-wrapper EVM verification are still required before release.
- **Local orchestrator:** the verification API intentionally imports an Aztec initial test account for the disposable local testnet. This is acceptable for local development only. A non-local deployment must reject that path and provide production custody plus a reviewed rotation/emergency design.
- **Current signer-rotation limitation:** the pinned Aztec `SchnorrInitializerlessAccount` commits its signing public key into the account's immutable hash and exposes no rotation entrypoint. The current claim that the stable orchestrator account can rotate this signer is therefore not implemented and must not be relied on for production.
- **Browser secret lifetime:** JavaScript cannot guarantee secure erasure of the immutable identifier string. The client does not persist or transmit it, confines it to the recovery callback, and disposes each transient Ghost session in `finally`. A dedicated recovery origin/page-realm without third-party scripts remains a production deployment requirement because garbage-collector timing cannot be guaranteed.
- **Renewal/revocation:** passport expiry *pauses* linked authority until `refresh_root_authority(...)` rotates the rooted authority note under the same `root_commitment`. Root revocation kills every linked descendant.
- Under A2, `root_commitment` is derived in-circuit from the proof-bound scoped nullifier. Ghost derivation remains versioned separately, so upstream identifier changes must never be adopted silently.

For protocol internals see `docs/protocol-spec.md`, `docs/threat-model.md`, and `docs/integration-guide.md`.
