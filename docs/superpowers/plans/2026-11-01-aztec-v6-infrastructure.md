# Aztec V6 infrastructure migration

**Goal:** Upgrade Magna's existing network, contracts, wallet, applications and deployment infrastructure to Aztec 6.0.0. No new credential features or L1 credential export.
**Authority:** User approved updating current infrastructure after the V6 discussion. Existing credential design remains specified in docs/protocol-spec.md and docs/passport-recovery-v3-spec.md.

## Global Constraints

- Preserve private credential issuance, owner revocation, optional Instagram root attachment, standalone invalidation, and Recovery V3. No public wallet protection marker.
- Preserve three independent proof runtimes: network Aztec 6.0.0; Passport/recovery standalone bb.js 5.0.0 with Noir beta.22; Instagram bb.js 0.84.0 with Noir beta.5. Changes to proof formats, trusted keys or claim semantics require demonstrated compatibility, never incidental hoisting.
- Use official tagged V6 sources and migration notes. Network package namespace is @aztec-labs; proving packages follow actual published manifests. Upstream viem 2.57.1 matches the V6 SDK.
- Preserve exact Inbox message identity, destination, expected index, replay protection and inclusion checks. Fast Inbox removes the old two-checkpoint delay; it does not bypass inclusion.
- A fresh V6 network requires new deployments and accounts. Do not reset or overwrite existing V5 chain/wallet data, secrets or deployment manifests. Do not deploy remotely, push, merge or publish.
- Stay on feat/credential-linking-recovery. Leave user changes in .gitignore and docs/onboarding-gas-policy.md untouched. No gas-policy redesign.
- Run meaningful focused regressions for changed behavior; compile/codegen and package builds verify mechanical migrations. Report unavailable live tests honestly.

### Task 1: Migrate dependency, compiler and contract foundation

Own network dependency manifests/lockfile and import namespace migration throughout source/scripts, Aztec compiler helper, Nargo dependencies, contracts, generated bindings, and standalone compiler isolation. Inspect actual published V6 package exports rather than assuming one-to-one names. Install side-by-side toolchain 6.0.0; keep old proof compilers available explicitly. Use @aztec-labs/aztec.js 6.0.0 and compatible exact peer packages; preserve old bb/noir lanes. Replace aliased viem with 2.57.1. Use aztec-labs-eng/aztec-nr v6.0.0 for network circuits, compatible directories/interfaces from same release. Do not accidentally migrate standalone recursive wrappers to rc.3. Determine the proper V6 standard Token source rather than retaining a second Aztec dependency tree.

Compile every active Aztec contract and regenerate bindings with V6. Resolve compiler/API changes without weakening credential/root/recovery checks, custom account authentication or sponsor authorization. Adjust compiler selection so wrapper compile commands explicitly select their existing beta.22 compiler. Update source imports mechanically across packages to prepare Task 2, but leave behavioral TypeScript API changes to Task 2. Do not modify Docker/Fast Inbox behavior in this task.

Validate installed dependency graph and proof runtime isolation checks, contract compilation/codegen and focused issuer/sponsor/account Noir tests. Capture commands and actual outputs. Update golden vectors only when V6 protocol addresses/hashes actually change, and preserve independent Magna domain rules. Record any blocked compile requirements precisely. Self-review and commit exact owned files, excluding user changes. Write task report.

### Task 2: Adapt existing client, wallet and application flows

Consume Task 1 dependency/compiler/binding interfaces. Own TypeScript API adaptations in packages/apps/scripts and existing-flow tests, without Docker changes or Fast Inbox wait redesign (Task 3). Build all workspaces in dependency order and adapt actual V6 returnType/decoding, FactScope, account metadata, protocol imports, wallet/PXE/node interfaces and receipt semantics as required. Preserve cold-PXE WebAuthn signing-key note preparation, sender registration, source-free recovery, root version selection and no same-instance login downgrade.

Ensure new protocol/account addresses cannot silently reuse persisted V5 artifacts, manifests or wallet scopes. Use a minimal V6 browser-storage namespace so old records remain untouched. Bump the pre-1.0 SDK to 0.3.0 for its breaking network compatibility; the repository reference app uses this workspace SDK. Retain strict installed-package checks through the existing isolated local-tarball consumer harness; do not publish and do not claim registry V6 availability. Preserve three proof lanes, including browser WASM aliases. Add failing regression tests before meaningful changed behavior; use compilation for type-only changes. Run wallet, management, API, SDK, recovery protocol and WASM routing regressions, build e2e and apps. No new product features. Self-review, commit and report commands/results/limitations.

### Task 3: Migrate Fast Inbox and operational infrastructure

Own existing L1-to-L2 waits and portal integration, Docker/local clock infrastructure, network bootstrap/testnet validation/configuration, and current deployment documentation. Inspect exact tagged V6 Inbox and portal manager API/event source. Replace LAG/two-checkpoint assumptions in recovery, local Fee Juice funding, bootstrap/funding scripts and rights bridge tests with observed inclusion and existing expected-index/replay guards. Use failing regressions for changed wait behavior. Keep local clock helpers local only and audit source-locked patches against actual V6 internals; do not carry private V5 offsets blindly.

Pin azteclabs/aztec:6.0.0 to a verified digest where available; update Dockerfile and compose together, with explicit preserved standalone proof compilers. Use separate V6 local data/project identity and fail clearly on old deployment manifests. Keep trace-capable L1 RPC requirements visible in testnet config. Do not conflate 3600s sponsor registry delay with the existing 300s proof freshness limit.

Run configuration/unit tests, portal Solidity tests, all relevant builds/contracts/proof isolation checks. Attempt live local existing issuance/link/revoke/recovery/sponsorship/bridge smoke tests only if Docker/node and suitable fixtures are available. Do not reset old state or invent test evidence. Update active docs with exact versions, fresh deployment steps and explicit unverified gates. Self-review, commit and report.

## Verification and review

Each task receives a fresh scoped compliance/quality review. Final review covers the migration range from 9459f0a. Routine dependency installation is authorized; network/sandbox failures are investigated, not hidden. The final handoff must distinguish implemented compatibility from live network validation and must not claim successful deployment.
