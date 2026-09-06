# Managed local Docker clock — 2026-09-06

## Scope and source

Source HEAD is `3740630` with uncommitted application and clock changes. This is
working-tree evidence, not evidence from a clean Git commit. The managed clock
targets only the digest-pinned Aztec 5.1.0 local Docker profile, chain 31337.

The gateway activation delay remains 3,600 seconds. Passport freshness checks,
authenticated dates, proof verification, and the 8-second Aztec / 4-second
Ethereum slot parameters are unchanged.

## Real-chain integration

Command: `npm run test:localnet:clock:docker`.

The test starts an isolated Anvil and actual Aztec node, loads the production
local-clock hooks, deploys an issuer, consumer, and token, and checks:

- The gateway is denied before the delay and allowed after at least 3,600 chain
  seconds. This happens in historical bootstrap time.
- Activation catches up forward to real time and clears Anvil's synthetic
  timestamp interval. Pending drift at activation: **0 seconds**.
- An explicit future debug-warp target is rejected.
- Recovery-style synchronization to wall time does not expose a future pending
  timestamp while waiting for slot rounding: **66 samples passed**.
- Two real Fee Juice bridge/Inbox/claim cycles take **32.108 seconds** and
  **32.440 seconds**, each requiring three local checkpoints. Both increase the
  recipient's balance.
- The two funding cycles plus an ordinary Aztec token mint take **72.272
  seconds** total. The token balance is checked. Final mined drift is **-1
  second**; after an idle period, pending drift is **-1 second**.

The test passed. It uses the standard local test accounts and local-network
proving configuration. It is not an official zkPassport mobile proof or a full
browser recovery. The measured chain steps fit under three minutes; mobile
scanning and browser proof generation are outside this measurement.

## Regression and deployment status

Diagnostic regressions: 8 passed on the host; the pinned-image compatibility
test is intentionally skipped on the host and exercised inside Docker.
Management regressions: 84 tests passed, including the shared local Inbox
deadline. Management TypeScript validation passed.

Fresh Docker deployment: passed. Image:
`sha256:558c6e1b8d23bb88ed51d97177e342aeab5578b389e4b6738f2394acf52cc04e`.
Bootstrap exited 0. At activation, L1 timestamp was `1788702563`, host timestamp
`1788702567`, mined drift **-4 seconds**, pending drift **0 seconds**. The
generated manifest SHA-256 is
`a97e1f3768c53e18a79d2991c6cc78546039e711c9bcc09f3d4bc6d8c3d60b10`.

The live issuance-uniqueness E2E passed on this new chain (24.149 seconds of test
execution, 41.72 seconds including runner startup). Duplicate rooted Passport A2
issuance failed at the existing nullifier as expected. The script ran inside
the management container with Docker-internal RPC URLs, using the same test
invoked by `npm run test:issuance-uniqueness:e2e`.

After those transactions, `npm run localnet:drift` passed against the active
management runtime endpoints. L1 block `0x75` had timestamp `1788702659`; at host
time `1788702765`, pending time was `1788702764` (**-1 second**). The older mined
block reflects idle automining, not an accumulated future clock offset.

Final-image reviewer suite: **passed**. The first run lost its TXE resolver
while the live E2E ran concurrently. A retry runs without live-test overlap,
with `NODE_OPTIONS=--max-old-space-size=3072` and `HARDWARE_CONCURRENCY=2`.
The successful command was:

```sh
docker run --rm -e NODE_OPTIONS=--max-old-space-size=3072 \
  -e HARDWARE_CONCURRENCY=2 -e LOG_LEVEL=info \
  --entrypoint sh magna-local-app:aztec-5.1.0 \
  -lc 'cd /workspace && npm run test:reviewer:critical'
```

All 14 reviewer stages passed: clock diagnostics and pinned-runtime hooks,
issuer (89 tests), session authorization, core vectors, wallet, client,
Passport A2 wrapper, Recovery V3 protocol and wrapper, EVM portal, API (25
tests), management (84 tests), reference dApp (5 tests), and Instagram real-DKIM
proof generation/verification (77.537 seconds for the proof test).

Management `:5174`, reference dApp `:5175`, and API `:4310/health` each returned
HTTP 200.

### Funding on the deployed chain

After the full reviewer suite, the actual built wallet's `fundLocalFeeJuice`
was exercised through Docker-internal RPC URLs on the deployed chain with a
standard local test account. It completed a real bridge, three Inbox
checkpoints, and a claim in **33.901 seconds** (**34.543 seconds** including
wallet initialization). The recipient balance increased by
`999999993211033100000` fee-juice units.

Claim transaction:
`0x013124a60b861b267ea09752ebbcd3190bcf0392a4bd907bfbe64982629c7204`.

At completion, mined and pending L1 timestamps were both `1788703531`, host
timestamp was `1788703532`, and both drifts were **-1 second**. Clock phase
remained `realtime`.

### Subsequent M4 user evidence

The holder subsequently completed official mobile Recovery V3 on a fresh
managed-clock deployment, with successful Aztec execution at block 45. See the
[separate mobile record](recovery-v3-mobile-2026-09-06.md), including its distinct
genesis hash and verified public receipts. This closes the pending M4 mobile
refresh; these automated timing tests do not substitute for that evidence.

## Build investigation

The initial clean build was killed during management chunk rendering with exit
137 on Docker Desktop's 8 GiB VM while the previous stack remained running.
Both frontend production builds passed in a disposable container with a 3 GiB
build heap. The Dockerfile now uses that build heap and retains the previous
6 GiB runtime setting.

Subsequent clean installs hit reproducible npm `ECONNRESET` errors during
dependency downloads. Cached installation succeeds. These build failures leave
the prior stack intact; they are not successful deployment evidence.
An empty-cache installation with `npm ci --maxsockets=5` then passed on its first
attempt (994 packages), but a later BuildKit install still hit a reset. The
Dockerfile limits concurrency and allows at most three `npm ci` attempts within
the same clean build, reusing completed downloads with the lockfile unchanged.
The final clean build passed after the second npm attempt. All contract and
application builds completed; the replacement image loaded before the old
disposable chain was removed and freshly deployed.
