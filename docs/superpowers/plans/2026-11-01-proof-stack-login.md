# Proof Stack and Login Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the upstream proof upgrade without breaking current issuance, Instagram or login; activate only a publicly usable, fully verified proof tuple.

**Architecture:** Preserve the working proof runtimes while testing upstream readiness. Keep the existing authorization popup and wallet broker, fixing lifecycle races without changing credential semantics.

**Tech Stack:** Aztec 6.0.0, Noir, Barretenberg, TypeScript/Node 24, React/Vite.

**Spec:** `docs/superpowers/specs/2026-11-01-proof-stack-login-design.md` (user-approved scope captured after approval; no further approval round).

## Global Constraints

- Stay on `feat/credential-linking-recovery`; preserve user changes in `.gitignore` and `docs/onboarding-gas-policy.md`.
- Instagram stays functional on Noir beta.5/BB 0.84.0 until a newer working stack is verified. No blanket dependency overrides.
- Retain credential privacy, owner revocation, root attachment, claim/expiry semantics, recovery bindings and chain-bound login verification.
- Do not activate an upstream tuple with unavailable manifests or invalid trust roots. No mock proofs or injected registry roots as acceptance evidence.
- No remote deploy, reset of existing chain data, push or publish. No legacy credential adapters or new product features.

## Review Focus

- Slow asynchronous hashing must not lose the initiating gesture or miss the popup-ready event (Task 2).
- Same-origin messages from another tab must not settle or steal an authorization handshake (Task 2).
- Timeout, popup cancellation and overlapping login calls must not leave stale windows/listeners or break retry (Task 2).
- SDK support alone must not mark an unavailable/unregistered circuit release ready (Task 1).
- Instagram must still generate/verify its real proof and retain wallet routing after shared tooling changes (Task 3).

### Task 1: Upstream readiness gate

**Files:** Create `scripts/check-zkpassport-v6-readiness.mjs`, `scripts/check-zkpassport-v6-readiness.spec.mjs`; modify `package.json`, `docs/reviewer-guide.md`.

**Interfaces:** Export `checkZkPassportV6Readiness({ fetchImpl, checkRoot }) -> Promise<{ ready, checks }>`; default implementation reads official manifest endpoints and RootRegistry on mainnet/Sepolia. Pin candidate source/version/root/key in this script. A CLI returns nonzero unless all checks pass; never mutates runtime configuration.

- [ ] Write tests for missing manifests, wrong version/root/key, failed RPC, invalid root, and a fully matched tuple; assert readiness and specific failure records.
- [ ] Run `node --test scripts/check-zkpassport-v6-readiness.spec.mjs` and observe the intended missing-implementation failure.
- [ ] Implement bounded read-only checks and add `readiness:zkpassport-v6` / `test:zkpassport-v6-readiness` npm commands. No fallback to local or unregistered roots.
- [ ] Run the tests, then the actual readiness command; expect current upstream failure and record the public evidence without changing the active proof stack.
- [ ] Commit owned files and record the external activation blocker.

### Task 2: Preserve one authorization window and clean retry

**Files:** Modify `packages/magna-client/src/connector.ts`, `packages/magna-client/src/connector.spec.ts`; related connector `WindowImpl` test fixtures only as needed.

**Interfaces:** `login` / `loginWithRequirements` keep their promise/result API; reserve one `PopupLike` synchronously, add `location.replace(url)` and message `source` to the injected browser interface. Keep one pending request until validation settles.

- [ ] Write failing connector tests for synchronous reservation, overlapping calls, wrong source, error/timeout cleanup, successful one-request handshake and retry.
- [ ] Run `npm run -w @magna-protocol/client test`; verify the failures reproduce the lifecycle defects.
- [ ] Reserve `about:blank` during the gesture, install handlers before navigation, and clean up consistently. Retain all origin/request/challenge/policy/chain checks.
- [ ] Run connector and management wallet-login/session-broker suites, WASM routing and SDK consumer tests. Expected: all pass.
- [ ] Exercise the actual browser handshake on a temporary local harness without identity data; verify exactly one popup, no lost ready event, and cancellation/retry. Do not claim hardware passkey or chain proof acceptance from this harness.
- [ ] Commit owned files and record evidence.

### Task 3: Full regression and conditional proof cutover

**Files:** Update `docs/local-docker.md`, `docs/reviewer-guide.md`, this plan; proof/compiler/deployment files only if upstream is actually ready.

**Interfaces:** Consumes Task 1 readiness report and Task 2 connector. Existing network remains V6; candidate cutover requires an available SDK/mobile/circuit/registry tuple.

- [ ] Run `npm test`, `npm run test:compiler-isolation`, `npm run check:proof-runtimes`, all builds and SDK consumer checks. Report live E2E skips explicitly.
- [ ] Run real Instagram private-fixture proof validation and confirm no compiler/runtime/artifact pins changed.
- [ ] If readiness is false, preserve the working runtime and document the blocked cutover. Do not mark the whole proof migration complete.
- [ ] If readiness passes, pin and migrate the full Passport/Recovery tuple, test rc.3 and stable, update all artifacts/verifiers and perform official-proof acceptance before switching the active tuple. This branch is not permitted to bypass the availability gate.
- [ ] Run a fresh-context whole-change review, fix important findings with regressions, commit evidence and report the remaining activation gate.
