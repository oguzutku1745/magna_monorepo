# Credential revocation and Passport recovery design

Date: 2026-10-28. Status: draft for review. Product scope selected by the user; engineering choices below remain proposed until this design is accepted.

Magna will retain its existing credential notes, proof adapters and Recovery V3 transport. A wallet owner can revoke Instagram alone or revoke the Passport root protecting its credentials. Passport recovery restores Passport and disables credentials attached to the old root; Instagram must be issued again manually.

## Scope and approaches

The selected approach extends the existing standalone and linked credential paths. The user rejected a shared wallet protection record and external private handle matching through an OPRF network or TEE. Those alternatives would add infrastructure or replace more of the existing lifecycle than this task requires.

This work covers owner revocation, optional Passport attachment for Instagram, wallet/login routing and recovery without the lost wallet. It does not change credential pricing, gas sponsorship, deployment subsidies, account signing keys, proof circuits, the Ethereum portal ABI or recovery authorization format. No Instagram handle registry or new recovery backup is introduced.

The supported implementation target remains the repository's existing developer proof profile. Production proof-profile graduation and production L1 payment integration are separate work. Existing profile and proof-bound recovery checks must remain intact.

## Required behavior

| Situation | Result |
| --- | --- |
| Instagram issued without Passport | Existing standalone credential path; the holder can revoke it |
| Instagram issued with Passport protection | Linked credential path; its own expiry and revocation apply, together with root revocation |
| Passport added after Instagram | Earlier Instagram credentials are converted to linked notes without changing claims or expiry; their standalone copies become unusable |
| Instagram revoked | Passport and other credentials remain valid |
| Passport root revoked | Every credential protected by that root version becomes unusable |
| Passport recovered after owner revocation | Recovery remains possible and creates fresh root status for the destination |
| Passport renewed | Instagram keeps its own credential and expiry |
| Wallet lost with Passport protection | Fresh Passport proof recovers Passport; old protected Instagram stays invalid |
| Wallet lost without Passport protection | Magna has no fallback revocation authority; old credentials expire normally |

These are credential-instance revocation rules. Issuing the same Instagram handle elsewhere does not automatically replace another credential. The current Instagram adapter continues to prove possession of its supported signed email; live account-control checks and email freshness policy are outside this design.

## Existing components to retain

- `contracts/magna-issuer/src/types/`: retain the existing credential, status, root and linked note formats.
- `packages/magna-instagram-proof`: retain the blinded handle commitment, circuit and seven public outputs.
- `packages/magna-passport-wrapper-proof`: retain Passport A2 and its owner/action/deployment bindings.
- `packages/magna-recovery-wrapper-proof`, `packages/magna-recovery-v3` and `contracts/magna-recovery-portal`: retain the fresh destination-bound proof, portal verification, canonical Inbox message and replay protection.
- `contracts/magna-company-sponsor` and the public SDK: retain company-paid verification, rights consumption and request-bound session receipts.

## Owner revocation

Add three private owner entrypoints to `contracts/magna-issuer/src/main.nr`:

| Entrypoint | Authority and effect |
| --- | --- |
| `revoke_credential(hinted_status)` | Prove a genuine caller-owned `StatusNote`, reject Passport type, emit the existing credential revocation nullifier |
| `revoke_linked_credential_as_owner(hinted_status)` | Prove a genuine caller-owned `LinkedStatusNote`, reject Passport type, emit the existing credential revocation nullifier |
| `revoke_root_as_owner(hinted_root_status)` | Prove a genuine caller-owned `RootStatusNote`, emit a separate owner-root revocation nullifier |

A supplied hint must be authenticated against this issuer and its expected storage slot, not accepted merely because its owner field matches. Root and linked status notes remain readable so chain-status inspection can explain why a credential was revoked. Repeating the same revocation is rejected by nullifier uniqueness; the UI recognizes an already revoked credential instead of offering the action again.

The owner-root nullifier uses the existing root secret and commitment with a new domain separator. It is distinct from `MAGNA_ROOT_REVOCATION_DS`, which Recovery V3 already emits. Every root-dependent verification and root-authority refresh checks both root nullifiers.

Owner revocation must never spend `RootRecoveryNote`. Recovery V3 can therefore consume its authenticated Inbox authorization, spend that recovery note, emit the existing recovery nullifier and mint fresh root status without colliding with owner revocation. The fresh root secret produces fresh revocation nullifiers. Passport renewal cannot reactivate an owner-revoked root.

Retain the current Ghost-linked revocation entrypoint where existing callers depend on it. Do not restore the retired generic Ghost-only recovery entrypoint.

### Exact issuance duplicates

The retained note formats pair credentials with status by owner, claims hash and type. Minting the exact same Instagram commitment twice would create interchangeable status notes: revoking one secret would leave the other usable. Prevent that ambiguity with contract nullifier uniqueness for each Instagram `(owner, claims_hash, standalone-or-linked)` mint. Enforce it in every corresponding mint helper, including legacy orchestrator helpers and owner attachment. Replaying the same API proof must not mint another status pair.

This is exact commitment deduplication, not Instagram-account uniqueness. Reissuing the same handle with a fresh blind produces a new commitment and remains allowed. Standalone and linked mints use separate domains so one conversion is allowed, but a second matching pair in either mode is not. No note fields or proof outputs change.

## Blocking the standalone route after Passport attachment

**Pending user decision:** the minimal cutoff below reveals that an address has activated Passport protection to observers who already know that wallet address. It does not reveal the Instagram handle or Passport claims. If that association must also remain private, this section must be revised before acceptance.

Use one permanent contract-siloed cutoff nullifier, derived from the wallet address under a new domain separator. This is an irreversible route cutoff, not a mutable wallet protection record or a handle identifier.

All supported root-creation paths activate this cutoff once when minting a wallet's first root status. Factor this into the existing root-note mint helper and apply it to Recovery V3's destination as well. Root-authority renewal does not emit it again.

Every standalone verification helper checks cutoff non-inclusion for the credential owner. Apply the check beneath direct, sponsored, consumer and session entrypoints, so raw contract calls cannot bypass the UI. Issuance may still create a standalone Instagram note as an intermediate step, but the credential cannot be verified from a protected wallet until linked.

Nullifier uniqueness also makes the minimal model one Passport root per wallet address. Recovery must target an address which has never activated Passport protection. This prevents old Instagram notes from reviving if the same root commitment is recovered back into a previously protected wallet. A destination with standalone Instagram but no prior Passport is allowed; its existing Instagram notes are linked after recovery.

The supported Passport API remains rooted A2. Do not expose rootless Passport issuance as a way to bypass this protection rule. Low-level legacy helpers retained for tests or SDK compatibility must not create a usable Passport root without activating the cutoff.

### Verification timing

The current issuer uses `assert_nullifier_did_not_exist_by` at the proof's anchor block. This proves historical absence, not absence at settlement. Checking a cutoff or revocation against an arbitrarily old anchor would leave a bypass.

Proposed engineering default: cap all affected credential verification transactions at the minimum of their existing deadlines and `anchor_timestamp + 300 seconds`, using the existing expiration-timestamp mechanism. This applies to standalone and linked verification through every gateway, and to attachment/authority-refresh operations relying on these historical non-inclusion checks. Root expiry and sponsorship limits may shorten the deadline further. The Recovery V3 proof and transport deadlines remain unchanged.

After a cutoff or revocation settles, older anchored proofs can settle only within that bounded window. New chain-status reads show the settled state immediately. The design does not claim instantaneous cancellation of transactions already proved against older state. Test the bound against the pinned Aztec 5.1.0 implementation and existing browser proving timings before shipping; do not silently widen it or expose a stable per-login public tag as a workaround.

## Instagram attachment using existing notes

Add a private holder operation `link_instagram_to_root(hinted_credential, hinted_status, hinted_root_status)`.

It authenticates this issuer's caller-owned standalone credential/status pair and a caller-owned live root status. It checks the Instagram type, matching claims/type, credential expiry, both root-revocation markers and absence of the credential's revocation marker.

In one transaction it spends the old standalone credential and status notes, emits their existing credential revocation nullifier, and mints an existing `LinkedCredentialNote` and `LinkedStatusNote` to the same owner. Preserve `claims_hash`, credential type and expiry. Generate a fresh linked revocation secret: reusing the old secret would revoke the replacement as well.

New independent Instagram attachments need no `LinkedRecoveryNote`, because they have no automatic recovery/remint operation. Existing linked recovery notes and older helper behavior can remain where used. Root protection comes from checking the Passport root, while individual revocation comes from the holder's linked status note.

Attachment requires no handle, handle blind or fresh Instagram proof: the authenticated source notes already establish issuance. Existing local handle witnesses remain usable because their claims commitment is unchanged.

### Issuance and retries

Keep `/instagram/verify` and its proof payload unchanged. It verifies the local email proof and creates the existing standalone note. The wallet then reads protection from chain state:

- No cutoff: issuance is complete as a standalone credential.
- Cutoff and live owned root: link the note and report success only after the linked transaction settles.
- Cutoff with a revoked or unavailable root: leave the credential blocked and show the root problem; never fall back to standalone verification.

After initial Passport issuance, discover all owned standalone Instagram notes and run the same attachment operation for each. The cutoff already prevents omitted notes or failed migrations from remaining a bypass. Show unfinished attachments and resume them when the wallet opens. Each attachment is atomic; the entire wallet does not need one large migration transaction.

On retry, rediscover settled notes and revocation state before submitting. Do not request another Instagram proof or another API issuance merely because linking or its response failed. Register the holder as a known note sender as needed, since migrated notes are holder-authored rather than orchestrator-authored.

## Linked verification and wallet integration

For Instagram, reuse the linked credential/status and root-status checks, but remove the `RootAuthorityNote` argument and its expiry/revocation dependency from the Instagram-specific issuer and sponsor entrypoints. Instagram validity is its own credential status/expiry plus the root's two revocation markers.

Leave Passport verification's authority checks intact. Generalize Instagram hint discovery separately: retrieve the linked credential/status using its claims hash and the root status using its root commitment. Do not use the Instagram claims hash to locate Passport authority.

Update `packages/magna-wallet/src/engine/verification-engine.ts`, `browser/client.ts` and `browser/consumer-login.ts`, the sponsor forwarding methods, and management `lib/wallet-login.ts`. Route Instagram by its discovered standalone/linked mode. The public dApp request and receipt formats stay unchanged.

Preserve `StoredCredentialRef`'s current modes and optional `rootCommitment`; avoid replacing the metadata model. Add an Instagram chain-state reader for its individual revocation, optional root revocation, expiry and standalone cutoff. Extend the existing Passport reader for owner-root revocation. Chain state, not local storage or mere note presence, determines validity.

## Recovery without the lost wallet

Refactor the existing recovery handler and screen; do not build a second recovery protocol.

1. Allow entry from “I forgot my account” without an old session, credential reference or local claims witness.
2. Create/open the destination passkey and use that wallet/PXE as the working session. Keep existing deployment and developer funding mechanisms. Check that the destination has no previous Passport cutoff before requesting proof.
3. Prepare the existing destination/nonce/message-secret-bound Recovery V3 request. Use the screen's age threshold, default 18, rather than reading it from the lost credential.
4. From the fresh result, derive the authenticated root and Ghost locally. Discover `RootRecoveryNote` using that Ghost and root; do not require saved Ghost metadata or a comparison with an old browser reference.
5. Use the existing portal, Inbox wait and authenticated Ghost consumption. The recovery transaction activates the destination cutoff and creates the complete Passport note set. Old-root credential checks reject the root's recovery nullifier within the defined verification window.
6. Build the destination's Passport claims witness from fresh `localDisclosures(completion, ageThreshold)` and the recovery artifact's new commitment blinds. Do not copy the old witness. Preserve the seven wrapper outputs and authorization encoding.
7. Keep resumable finalization and verify destination notes, transaction success and chain status before displaying completion. Make `sourceCredentialId` optional in pending metadata because no old reference is required.

Passport is the only automatically restored credential. Offer Instagram issuance afterward. If the destination already held standalone Instagram, run the same attachment/resume flow for those destination-owned credentials; do not copy Instagram from the lost source wallet.

The flow continues to require the existing supported Passport proof and chain dependencies. Source-wallet Fee Juice and signing access are not recovery prerequisites. Funding for the destination, Ghost and Ethereum transaction remains subject to the existing profile and is not a new subsidy feature.

## UI changes

Keep the existing pages. Add individual revoke actions to credential cards and a Passport-root revoke action which explains its effect on attached credentials. Revocation and attachment remain usable when local claim witnesses are missing, provided the owner can read the relevant status notes.

Show chain-derived states for Instagram as well as Passport: active, revoked, expired, awaiting attachment, and unavailable protection. An Instagram-only wallet explains that Passport fallback is absent. Recovery completion says Passport was recovered and Instagram must be verified again; it never claims all credentials were restored.

## Files and compatibility

The main edits are the issuer and its revocation/constants helpers, Instagram-specific sponsor forwarding, wallet engine/browser clients, management `App.tsx` and its storage/login helpers. Regenerate `packages/contracts-bindings` after ABI changes. Update the canonical protocol/recovery documentation and the stale lifecycle paragraph in `docs/onboarding-gas-policy.md`, without changing its economic policy.

No note layout, proof circuit, recovery wrapper output or portal ABI changes are planned. Existing issuer contracts are not retroactively patched by rebuilding artifacts: validate this release with a fresh local/test deployment. Credentials in older deployments are not silently migrated across issuer addresses. Do not reset any chain as part of design or review.

## Acceptance checks

Use contract tests for policy enforcement and client/UI tests for routing and recovery entry. The existing passing unit tests are a baseline, not proof of these new behaviors.

- Individual revocation works for standalone and linked Instagram, needs no handle witness, and leaves Passport/other credentials valid.
- Exact replay cannot create interchangeable status notes for the same owner and Instagram commitment in either mode; issuing the same handle with a fresh blind remains allowed.
- Owner-root revocation blocks Passport and linked Instagram, including sponsored login. Subsequent fresh-proof recovery succeeds, and renewal cannot revive the old root.
- A recovered root uses a fresh secret; old notes cannot use new root status in another owner. Previously protected recovery destinations and a second Passport root in the same wallet are rejected.
- Instagram attachment preserves claims, expiry and local handle witnesses, uses a fresh revocation secret, and rejects wrong owners, wrong storage slots, revoked sources and revoked roots. Failed transactions leave their source notes intact.
- After Passport attachment, direct, sponsored, consumer and session standalone routes reject old copies after the defined anchor window. Test adversarial omission of migration, API issuance after cutoff, cached hints and old anchors; UI checks alone do not count.
- Linked Instagram still verifies when Passport authority has expired or been renewed, provided the root and Instagram credential are live. Passport's own authority checks remain enforced.
- Linking retries rediscover success without duplicate issuance; missing handle witnesses do not block attachment or revocation.
- In an empty browser with no old passkey, old local storage or old claims witness, a fresh Passport proof completes Recovery V3 using only the destination session. API downtime does not block the recovery authorization path.
- Destination claims/witnesses come from the fresh proof, resumable finalization survives reload, and no source Instagram note is reminted.
- Existing proof destination/deployment binding, portal authorization, Inbox replay tests, company sponsorship and SDK receipt verification continue to pass.

## Design decisions requiring review

The user selected the three targeted changes and excluded a shared protection record, external matching infrastructure, new backups and proof-system redesign. Proposed engineering choices are the address-derived cutoff and its visibility, one Passport root per wallet address, separate owner-root revocation domain, exact commitment deduplication, a 300-second maximum verification anchor window, and holder-side attachment after existing API issuance. The public-cutoff privacy question is pending; implementation must not start until it is resolved and the design is accepted.
