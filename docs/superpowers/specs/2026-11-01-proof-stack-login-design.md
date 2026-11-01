# Proof stack migration and login continuity

The user approved a clean breaking proof-stack upgrade because Magna is not live. Instagram must remain usable throughout. Existing login, wallet selection, passkey and PXE session behavior must continue working without additional windows or prompts. This approval covers execution in the current `feat/credential-linking-recovery` checkout; preserve the user's `.gitignore` and onboarding-gas note.

## Approach

Use zkPassport's upstream BB6 migration instead of maintaining our own library fork. The candidate is circuits commit `b04153038a7ee9f80f4ae93fd1b9ea32eaf833e3`, version `0.22.0`, Noir `1.0.0-rc.3`, BB `6.0.0`. Establish that baseline before testing exact stable Noir `1.0.0`. A direct all-runtime version bump was rejected because Instagram's zkEmail dependencies do not compile with stable; keep its beta.5/BB 0.84 runtime isolated and functional. No dual-version application protocol or credential migration machinery is needed.

## Availability constraint discovered during execution

On 2026-11-01 the candidate's manifest endpoints returned 404. Its circuit root `0x0efa41b10bd6472a36da098fe5cef870bd583a94375ae4875f1e3719f7f6a73b` returned `false` from the published RootRegistry `0x1D0000020038d6E40E1d98e09fA1bb3A7DAA8B70` on mainnet block 26320491 and Sepolia block 12041574. Therefore activating this tuple would break official issuance/recovery. The published SDK 0.19.3 contains BB6 verification support, but does not establish circuit/root availability.

Add a reproducible read-only readiness check. Keep the active proof tuple working until official artifacts and trust roots are available. Do not inject candidate roots, fabricate proofs, weaken registry checks, or switch a default to an unavailable release. Complete independent login and regression work while the cutover is externally blocked.

## Login behavior

Keep the existing one-window `/authorize` interaction and selected-wallet session broker. Reserve that window during the initiating browser gesture, before asynchronous hashing; then attach the message handler and navigate it. Bind messages to that exact window as well as the wallet origin. A second request on the same connector must not open another window while the first is pending. Close owned windows and remove handlers/timers on cancellation, timeout, error and success; allow a clean retry. Preserve chain-bound receipt validation and wallet-side passkey ownership checks.

## Acceptance

- Readiness is false for missing/mismatched artifacts, invalid roots or failed RPCs; only report ready when every required public check passes. No user identity data enters this check.
- Connector regressions cover synchronous window reservation, one pending request, exact source/origin checks, one request per handshake, timeout/error cleanup, retry, and chain-bound successful response verification.
- Existing wallet broker, linked/independent Instagram login and passkey routing tests pass. Exercise the browser authorization handshake where available; distinguish it from a real hardware passkey/credential transaction.
- Keep Instagram compiler/runtime pins and circuit bytes unchanged; run its real private-fixture proof test without printing the email or handle.
- Run the workspace suite, compiler isolation, WASM routing and SDK consumer checks. Record exact unavailable acceptance gates rather than claiming a complete proof migration.
- After upstream readiness passes, update SDK/utils/registry and recursive proof parsers, compile and verify all wrapper profiles, regenerate artifact pins/VKs/EVM verifier, and use a fresh local deployment with updated configuration. Official mobile-generated proof acceptance is required before activating the new tuple. No remote deployment, publish or push is authorized.
