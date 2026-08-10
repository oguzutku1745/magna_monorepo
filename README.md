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
| **Aztec toolchain** | `5.0.0-rc.1` | Provides `aztec` and `aztec-nargo`. Pinned in `.aztecrc`. |
| **Docker** | latest | Required by the Aztec local network / sandbox. |
| **Foundry** (`forge`) | latest | *Optional* — only needed to build the L1 Solidity contracts (`l1-contracts/`). Not required to run the two apps. |

Install the Aztec toolchain and pin the version this repo expects:

```bash
# Install the Aztec installer (provides `aztec`, `aztec-nargo`, `aztec-up`)
bash -i <(curl -s https://install.aztec.network)

# Pin to the version used by this repo
aztec-up 5.0.0-rc.1

# Verify (this script forces the pinned version)
npm run aztec:version    # expects 5.0.0-rc.1
```

> If `aztec` is not on your PATH after install, follow the path hint printed by the installer, then re-open your shell.

---

## 2. Quick start (TL;DR)

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
npm run web:bootstrap:local

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
Compiles all Noir/Aztec contract crates in `contracts/` (issuer, company-sponsor, company-rights-registry, verify-meter-hook[-instant], consumer, rights-purchase-l2, webauthn-account) via `scripts/aztec-tooling.mjs`, which pins the toolchain to `5.0.0-rc.1`.

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

> ⚠️ **Clock drift:** the local network's clock runs ahead of wall-clock over time and eventually drops valid txs (`Tx dropped by P2P node`). Check it with `npm run localnet:drift`. The only fix is **restart the network and re-run the bootstrap** (§3.6). See `scripts/start-local-network.sh` for details.

### 3.6 Deploy + bootstrap local env
```bash
npm run web:bootstrap:local
```
With the local network running, this deploys the contracts and writes deployment addresses into:

- `apps/magna-web/.env.local`
- `apps/magna-management/.env`
- `apps/reference-dapp/.env`
- a deployment manifest under `deployments/*.json`

Re-run it any time you restart the local network.

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
| Magna Web (compat console, optional) | `@magna/web` | `npm run -w @magna/web dev` | http://localhost:5173 |

`apps/magna-web` is the read-only compatibility/method-reference console — not part of the core demo flow.

---

## 5. Environment configuration

`npm run web:bootstrap:local` fills in all **contract addresses** automatically. Two things are **not** auto-generated and must be set by hand for local dev:

### 5.1 Dev session signing keypair (Management ↔ Reference dApp)

The Management app signs verification results with a P-256 key; the Reference dApp verifies them with the matching public JWK. Generate a throwaway **dev-only** pair:

```bash
node --input-type=module -e '
import { webcrypto as c } from "node:crypto";
const kp = await c.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign","verify"]);
const pkcs8 = Buffer.from(await c.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
const jwk = await c.subtle.exportKey("jwk", kp.publicKey);
console.log("VITE_MAGNA_SESSION_SIGNING_KEY=" + pkcs8);
console.log("VITE_MAGNA_PUBLIC_KEY_JWK="     + JSON.stringify(jwk));
'
```

- Put `VITE_MAGNA_SESSION_SIGNING_KEY=...` into **`apps/magna-management/.env`**.
- Put `VITE_MAGNA_PUBLIC_KEY_JWK=...` into **`apps/reference-dapp/.env`**.

> Set these **after** running the bootstrap so they aren't overwritten. Never reuse these keys outside local dev.

### 5.2 Verification API addresses

`apps/magna-verification-api/.env` needs the issuer and orchestrator addresses. After bootstrap, copy them from the generated deployment manifest (`deployments/*.json`) or from `apps/magna-management/.env`:

```dotenv
MAGNA_ISSUER_ADDRESS=<VITE_MAGNA_ISSUER_ADDRESS from management .env>
MAGNA_ORCHESTRATOR_ADDRESS=<VITE_MAGNA_ORCHESTRATOR_ADDRESS from management .env>
```

The rest of `apps/magna-verification-api/.env.example` works as-is for local dev (`MAGNA_ZKPASSPORT_DEV_MODE=true` verifies mock-passport roots on Sepolia via the public RPC).

> **Scope must match:** `MAGNA_ZKPASSPORT_SCOPE` (verification API) must equal `VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE` (management), or `verify()` returns `verified=false`. Both default to `magna-passport-onboarding`.

---

## 6. Optional components

These are **not** required to run the two apps:

- **Instagram proof circuit** — `npm run instagram-proof:prepare` (builds `@magna/instagram-proof` and compiles its Noir circuit). Uses a standalone `nargo`.
- **L1 rights portal (Solidity/Foundry)** — `cd l1-contracts/magna-rights-portal && forge build`. Needed only for the L1→L2 rights-purchase rail.
- **Fee juice funding** — `npm run fund:fee-juice` if accounts run out of fee juice on the local network.
- **Golden vectors sync** — `npm run vectors:sync` (regenerates shared TS/Noir constants; part of `test:ci`).

---

## 7. Testing

```bash
npm run test:ci                       # pinned contract tests + core/wallet/client unit tests
npm run test:contracts:issuer         # a single contract's Noir tests
npm run -w @magna/client test         # one package's unit tests
AZTEC_E2E=1 npm run -w @magna/e2e-tests test   # aztec.js integration suite (needs local network)
```

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Tx dropped by P2P node` | Local-network clock drift. Run `npm run localnet:drift` to confirm, then **restart `network:local` and re-run `web:bootstrap:local`**. |
| App can't reach contracts / blank state | Bootstrap not run, or run before the network was ready. Restart network, wait until ready, re-run `web:bootstrap:local`. |
| `verify()` returns `verified=false` | `MAGNA_ZKPASSPORT_SCOPE` ≠ `VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE`, or the verification API is missing `MAGNA_ISSUER_ADDRESS` / `MAGNA_ORCHESTRATOR_ADDRESS`. |
| Reference dApp rejects the login result | `VITE_MAGNA_PUBLIC_KEY_JWK` doesn't match the management app's `VITE_MAGNA_SESSION_SIGNING_KEY`. Regenerate the pair (§5.1). |
| `aztec`/`aztec-nargo` not found | Re-run `aztec-up 5.0.0-rc.1` and confirm with `npm run aztec:version`. |
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
  magna-instagram-proof/         Instagram handle proof circuit (experimental)
  magna-lib/                     Noir policy primitives for dApps
  contracts-bindings/            generated TS contract bindings
  e2e-tests/                     aztec.js integration tests
apps/
  magna-management/              Management dApp (issuance, recovery, sponsor flows)
  reference-dapp/                Minimal "Login with Magna" integration demo
  magna-verification-api/        off-chain zkPassport verification + issuance service
  magna-web/                     compatibility/method-reference console (read-only)
docs/                            protocol spec, threat model, integration guide
Diagrams/                        product & flow diagrams
scripts/                         tooling: contract compile/codegen, bootstrap, local network
```

---

## 10. Tooling command reference

| Command | What it does |
| --- | --- |
| `npm run aztec:version` | Verify the pinned Aztec CLI version (`5.0.0-rc.1`). |
| `npm run compile:contracts` | Compile all Noir/Aztec contract crates. |
| `npm run codegen:contracts` | Generate TS bindings → `packages/contracts-bindings/src`. |
| `npm run build` | Build all workspace packages + apps (`npm run -ws build`). |
| `npm run network:local` | Start the local Aztec network on `:8080`. |
| `npm run localnet:drift` | Report how far the local-network clock has drifted. |
| `npm run web:bootstrap:local` | Deploy contracts and populate the app `.env` files. |
| `npm run verification-api:dev` | Run the verification API on `:4310`. |
| `npm run fund:fee-juice` | Top up fee juice for local accounts. |
| `npm run vectors:sync` | Sync shared golden vectors into generated constants. |
| `npm run test:ci` | Run the pinned contract + unit test suite. |

---

## 11. v1 scope & stability notes

- **Primary credential source:** `zkPassport` (canonical claims: `age`, `nationality`, `expiry`), issued via the **A1 / PII-blind** flow. A1 issuance excludes raw passport claims, `queryResult`, committed-input material, claim blinds, and the unscoped `uniqueIdentifier` from the verification API payload. The API still receives proofs, public inputs, owner addresses, commitments, the scoped nullifier, and lifecycle-specific metadata; rooted renewal additionally sends private root note hints.
- **Rooted identity is the canonical path:** `register_rooted_passport` + linked verify paths. Legacy rootless flows are compatibility-only and must be explicitly selected.
- **Recovery** uses deterministic **Ghost account** derivation from a scoped zkPassport identifier. Ghost derivation is versioned (`v1_legacy_unscoped`, `v2_scoped`) to avoid silent recovery breakage.
- **Issuance** is accepted only from the immutable `ORCHESTRATOR_ADDRESS` (a stable orchestrator account, required by Aztec sender-for-tags discovery).
- **Renewal/revocation:** passport expiry *pauses* linked authority until `refresh_root_authority(...)` rotates the rooted authority note under the same `root_commitment`. Root revocation kills every linked descendant.
- `root_commitment` derivation is v1-stable and derived client-side from the scoped zkPassport `uniqueIdentifier` during onboarding. If upstream identity primitives move to salted/vOPRF-backed identifiers, add an explicit migration/versioning path rather than silently changing the derivation.

For protocol internals see `docs/protocol-spec.md`, `docs/threat-model.md`, and `docs/integration-guide.md`.
