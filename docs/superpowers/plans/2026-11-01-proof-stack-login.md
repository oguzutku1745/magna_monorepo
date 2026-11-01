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
