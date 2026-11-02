# Proof-stack migration with unchanged login

The user authorized infrastructure/proof-tooling migration and required
Instagram and the current login implementation to keep working. The caution
about past login problems did not authorize login improvements. The assistant's
connector changes and associated new tests are removed; both files match
pre-continuation commit `3eb3d32`. Preserve the current branch and unrelated files.

## Approach

Use zkPassport's upstream BB6 migration instead of maintaining our own library fork. The candidate is circuits commit `b04153038a7ee9f80f4ae93fd1b9ea32eaf833e3`, version `0.22.0`, Noir `1.0.0-rc.3`, BB `6.0.0`. Establish that baseline before testing exact stable Noir `1.0.0`. A direct all-runtime version bump was rejected because Instagram's zkEmail dependencies do not compile with stable; keep its beta.5/BB 0.84 runtime isolated and functional. No dual-version application protocol or credential migration machinery is needed.

## Availability constraint discovered during execution

On 2026-11-01 the candidate's manifest endpoints returned 404. Its circuit root `0x0efa41b10bd6472a36da098fe5cef870bd583a94375ae4875f1e3719f7f6a73b` returned `false` from the published RootRegistry `0x1D0000020038d6E40E1d98e09fA1bb3A7DAA8B70` on mainnet block 26320491 and Sepolia block 12041574. Therefore activating this tuple would break official issuance/recovery. The published SDK 0.19.3 contains BB6 verification support, but does not establish circuit/root availability.

Add a reproducible read-only readiness check. Keep the active proof tuple working until official artifacts and trust roots are available. Do not inject candidate roots, fabricate proofs, weaken registry checks, or switch a default to an unavailable release. Validate the existing flows while the cutover is externally blocked; do not change login behavior.

## Exact stable compiler probe

A temporary source-only probe used the pinned PR170 libraries (including its
seven updated public dependency versions) and the V6 protocol hash dependency.
Noir `1.0.0+275d3ab1a5c916c6ea73e8d6b943f685f574500c` failed both `check` and
`compile` for production/development Passport and development Recovery: four
ambiguous `SaltedValue.get_hash` calls in upstream `utils/src/tests.nr`, lines
496, 512, 518 and 539. No local dependency fork, active artifact or runtime pin
was introduced. Upstream publication is therefore only one of the remaining
gates; stable source compilation and actual proof acceptance must pass too.

## Login preservation

Keep the existing `/authorize` interaction, wallet selection, passkey handling,
PXE/session broker and connector implementation unchanged. Regression checks
validate that implementation rather than adding login behavior.

## Acceptance

- Readiness is false for missing/mismatched artifacts, invalid roots or failed RPCs; only report ready when every required public check passes. No user identity data enters this check.
- Preserve the existing connector source/tests and login API. No popup, concurrency, timeout or session-handling redesign is in scope.
- Existing wallet broker, linked/independent Instagram login and passkey routing tests pass. Exercise the browser authorization handshake where available; distinguish it from a real hardware passkey/credential transaction.
- Keep Instagram compiler/runtime pins and circuit bytes unchanged; run its real private-fixture proof test without printing the email or handle.
- Run the workspace suite, compiler isolation, WASM routing and SDK consumer checks. Record exact unavailable acceptance gates rather than claiming a complete proof migration.
- After upstream readiness passes, update SDK/utils/registry and recursive proof parsers, compile and verify all wrapper profiles, regenerate artifact pins/VKs/EVM verifier, and use a fresh local deployment with updated configuration. Official mobile-generated proof acceptance is required before activating the new tuple. No remote deployment, publish or push is authorized.
