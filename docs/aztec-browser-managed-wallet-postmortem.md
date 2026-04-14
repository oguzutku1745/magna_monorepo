# Aztec Browser Managed Wallet Postmortem

This document explains the browser/runtime failures we hit during the Magna web integration, why they happened in the first place, why the "always verify against official docs" rule was correct, and what we changed to fix them.

## Pinned context

- Aztec version: `4.2.0-aztecnr-rc.2`
- Web app package: `apps/magna-web`
- Primary files involved:
  - `apps/magna-web/vite.config.js`
  - `apps/magna-web/src/lib/wallet.ts`
  - `apps/magna-web/playwright.config.ts`
  - `apps/magna-web/e2e/real-readiness.spec.ts`

## Official sources that should anchor this work

These were the sources that mattered most for the eventual fix:

- Aztec docs: [Creating Accounts](https://docs.aztec.network/developers/docs/aztec-js/how_to_create_account)
- Aztec docs: [Testing Smart Contracts / local network wallet setup](https://docs.aztec.network/developers/devnet/docs/aztec-js/how_to_test)
- Aztec docs: [Paying Fees](https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees)
- Aztec docs: [Sending Transactions](https://docs.aztec.network/developers/docs/aztec-js/how_to_send_transaction)
- Repo guardrail: `docs/aztec-4.2.0-multi-sponsor-source-of-truth.md`

The most important lesson is that Aztec browser integration is sensitive to exact packaging and exact account-flow semantics. If we do not first verify the intended flow from official docs, it is very easy to "fix" the wrong layer.

## What failed

We saw several layers of failure, in this order:

1. The browser app failed to boot because WebAssembly assets for Aztec packages were being served incorrectly.
2. After that, the app hit CommonJS/ESM interop issues in browser-facing Aztec dependency paths such as `pino`, `sha3`, `hash.js`, `lodash.chunk`, `lodash.isequal`, `lodash.times`, and `json-stringify-deterministic`.
3. After those runtime issues were cleared, the app loaded but managed wallet creation still failed.
4. The managed-wallet failure showed errors such as:
   - `Type 'object' with value '0x...' passed to BaseField ctor.`
   - related constructor/type-identity failures deeper in the Aztec SDK path

The most visible user-facing symptom in Playwright was:

- `Create managed embedded wallet failed.`

## Why we got the error in the first place

There were two main underlying problems.

### 1) We had a browser packaging mismatch

Aztec's browser packages are sensitive to how Vite serves them. Some parts of the graph were being served from optimized `.vite/deps` outputs while others were being served from raw package entrypoints. That meant the browser could end up with logically equivalent Aztec types coming from different module instances.

For ordinary values that might be harmless, but Aztec field/address/key classes perform strict constructor and instance checks. When a field-like object from one module identity is passed into code using another module identity, Aztec treats it as a plain object instead of a valid field instance. That is why we saw errors shaped like:

- `Type 'object' with value '0x...' passed to BaseField ctor.`

In short: the value looked correct, but it came from the wrong runtime identity.

### 2) Our managed local bootstrap flow had drifted from the documented Aztec flow

The local managed-wallet branch was doing more than it needed to:

- it imported a local test account into the embedded wallet
- then created a fresh managed account
- then tried to deploy that fresh account using another account as the sender

That is not the clean local-network bootstrap flow the official docs push us toward.

The Aztec docs distinguish between:

- creating a fresh account with `createSchnorrAccount(secret, salt)` and then deploying it with the documented deployment semantics
- loading or registering local test accounts for local-network development

Our app mixed those concerns. That made the flow harder to reason about and increased the chance of passing the wrong Aztec objects across boundaries.

## Why the "always verify from official docs" rule was correct

This debugging session is a good example of why that rule matters.

You kept insisting that fixes must be verified against official Aztec docs first. That was correct. The reason is not just "for correctness in theory"; it materially changes the debugging strategy.

Without a docs-first check, it is easy to spend time patching symptoms:

- add one more Vite exclusion
- add one more browser shim
- add one more type workaround
- keep the same flawed app-level account flow

That approach can reduce one error and immediately reveal the next one, but still leave the implementation conceptually wrong.

The official docs narrow the solution space:

- they show the intended account creation flow
- they show the intended local-network testing flow
- they show when `NO_FROM` is the correct deployment semantic
- they make clear which parts are convenience paths for local development and which are real wallet flows

So yes: this work reinforced exactly why you kept saying "always verify from official docs." The main takeaway is that Aztec integration should be treated as docs-constrained work, not generic JavaScript debugging.

## The actual fix

We fixed the issue in two layers.

### 1) Align the browser Aztec integration with the correct packaging path

In `apps/magna-web/vite.config.js` we excluded identity-sensitive Aztec browser modules from Vite dependency optimization so they would be served consistently with the rest of the raw Aztec browser graph.

That included these entries:

- `@aztec/accounts/testing`
- `@aztec/aztec.js/addresses`
- `@aztec/aztec.js/fields`
- `@aztec/foundation/crypto/ecdsa`
- `@aztec/noir-acvm_js`
- `@aztec/noir-noirc_abi`
- `@aztec/wallets/embedded`

This mattered because keeping the relevant Aztec browser/runtime modules on the same graph reduced cross-instance class mismatches.

We also kept the targeted browser shims for problematic CommonJS dependencies that Aztec browser entrypoints pull in indirectly.

### 2) Fix the managed-wallet bootstrap flow to match the documented local-dev intent

In `apps/magna-web/src/lib/wallet.ts` we changed the local bootstrap behavior.

Before:

- local bootstrap imported a local test account
- then created a fresh managed account
- then attempted to deploy that account via the imported account

After:

- when local test bootstrap is enabled, the managed session uses the imported local test account directly
- the flow no longer tries to create and cross-deploy a fresh account in that bootstrap branch
- the branch is explicitly limited to Schnorr for this local-dev bootstrap mode

We also stopped blindly forwarding the pre-derived signing key from the testing helper through that bootstrap path and let the embedded wallet derive what it needed in the correct runtime context.

## Why this fix is the correct one

This fix is better than just masking the error because it restores the intended separation between two different modes:

- local/dev bootstrap convenience
- fresh managed account creation

For local/dev bootstrap, the docs-supported move is to register or use the local test accounts already meant for that environment.

For fresh account creation, the docs-supported move is to create a new account and deploy it using the documented deployment semantics, not to improvise a mixed bootstrap/deployer flow.

## Validation

After the fix:

- the app rendered cleanly in the browser
- managed wallet creation completed successfully
- the status banner showed `Create managed embedded wallet completed.`
- a managed wallet session became visible in the UI
- browser console errors were cleared for this flow

The next Playwright failure after that was not an app bug. It was environmental:

- Playwright Chromium was not installed in the current environment
- the command required was `npx playwright install`

## Short summary

The error was not "just a bad value." It was the result of:

- mixed Aztec browser module identities caused by Vite packaging differences
- a managed-wallet bootstrap branch that had drifted away from the official Aztec local-network flow

The fix was to:

- align the Aztec browser packaging path in Vite
- keep the relevant Aztec modules on the same runtime graph
- simplify the managed bootstrap branch so it follows the documented local test account path

## Final lesson

For Aztec work, official docs are not optional background reading. They are part of the implementation boundary.

That is why your repeated instruction to always verify from official docs was important. In this case, it was not only about correctness after the fact. It was the thing that prevented us from treating a protocol-specific integration problem like a generic frontend bug hunt.
