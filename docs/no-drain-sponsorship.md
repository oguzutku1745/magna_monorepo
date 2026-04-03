# No-Drain Sponsorship + Rights Entitlements (Phase 1)

This document is the **source of truth** for Magna’s fee sponsorship and entitlement model:

- **Option A (existing):** no-drain fee sponsorship controls.
- **Option B (Phase 1 rollout):** L1 payment -> L2 rights credit, then rights consumption as a hard gate.

Fee sponsorship and rights are intentionally separate:

- **Fee sponsorship** limits who can pay gas and how much can be burned.
- **Rights entitlement** limits how many successful sponsored verifies a company is allowed to run.

## Threat model (what we prove)

- **Attacker goal A (revert-burn)**: make the platform sponsor pay fees for transactions that later revert in public
  execution.
- **Attacker goal B (valid spam)**: repeatedly call a valid sponsored `verify()` and make the platform sponsor pay
  unboundedly.

**Bounded loss objective** (per credential, per human if issuance enforces uniqueness off-chain):

- At most **5 sponsored verifies per 24h window**
- Each transaction bounded by the fee cap (`maxFeeCap`) enforced by the eventual fee-paying sponsor contract

This bound is currently **credential-scoped** for every supported family, including linked Instagram
credentials. Magna does not yet enforce a root-scoped or per-human sponsor quota onchain.

The renewable passport-authority work does not change that scope yet:

- linked verifies now also require a live rooted passport authority note
- passport expiry/refresh does not by itself introduce a root-scoped sponsor quota
- future work may still move sponsored linked flows to a root-scoped budget keyed by the stable `root_commitment`

## Feasible shape (structural allowlist)

Aztec lets the wallet nominate an external `feePayer`, but a standalone sponsor contract still cannot reliably inspect
arbitrary user app-call targets/selectors. Therefore, the enforceable on-chain allowlist is **structural**:

- The user tx is sent to `MagnaCompanySponsor.sponsored_verify(...)` with the sponsor gateway declared as the external
  `feePayer` up front.
- `MagnaCompanySponsor` then performs the only `set_as_fee_payer()` / `end_setup()` transition in the tx and forwards
  only to `MagnaIssuer.verify_sponsored(...)`.
- By construction, the sponsor is only ever paying for Magna’s issuer verify path.

## On-chain components in this repo

### 1) `MagnaIssuer` (core)

File: `contracts/magna-issuer/src/main.nr`

- **Private `verify(...)`** performs:
  - claims commitment binding (`claims_hash`)
  - policy checks via `magna-lib`
  - revocation nullifier non-inclusion
- **Public metering**:
  - always enqueues local issuer metering `_meter_verify()`
- **Sponsored mode detection**:
  - sponsored mode is active when `verify_meter_hook != 0` or the dedicated sponsor gateway calls `verify_sponsored(...)`
- **No-drain measures (sponsored mode)**:
  - **Rate-limit nullifier**: emits 1 of 5 nullifiers per 24h window (slot 0..4)
    - Domain sep: `MAGNA_SPONSOR_RL_DS`
    - Window size: `MAGNA_SPONSOR_RL_WINDOW_SECONDS = 86400`
    - Slots: `MAGNA_SPONSOR_RL_MAX_SLOTS_PER_WINDOW = 5`
  - **Private sponsor eligibility** (Option A):
    - `sponsored_credential_type_mask` is stored as `DelayedPublicMutable` and read in private during `verify()`
    - If configured (non-zero mask), `verify()` asserts the credential type bit is set **during proving**
    - This prevents “not sponsored” from becoming a later public revert

**Privacy note**: the public chain only sees the emitted nullifier values. Their preimage includes private note material
(`revocation_secret`, `claims_hash`) so observers cannot link them to a user or credential.

### 2) `MagnaVerifyMeterHook` (public metering hook)

File: `contracts/magna-verify-meter-hook/src/main.nr`

This contract is **not the fee-paying sponsor contract** in this repo. It is a policy/metering hook intended to be called by
`MagnaIssuer.verify()` via an enqueued public call.

Hardening rules:

- **issuer-only**: only the configured issuer address may call `meter_verify_or_revert`
- **meter-only**: `meter_verify_or_revert` must not gate sponsorship eligibility (no “type not sponsored” reverts)

Rationale: any public hook that can revert reintroduces a revert-burn surface.

### 3) `MagnaCompanySponsor` (external fee payer gateway)

File: `contracts/magna-company-sponsor/src/main.nr`

- The wallet must declare this contract as the external `feePayer` when sending a sponsored verify tx.
- The gateway computes a conservative fee upper bound from `self.context.gas_settings()` and rejects any tx above the
  configured `max_fee_cap` **before** ending setup.
- After the cap check passes, the gateway becomes the fee payer, ends setup, forwards into
  `MagnaIssuer.verify_sponsored(...)`, enqueues `MagnaCompanyRightsRegistry.consume_right(1)`, and then enqueues its
  own public meter increment.

### 4) `MagnaCompanyRightsRegistry` (L2 rights ledger)

File: `contracts/magna-company-rights-registry/src/main.nr`

- Canonical rights ledger keyed by sponsor contract address.
- `claim_l1_credit(...)` consumes L1->L2 Inbox messages and credits `remaining_verifies`.
- `consume_right(amount)` is called by the sponsor contract and hard-fails when rights are exhausted.
- `credit_from_l2_payment(...)` is now adapter-gated and only callable by `MagnaRightsPurchaseL2`.

### 5) `MagnaRightsPortal` (L1 payment rail)

File: `l1-contracts/magna-rights-portal/src/MagnaRightsPortal.sol`

- Accepts ERC20 stable payment on L1.
- Builds the canonical rights-credit content hash (`MGRC` schema).
- Sends the L1->L2 message through Aztec Inbox.
- Emits purchase metadata (`purchaseId`, `creditNonce`, `messageLeafIndex`) used by the claim flow.

### 6) `MagnaRightsPurchaseL2` (direct L2 top-up rail)

File: `contracts/magna-rights-purchase-l2/src/main.nr`

- Pulls public-balance Aztec token payment via `transfer_in_public(...)`.
- Requires public authwit from the payer for third-party token spend.
- Credits rights in `MagnaCompanyRightsRegistry` by sponsor address using a monotonic purchase id.
- Keeps payer identity separate from budget ownership (payer funds, sponsor consumes).

## How the no-drain properties are achieved

- **Revert-burn prevention**:
  - All sponsorship eligibility decisions that might reject a tx are enforced **in private** during `verify()`.
  - If ineligible, proving fails and **no tx is produced**, so nothing can be sponsored.
  - The public hook (`MagnaVerifyMeterHook.meter_verify_or_revert`) is **meter-only**, so it cannot revert for eligibility.

- **Valid-spam prevention (sponsored)**:
  - Each sponsored `verify()` emits one rate-limit nullifier for the current 24h window + chosen slot.
  - Attempting to reuse a slot in the same window creates a duplicate nullifier, which the protocol rejects.
  - Therefore, cost per credential per day is bounded by \(5 \times maxFeeCap\).

- **Entitlement gating (Phase 1 Option B)**:
  - Rights are purchased on L1 and credited on L2 via `claim_l1_credit(...)`.
  - Sponsored verify consumes exactly one right through a public enqueued call.
  - If rights are exhausted, `consume_right(1)` reverts and the sponsored transaction fails.
  - L1->L2 message consumption is replay-safe (nullifier-backed), so credits cannot be double-claimed.

## L1 purchase -> L2 claim flow

1. Company calls `MagnaRightsPortal.purchaseRights(...)` on Ethereum and pays.
2. Portal posts an Inbox message with canonical credit content hash.
3. After message inclusion on Aztec, company/operator calls `MagnaCompanyRightsRegistry.claim_l1_credit(...)`.
4. Registry credits `remaining_verifies` for the sponsor contract address.
5. Future sponsored verifies consume rights one-by-one.

## L2 direct top-up flow

1. Payer sets a public authwit allowing `MagnaRightsPurchaseL2` to call token `transfer_in_public(...)`.
2. Payer calls `MagnaRightsPurchaseL2.purchase_rights_public(...)`.
3. Adapter pulls stable tokens from payer to treasury.
4. Adapter calls `MagnaCompanyRightsRegistry.credit_from_l2_payment(...)`.
5. Registry credits `remaining_verifies` for the sponsor contract address.

## Operational notes

- **Sybil resistance (“one human ≈ one credential”)**:
  - enforced off-chain at issuance using zkPassport `uniqueIdentifier` (do not issue if already registered).
  - this avoids on-chain linkability via public registries.

- **Node version for contract tests**:
  - Some Aztec JS/PXE dependencies use modern JS built-ins (e.g. `Set.prototype.intersection`).
  - Contract tests are expected to run under **Node 24**.

