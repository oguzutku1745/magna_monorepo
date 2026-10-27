# Credential Linking and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement approved per-credential Passport protection, owner revocation and lost-wallet Passport recovery.
**Architecture:** Keep existing Passport/Instagram issuance and note formats. Holder linking atomically spends/revokes a standalone instance and creates linked notes whose status secret binds the root version. Verify individual/root revocation and repair client/UI routing; restore only Passport in Recovery V3.
**Tech Stack:** Aztec/Noir 5.1.0, TypeScript, React/Vite, Vitest, Node >=24.12.0.
**Spec:** docs/superpowers/specs/2026-10-28-credential-revocation-recovery-design.md (approved by user).

## Global Constraints

- Passport root revocation protects linked credentials only; never-linked credentials remain independent.
- No cutoff/activation, new backup, handle uniqueness service, note-layout change, proof-output change, portal change or gas-policy redesign.
- Instagram credential type is 3; Passport is 1.
- Keep owner-root revocation distinct from Recovery V3 root revocation; owner revoke never spends RootRecoveryNote.
- Proposed anchor deadline is 300 seconds, capped by existing credential/authority/sponsor deadlines.
- Keep initial Passport API unchanged; generic Ghost-only recovery remains disabled.
- Preserve existing unrelated .gitignore and docs/onboarding-gas-policy.md changes. Work on codex/credential-linking-recovery; no push/deploy/reset.

## Review Focus

- Historical notes or forged issuer/storage-slot hints must not bypass linking/revocation.
- Cached standalone hints after link and old root hints after recovery must fail at contract level within the anchor bound.
- Recovery to the same wallet, or away and back, must not revive old linked Instagram.
- Missing local witnesses must not block revocation/linking or fresh-proof recovery entry.
- API/Ghost minting and company-sponsored session routing must not introduce a public wallet-protection lookup or claim independent credentials are protected.

### Task 1: Issuer, sponsor and contract tests

**Files:** contracts/magna-issuer/src/{main.nr,internal/constants.nr,internal/revocation.nr,test/*}; contracts/magna-company-sponsor/src/{main.nr,test/*}; packages/contracts-bindings/src/{MagnaIssuer.ts,MagnaCompanySponsor.ts}.
**Interfaces:** Produce private issuer link_credential_to_root(credential,status,root_status), revoke_credential(status), revoke_linked_credential_as_owner(status), revoke_root_as_owner(root_status). Linked Instagram verifier/sponsor signatures remove root_authority argument; all other request/session fields unchanged. Add a hinted-root selector by secret if necessary for multiple versions, documenting exact ABI for Task 2.
- [ ] Write and run failing contract tests for conversion preserving claims/expiry, source invalidation, wrong owner/slot/issuer, duplicate commitment, independent-vs-linked root revocation, authority expiry/renewal independence, root-version mismatch, owner revoke then V3 recovery and 300s deadlines.
- [ ] Implement using pinned 5.1 note/history APIs; authenticate hints against issuer and storage owner slots. Allocate distinct DS values for owner-root revoke, root-bound linked secret and exact Instagram standalone/linked issuance.
- [ ] Reject Instagram in legacy register_linked_credential; retain Passport. Root-bound Instagram secret derives from root secret/type/claims; do not mint LinkedRecoveryNote. Keep existing Passport generation.
- [ ] Run issuer and sponsor Noir suites; compile both; regenerate ONLY their bindings. Expected: suites/compilation pass and new signatures present.
- [ ] Commit contract/binding changes and report exact interfaces/test evidence; obtain task review.

### Task 2: Wallet lifecycle and routing

**Files:** packages/magna-wallet/src/{engine/verification-engine.ts,browser/client.ts,browser/credential-chain-state.ts,browser/consumer-login.ts,embedded/note-discovery.ts,index.ts} and corresponding tests; packages/e2e-tests/src/magna.e2e.spec.ts where legacy engine helper changes require fixtures.
**Interfaces:** Produce LinkedInstagramHints (root/credential/status, no authority), client fetchLinkedInstagramHints(rootCommitment,claimsHash), linkCredentialToRoot(claimsHash,rootCommitment): Promise<TxOutcome>, revokeCredential({mode,claimsHash,rootCommitment?}): Promise<TxOutcome>, revokeRoot(rootCommitment): Promise<TxOutcome>; chain-state Instagram reader with active/inactive/expired and precise revocation/version reasons. Consume Task 1 ABI/report.
- [ ] Write/run failing tests for standalone vs linked consumer login, root-version hint selection, new owner-root kill switch, revoked source discovery, missing witness management actions and company-sponsored receipts.
- [ ] Implement holder actions, self-sender synchronization, root version discovery (including live Passport root selection), root-derived Instagram status validation and chain state. Standalone credentials remain independent; revoked linked instances never downgrade.
- [ ] Update legacy registerLinkedInstagram to use standalone issue then holder link; tests/fixtures follow new contract lifecycle, not unsupported generic mint.
- [ ] Run wallet build/test and e2e TypeScript build. Expected: pass; no SDK request or receipt changes.
- [ ] Commit wallet changes and report exact management-facing interfaces; obtain task review.

### Task 3: Management linking, revocation and lost-wallet entry

**Files:** apps/magna-management/src/{App.tsx,App.recovery.spec.tsx,lib/storage.ts,lib/wallet-login.ts,lib/recovery-v3.ts} and relevant tests.
**Interfaces:** Consume Task 2 client actions; pending recovery sourceCredentialId becomes optional, existing persisted records remain readable.
- [ ] Write/run failing tests for link/revoke controls without claims witness, linked Instagram routing/status, independent credentials remaining usable, empty-browser recovery with no source credential/session and fresh destination claims witness.
- [ ] Add existing-card link/revoke actions and explicit independent/linked/revoked status; retry by rediscovery without repeating issuance. Offer link on Passport availability; no Passport activation.
- [ ] Refactor recovery to use destination session, fresh-derived Ghost/root and direct RootRecoveryNote lookup, not old metadata. Preserve portal/Inbox/authenticated Ghost flow and resumable finalization. Restore Passport only and build all witness fields from fresh disclosures.
- [ ] Run management test, lint and build. Expected: pass; existing wallet/login and recovery profile protections preserved.
- [ ] Commit UI/client integration and obtain task review.

### Task 4: Integration, documentation and final review

**Files:** affected contract/wallet/UI tests and docs/{protocol-spec.md,passport-recovery-v3-spec.md,integration-guide.md}; approved design/plan status.
- [ ] Run source-sensitive targeted suites, both Noir suites, wallet tests/build, management tests/build, API tests, e2e TypeScript build and SDK/receipt regressions. Fix actual integration failures with regressions.
- [ ] Exercise live local E2E when available without reset or external deployment. Record unavailable proof fixtures/network limitations explicitly; no unit-only claim of chain success.
- [ ] Update canonical lifecycle docs to state rootless recovery policy and new contract deployment requirement. Do not stage unrelated gas note/.gitignore.
- [ ] Obtain fresh whole-branch review, fix important findings with tests, verify final diff and commit. Leave feature branch reviewable; do not merge/push/deploy.
