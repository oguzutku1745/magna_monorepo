# Proof migration scope correction and status

**Goal:** Update proof/network tooling while preserving working Instagram and
login. The user's caution about past login problems requires the existing login
implementation to remain unchanged; it did not authorize connector improvements.

**Spec:** `docs/superpowers/specs/2026-11-01-proof-stack-login-design.md`.

## Preserved boundaries

- Stay on `feat/credential-linking-recovery`; preserve unrelated `.gitignore`
  and onboarding/gas-policy changes.
- Restore `connector.ts` and `connector.spec.ts` exactly from `3eb3d32`.
- Preserve wallet selection, authorization windows, passkey/PXE/session routing
  and the existing login API. No login redesign or extra features.
- Keep Instagram functional on its compatible isolated proof runtime.
- No push, publish, remote deployment or reset of existing chain/browser data.

## Retained readiness work

- [x] Add the read-only zkPassport candidate availability command and 13 tests.
- [x] Check official manifest/artifact endpoints and published registry roots.
- [x] Keep the working active tuple: candidate manifests returned 404 and its
  circuit root was invalid on both networks.

## Remove the unauthorized login work

- [x] Restore both connector files to the pre-continuation version.
- [x] Correct documentation that described login changes as approved work.
- [x] Run existing client, management/session-broker and reference/SDK consumer
  checks, and rebuild local SDK tarballs from the restored implementation.
- [x] Commit the restoration without rewriting history or touching user files.

## Remaining migration gate

Full stable-Noir/BB6 cutover remains blocked on official upstream availability,
then requires official mobile proof, recursive-wrapper/EVM and browser acceptance.
No active proof compiler, dependency or artifact pin changed in this continuation.
Historical test results for the removed login experiment are superseded.


## V6 acceptance continuation

Continue the already-authorized infrastructure migration with login unchanged.
Current upstream recheck: PR170 remains open at the same commit; both candidate
manifests returned 404 and both public roots invalid. No proof-tuple cutover is possible.

- [x] Run the existing V6 critical suite; issuer tests reproduce resolver failures
  (42 passed / 72 failed), rather than assuming historical V5 acceptance applies.
- [x] Trace the V6 default CPU-sized TXE pool and test supported `TXE_WORKERS=1`.
- [x] Bound the test runner's default to one TXE worker, preserve explicit caller
  overrides, and pass the full existing contract/proof acceptance suite.
- [x] Run the existing 25-case lifecycle suite on a disposable isolated network;
  fix only necessary V6 test/infrastructure compatibility, with failing cases first.
- [x] Verify login files still match `3eb3d32`, review any changes and record exact
  validation evidence and remaining external/manual acceptance gates.


Lifecycle evidence: the complete run passed 24/25 and found the last WebAuthn
fixture missing V6 metadata; the corrected last case passed in a fresh targeted
run (1 passed / 24 filtered). This is split acceptance. Its test-only helper now
matches the app's deploy-then-persist order and uses the existing signing-key
note discovery helper. No application/login source changed.

- [x] Run the remaining six native contract projects (60 Noir cases), completing
  fresh V6 coverage of all 183 network-contract tests.


Final evidence: six native groups passed 7+5+9+12+23+4=60; with issuer114 and
sponsor9 from critical, all183 network-contract Noir tests have fresh V6 results.
The critical suite also passed Recovery3 Noir/10 Solidity and real Instagram
proof generation/verification. Compiler isolation16 and E2E TypeScript passed.
Read-only final review found no actionable issue. Both connector files exactly
match3eb3d32; existing chain container IDs/start times/genesis unchanged, API and
both frontends HTTP200. No runtime refresh, deployment or data reset occurred.
External stable/mobile/hardware acceptance remains as recorded in the spec.
