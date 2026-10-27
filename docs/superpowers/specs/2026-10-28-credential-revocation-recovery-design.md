# Credential linking, revocation and Passport recovery

Date: 2026-10-28. Status: implemented; contract/unit/build checks and source review passed. Live E2E and browser proving-time validation remain pending (see the implementation plan).

## Selected approach

Keep Passport issuance and Recovery V3. Add one private holder operation to link an independently issued credential to an existing Passport root, plus owner revocation and the existing lost-wallet UI repair. This replaces the earlier wallet-wide cutoff/activation design.

Passport root revocation protects **linked credentials only**. A credential never linked remains independent, even if its wallet also holds Passport. Linking is irreversible for that issued instance: the original standalone copy is invalidated. Reissuing the same Instagram handle as a new independent credential remains allowed and does not revoke other instances.

The user selected per-credential linking over wallet-wide enforcement. There is no new public or secret-keyed wallet marker, Passport activation transaction, one-root-per-wallet restriction, shared protection record, handle registry, external matching service or recovery backup. Gas/onboarding policy remains separate work.

## Product behavior

| Action | Result |
| --- | --- |
| Issue Passport | Existing rooted Passport A2 flow, usable without another activation |
| Issue Instagram independently | Existing API/proof flow; no Passport required |
| Link Instagram | Convert that instance to linked notes; preserve claims and expiry; invalidate its standalone copy |
| Add Passport later | Offer the same link operation for existing independent credentials |
| Revoke Instagram | Only that credential stops working |
| Revoke Passport root | Passport and all credentials attached to that root version stop working |
| Renew Passport authority | Linked Instagram keeps its own validity and expiry |
| Recover Passport | Recovery V3 restores Passport; old linked Instagram stays invalid and needs manual reissuance |
| Lose an independent-only wallet | No Passport fallback; credentials remain valid until their own revocation or expiry |

## 1. One private linking endpoint

Add `link_credential_to_root(hinted_credential, hinted_status, hinted_root_status)` to `contracts/magna-issuer/src/main.nr`. Initially support Instagram; reject Passport and unsupported credential types. Future independent adapters can reuse this operation when explicitly supported.

The contract authenticates genuine caller-owned notes against this issuer and the expected storage slots. Check the standalone credential/status claims and type, credential expiry, individual revocation, and both root-revocation markers. No Instagram handle, local claims witness, fresh email proof or API authorization is required: the existing issued notes establish the claims.

In one transaction:

1. Spend the standalone credential and status notes.
2. Emit the existing individual revocation nullifier for the old status. Spending alone is insufficient because today's standalone verifier proves historical note membership and checks this explicit kill switch.
3. Mint the existing `LinkedCredentialNote` and `LinkedStatusNote` to the same owner, preserving `claims_hash`, type and expiry, with the root binding below.

The contract enforces conversion of this instance, including raw direct/sponsored calls. It does not disable other independent credentials in the wallet. A failed transaction leaves the source usable; a successful link cannot fall back to its standalone source. Previously anchored proofs have the bounded timing limitation below.

### Bind the existing status to the root version

Recovery keeps `root_commitment` stable but rotates the root revocation secret. Checking only the commitment would allow old linked Instagram to pair with fresh root status if recovery later returns to the same wallet.

Proposed internal implementation: derive the linked Instagram status's existing `revocation_secret` as a domain-separated hash of `(root_revocation_secret, credential_type, claims_hash)`. During every linked Instagram verification, recompute that derivation from the authenticated supplied root status and require equality. The root secret stays private; no new note fields or public markers are needed. Passport's linked status generation remains unchanged.

This derivation separates individual credential secrets while binding them to the exact root version. Renewal leaves the root secret unchanged; recovery changes it, so old Instagram status cannot match the recovered root even at the same owner address. Ensure the replacement secret differs from the source standalone secret so the source kill switch cannot revoke the replacement.

Do not mint `LinkedRecoveryNote` for newly linked Instagram: it is independently reissued, not automatically recovered. The supported Instagram linked-creation path is this holder conversion. Reject Instagram in legacy orchestrator-only `register_linked_credential`, update the engine's legacy Instagram helper and fixtures to issue then link, and retain Passport uses. This avoids silently creating Instagram notes without the required version binding.

### Exact commitment duplicates

Current status pairing uses owner, claims hash and type. Prevent multiple interchangeable Instagram status pairs by contract uniqueness for `(owner, claims_hash, standalone-or-linked)` across corresponding mint paths. Use separate domains for standalone and linked so one conversion is possible. This prevents exact proof replay; it is not handle uniqueness. A fresh blind gives a new claims commitment and remains allowed.

## 2. Root and individual revocation

Add private owner operations for standalone status, linked status, and root status. Authenticate note owner, issuer, slot and membership. Individual operations reject Passport type; the Passport revoke action revokes its root.

Individual revoke emits the existing `MAGNA_REVOCATION_DS` kill switch. Root owner revoke uses the existing root secret/commitment with a new domain separator, distinct from Recovery V3's `MAGNA_ROOT_REVOCATION_DS`. Root-dependent verifiers, linking and authority refresh check both. Revoking first must not prevent later recovery: owner revoke never consumes `RootRecoveryNote`, and recovery emits its distinct existing root kill switch without duplicate-nullifier collision. Renewal cannot reactivate a revoked root.

Each linked proof checks its own credential expiry/revocation and the root kill switches. Revocation needs no transaction that enumerates child credentials. Keep Passport authority checks for Passport itself; remove `RootAuthorityNote` and its expiry/renewal dependency from Instagram-specific issuer and sponsor verification methods. Keep existing Ghost-linked revocation for retained Passport/legacy callers; do not reintroduce generic Ghost-only recovery.

## 3. Issuance, wallet routing and UI

Keep Passport A2 issuance, `/instagram/verify`, the blinded-handle circuit and its seven outputs. To request Passport protection for Instagram, use ordinary standalone issuance followed by the linking operation. With no selected live Passport root, issuance remains independent. When Passport is added later, discover independent Instagram and offer linking through the same operation.

Display independent or Passport-linked status per credential. A failed/unfinished link is an issued independent credential, not a protected one; offer retry without repeating proof generation or issuance. On retry, rediscover settled notes and chain state. Record success only after the linking transaction settles. Register the holder as a known sender for holder-authored linked notes. Existing handle witnesses remain valid because claims and expiry are unchanged.

Route login from the discovered standalone/linked mode across wallet engine, browser client, consumer login, management wallet-login and sponsor session methods. Linked Instagram hint discovery retrieves its credential/status by claims and its root status by root commitment, then selects the matching version using the secret derivation. Root discovery for Passport also selects a live candidate rather than assuming the first root-status note is current, which matters after recovery back to an earlier wallet. Do not look up Passport authority using Instagram claims or silently downgrade a revoked linked instance to standalone.

Preserve `StoredCredentialRef` modes and root metadata. Add chain-derived Instagram status for its own expiry/revocation and optional root revocation/version mismatch; extend Passport status for owner-root revocation. Add individual revoke and Passport-root revoke actions to existing cards. Public SDK requests, company sponsorship, rights consumption and session receipt formats stay intact.

## 4. Lost-wallet recovery entry

Keep the existing fresh Passport proof → Ethereum portal → canonical Inbox → Ghost `recover_root_v3` flow. It already mints the complete Passport note set. Add no activation step and no wallet-history cutoff.

Repair the management screen/handler so it can start without the old wallet session, saved credential reference or old local claims witness:

1. Create/open the destination passkey and use its existing session/deployment/funding support.
2. Prepare the destination/nonce/message-secret-bound request using the recovery screen's age threshold, default 18.
3. Derive root and Ghost from the fresh Passport result, then discover the Ghost's `RootRecoveryNote` directly.
4. Use the existing portal, Inbox wait and isolated transient Ghost finalization; no old holder key or API recovery authorization is required.
5. Build the destination Passport witness from fresh `localDisclosures(completion, ageThreshold)` and the artifact's new nationality/expiry blinds, not a spread of the lost witness. Make pending-finalization `sourceCredentialId` optional and retain reload/resume support.
6. Verify transaction success, destination notes and chain validity before showing completion. Restore Passport only; offer fresh Instagram issuance and optional linking afterward. Existing destination-owned independent Instagram can be linked separately.

Keep existing wrapper outputs, destination/deployment binding, portal ABI, replay protections and developer proof-profile boundaries. Production proof-profile graduation and payment-policy implementation remain separate.

## Revocation timing

Existing private non-inclusion checks establish state at the proof's anchor, not settlement. Proposed default: cap affected verification, linking and renewal transaction deadlines at the minimum of their existing deadlines and `anchor_timestamp + 300 seconds`. Test this against pinned Aztec 5.1 browser proving times before shipping. Recovery V3 transport/proof deadlines remain unchanged.

Old anchored transactions may settle within that window after revocation/linking. Fresh chain-status reads show settled revocation immediately; do not promise instant cancellation or publish a stable per-login tag to work around this constraint.

## Implementation boundaries and acceptance

Primary files: issuer entrypoints/revocation/constants helpers; Instagram sponsor forwarding; wallet `verification-engine.ts`, `browser/client.ts`, `browser/consumer-login.ts` and chain-state helpers; management `App.tsx`, storage, recovery and wallet-login helpers. Regenerate contract bindings and update affected fixtures/documentation. Keep existing note layouts, credential proof formats and Recovery V3 authorization. Use a fresh issuer deployment for contract changes; do not reset a chain or claim older contracts are patched in place.

Required verification:

- Authentic owned-note linking preserves claims/expiry, atomically kills the source, rejects revoked/expired/wrong-owner/forged-slot inputs, and resumes without duplicate issuance.
- Converted sources fail every standalone direct, sponsored and session route after the anchor window. Other never-linked credentials remain independent, including newly issued instances.
- Exact replay cannot produce interchangeable status notes; fresh-blind reissuance is allowed.
- Individual revoke leaves other credentials active. Root owner revoke blocks Passport and its linked credentials; fresh-proof recovery still works afterward.
- Linked Instagram rejects a recovered root version, including same-address recovery and recovery away then back; renewal or Passport authority expiry alone does not invalidate it. Legacy linked helpers cannot bypass the version check.
- Empty-browser recovery needs neither old passkey nor old claims witness, restores only Passport, uses fresh destination witness data and survives reload.
- Existing proof/portal/Inbox replay tests, company-paid login and SDK receipt verification continue to pass.

The user approved this design and authorized implementation. Track actual contract, wallet and UI verification separately from the design. The earlier secret-keyed-cutoff synthetic checks are not acceptance evidence for this simpler approach; fresh contract/E2E evidence is required for implementation claims.
