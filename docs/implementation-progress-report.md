# Magna Implementation Progress Report

This document records what we changed, why we changed it, which plans and markdown notes were created, what progress was made, and where the work is currently blocked.

## Primary Rule

The strictest rule for this repo is:

- Verify every integration-critical change against official docs or official upstream source before changing code.

This is not optional for:

- Aztec SDK and Aztec.nr usage
- Noir contract semantics
- wallet-sdk flows
- passkeys / WebAuthn
- browser packaging/runtime behavior
- zkPassport client/server flow

## Why This Rule Became Mandatory

When we followed the docs-first rule, progress was real and durable.

When we guessed, improvised, or tried to infer behavior from types alone, we created long error chains and repeated regressions. In practice this caused 10+ separate failure classes and wasted debugging loops because the wrong layer was being "fixed".

Representative failures from guess-first work:

- `WebAssembly.instantiate(): expected magic word ... found <!do`
- CommonJS/ESM browser import failures involving `pino`, `sha3`, `hash.js`, `lodash.*`, and `json-stringify-deterministic`
- `Type 'object' with value '0x...' passed to BaseField ctor.`
- `Failed to execute 'put' on 'IDBObjectStore': The transaction has finished.`
- `Attempted to emit duplicate siloed nullifier ...`
- `simulation.result.toBigInt is not a function`
- `Block hash ... not found when querying world state`
- `fee cap exceeded`
- `invalid sponsor slot`
- `Create/use Magna passkey wallet failed: This is an invalid domain.`
- `Unauthorized method/chain: method=getAccounts, chain=aztec:0`

The core lesson is that these were not ordinary frontend mistakes. They were protocol- and SDK-shape mistakes caused by diverging from the documented flows.

## Progress Summary

### 1. Multi-sponsor issuer refactor

Completed:

- Refactored `MagnaIssuer` from single-sponsor assumptions toward multi-sponsor support.
- Updated related bindings and client surfaces.
- Aligned fee-sponsor selection semantics in frontend/client code.
- Added a source-of-truth document pinned to Aztec `4.2.0-aztecnr-rc.2`.

Primary artifacts:

- `contracts/magna-issuer/src/main.nr`
- `packages/contracts-bindings/src/MagnaIssuer.ts`
- `packages/magna-client/src/client.ts`
- `apps/magna-web/src/lib/env.ts`
- `apps/magna-web/src/App.tsx`
- `docs/aztec-4.2.0-multi-sponsor-source-of-truth.md`

### 2. Browser Aztec integration and managed wallet recovery

Completed:

- Fixed Aztec browser packaging/runtime issues in Vite.
- Added browser shims for problematic CJS dependencies.
- Fixed managed wallet bootstrap behavior to align with the documented local-dev flow.
- Eliminated the `BaseField ctor`-style runtime identity problem by aligning packaging/runtime boundaries and account flow.

Primary artifacts:

- `apps/magna-web/vite.config.js`
- `apps/magna-web/src/lib/vendor/`
- `apps/magna-web/src/lib/wallet.ts`
- `apps/magna-web/playwright.config.ts`
- `docs/aztec-browser-managed-wallet-postmortem.md`

### 3. Local bootstrap and web app bring-up

Completed:

- Added full local web bootstrap flow.
- Implemented deployment/bootstrap automation for web-facing contracts.
- Added env auto-fill from deployment manifest.
- Added validation for L2 token address and deployment reuse behavior.

Primary artifacts:

- `scripts/bootstrap-web-local.mjs`
- `scripts/magna-testnet-validate.mjs`
- `apps/magna-web/scripts/fill-env-from-local-deploy.mjs`
- `deployments/local.json`

### 4. E2E stabilization for real-send readiness

Completed:

- Fixed repeated Playwright failures across real readiness flows.
- Removed several flaky or invalid assumptions:
  - stale wallet/PXE state after restart
  - repeated sponsor nullifier collisions
  - fee cap mismatch against live node values
  - invalid slot generation
  - rights snapshot race after top-up
- Restored passing real e2e readiness coverage.

Primary artifacts:

- `apps/magna-web/e2e/real-readiness.spec.ts`
- `apps/magna-web/src/lib/magna.ts`
- `apps/magna-web/src/lib/magna.spec.ts`

### 5. Frontend clarity and recovery/ghost alignment

Completed:

- Reworked frontend layout and grouping for readability.
- Preserved the rule that render-only updates must not change behavior unless explicitly allowed.
- Reintroduced the intended protocol meaning of `uniqueIdentifier` for ghost derivation.
- Displayed derived ghost address in the app.

Primary artifacts:

- `apps/magna-web/src/App.tsx`
- `apps/magna-web/src/styles.css`
- `packages/magna-client/src/ghost.ts`
- `packages/magna-client/src/root.ts`
- `packages/magna-client/src/recovery-flow.spec.ts`
- `docs/zkpassport-mapping.md`

### 6. L1-first funding, passkey wallet path, restart safety

Completed:

- Added L1-first sponsor funding path as the primary operator path.
- Kept L2 top-up as a fallback path.
- Replaced the old passkey spike with a real in-app passkey wallet path.
- Added chain-aware reset behavior for browser wallet/PXE state.
- Improved external wallet connection flow, capability requests, and UI visibility.

Primary artifacts:

- `apps/magna-web/src/App.tsx`
- `apps/magna-web/src/lib/passkey.ts`
- `apps/magna-web/src/lib/wallet.ts`
- `apps/magna-web/src/lib/magna.ts`
- `docs/l1-funding-option-b.md`

### 7. zkPassport integration work

Implemented so far:

- Added dedicated backend service:
  - `apps/magna-verification-api`
- Added browser zkPassport adapter:
  - `apps/magna-web/src/lib/zkpassport.ts`
- Added primary zkPassport issuance UI:
  - request creation
  - QR/deep link
  - lifecycle states
  - backend submit
- Clarified the ownership boundary of claims in the UI:
  - primary zkPassport flow only asks for the age-threshold request input up front
  - nationality and passport expiry are populated from the verified zkPassport result, not manual entry
- Kept manual issuance only as separate dev-only fallback scaffolding.
- Added local env fallback so the verification API can start from existing web env files.
- Added frontend default/fallback configuration for `http://localhost:4310`.

Primary artifacts:

- `apps/magna-verification-api/src/service.ts`
- `apps/magna-verification-api/src/server.ts`
- `apps/magna-verification-api/src/service.spec.ts`
- `apps/magna-verification-api/.env.example`
- `apps/magna-verification-api/README.md`
- `apps/magna-web/src/lib/zkpassport.ts`
- `apps/magna-web/src/lib/env.ts`
- `apps/magna-web/.env.example`
- `apps/magna-web/.env.local`

Current status:

- Verification API boots successfully.
- Frontend now points to `http://localhost:4310` locally.
- Frontend primary issuance messaging now matches the intended trust model:
  - zkPassport is the canonical source for nationality and expiry
  - manual claims entry is not part of the primary issuance path
- The remaining blocker is not startup/config anymore.
- The remaining blocker is zkPassport verification returning `verified=false`.

## Plans Created And Used

These are the main plan files created and used across this sequence of work:

- `.cursor/plans/multi_sponsor_issuer_07df33d6.plan.md`
  - Multi-sponsor issuer contract refactor and related updates.
- `.cursor/plans/frontend_multi-sponsor_integration_457beb46.plan.md`
  - Frontend integration and render-path clarity for the multi-sponsor work.
- `.cursor/plans/funding_and_passkey_7778d507.plan.md`
  - L1-first funding, passkey in-app wallet path, restart-safe browser state, and docs-first rule reinforcement.
- `.cursor/plans/zkpassport_integration_plan_d3104541.plan.md`
  - Dedicated backend verification API, browser zkPassport flow, canonical claim normalization, env split, and validation coverage.

Status of the major plans above:

- Multi-sponsor issuer: implemented
- Frontend integration/clarity: implemented
- Funding and passkey plan: implemented
- zkPassport implementation plan: structurally implemented, but real zkPassport verification is still blocked by `verified=false`

## Markdown Files Created Or Updated As Durable Project Memory

### Created project docs

- `docs/aztec-4.2.0-multi-sponsor-source-of-truth.md`
  - Guardrail mapping Magna multi-sponsor decisions to official Aztec sources.
- `docs/aztec-browser-managed-wallet-postmortem.md`
  - Postmortem of browser/runtime failures and why docs-first was the correct rule.
- `docs/l1-funding-option-b.md`
  - Production-oriented alternative design for L1 funding with backend signer custody.
- `docs/implementation-progress-report.md`
  - This document.

### Important existing docs that were used as protocol/security anchors

- `docs/zkpassport-mapping.md`
- `docs/protocol-spec.md`
- `docs/no-drain-sponsorship.md`

### Updated documentation surfaces

- `apps/magna-web/README.md`
- `apps/magna-verification-api/README.md`

## Validation Progress

Validated successfully during this sequence:

- web lint/typecheck
- web unit tests
- verification API lint/typecheck
- verification API tests
- web production build
- real-send Playwright readiness coverage for the pre-zkPassport readiness path

Validated conceptually but not yet fully complete in live runtime:

- real zkPassport verification from request -> server verify -> issuance

## Current State

What is working now:

- multi-sponsor issuer direction
- browser render/runtime recovery from earlier Aztec integration failures
- managed wallet and passkey wallet paths
- L1-first sponsor funding path
- restart-safe local browser wallet behavior
- external wallet discovery/secure channel/capability flow
- dedicated zkPassport verification API startup
- frontend zkPassport request UI and backend handoff wiring

What is not yet resolved:

- live zkPassport verification is still returning `verified=false`

This means the current blocker is no longer:

- missing env
- broken API startup
- frontend not pointing to the API

It is now specifically in the real zkPassport request/verification result path.

## Next Debugging Target

The next step should be docs-first investigation of why the zkPassport proof package or request/query pairing is producing `verified=false`, with special attention to:

- exact request builder fields and scope consistency
- whether `originalQuery`, `queryResult`, and `proofs` match the server verification contract exactly
- local domain assumptions
- whether the generated request metadata matches zkPassport's expected verification context

## Current Stopping Point

```text
zkPassport flow failed: zkPassport returned verified=false.
zkPassport flow failed: zkPassport returned verified=false.
```
