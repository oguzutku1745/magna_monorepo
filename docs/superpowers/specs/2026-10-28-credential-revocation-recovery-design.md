# Credential revocation and Passport recovery design

Date: 2026-10-28. Status: draft for review. Product scope selected by the user; engineering choices below remain proposed until this design is accepted.

Validation update: the address-derived public cutoff is withdrawn. The private-keyed alternative below is supported by the pinned Aztec 5.1.0 primitives and code-flow review, but requires holder activation after issuance/recovery. It has not been implemented or tested as a Noir/network flow.

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

Do not derive a cutoff from the wallet address and public constants alone. That would allow anyone knowing the address to calculate its Passport-protection marker. Contract siloing does not hide a guessable preimage.

The proposed replacement uses the holder's issuer-scoped nullifier hiding key. In constrained private code, obtain the owner's address-bound public keys with `get_public_keys(owner)` and request `context.request_nhk_app(public_keys.npk_m_hash)`. Never accept an arbitrary caller-supplied secret or an unconstrained key hint. Aztec validates the key derivation through the kernel; the key is not sent to the API or exposed in a public call.

Add a private holder activation operation over an authenticated, caller-owned, unrevoked `RootStatusNote`. In one transaction it emits two separately domain-separated, contract-siloed nullifiers:

- A permanent wallet cutoff, derived from the holder key and owner address. Every standalone verification helper derives that same value privately and proves non-inclusion at its anchor.
- An activation marker derived from the holder key, owner address, root commitment and root revocation secret. Every rooted Passport/Instagram verification and holder attachment requires inclusion of this specific root-version marker. A wallet-wide cutoff alone is insufficient: it must not accidentally activate another root status minted to the same wallet.

Both markers are opaque without the holder key. Activation membership checks remain inside the private proof; do not expose either marker on each login through public function arguments, SDK receipts or API payloads. This removes the proposed public address-to-protection lookup, not the issuance API's existing knowledge of the owner or general network metadata.

This is not a drop-in change to `mint_root_notes`. Initial Passport issuance runs in the orchestrator's PXE; Recovery V3 runs in a separate Ghost PXE. Neither has the destination holder's key. Preserve those minting transactions and note layouts, then run mandatory activation in the destination holder's wallet. Passport is pending and cannot be verified before activation. Skipping activation therefore cannot produce a usable Passport alongside an unrestricted standalone route. Legacy orchestrator mint/refresh helpers may create notes but must not bypass the verification activation gate.

Apply the standalone check beneath direct, sponsored, consumer and session entrypoints, so raw contract calls cannot bypass the UI. Standalone Instagram issuance remains unchanged, including intermediate notes which must be linked after activation. Activation blocks all old standalone copies even if the holder deliberately omits conversion. Before activation, previously standalone Instagram remains standalone; the UI must not describe Passport protection as complete.

Cutoff uniqueness keeps the proposed one-activated-root-per-wallet rule. Recovery should preflight in the destination wallet that its private cutoff is absent. The existing Ghost recovery transaction cannot itself derive that cutoff: if raw calls target a previously protected wallet, it may mint notes, but fresh root activation must fail and all rooted verification must reject the unactivated version. Do not claim the Ghost mint itself rejects that destination. This prevents recovery back into an old protected wallet from reviving its old linked Instagram via fresh root status. A never-protected destination holding standalone Instagram remains allowed.

Renewal retains the same root status and activation; do not emit the cutoff again. Owner revocation and recovery retain their existing secret-based kill switches and need no old holder key. Recovery rotates the root secret, so the destination needs its own fresh activation before the recovered Passport becomes usable.

The supported Passport API remains rooted A2. Do not expose rootless Passport issuance as a way to bypass this protection rule. Low-level legacy helpers retained for tests or SDK compatibility must not create a usable Passport root without activating the cutoff.

### Validation evidence and limits

Reviewed `verifyAndIssuePassportA2` (orchestrator submission), issuer standalone/linked verification helpers, `mint_root_notes`, `recover_root_v3`/`recover_root_for_caller`, browser `recoverRootV3`, and management's isolated transient Ghost session. The issuer artifact reports Aztec 5.1.0 and embeds that version's source for constrained `get_public_keys`, `request_nhk_app` and historical nullifier non-inclusion, confirming these are available in this build rather than only in newer docs.

Seven synthetic checks passed using the installed Aztec 5.1 key-store/cryptography implementation, an in-memory storage adapter and explicit WASM backend: stable holder key, issuer scoping, missing holder key in an orchestrator-only store, missing destination key in a Ghost-only store, destination access without old holder access, wallet-address separation and root-secret-version separation. No real account material was used. These checks do not establish Noir compilation, kernel integration, membership enforcement, transaction timing or complete recovery success; those remain contract/E2E acceptance work. The native LMDB/backend attempts were blocked by the local sandbox, so the successful checks deliberately used in-memory storage and WASM.

References: [Aztec 5.1 private context source](https://github.com/AztecProtocol/aztec-packages/blob/v5.1.0/noir-projects/aztec-nr/aztec/src/context/private_context.nr), [private state](https://docs.aztec.network/developers/docs/foundational-topics/state_management).

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

Keep `/instagram/verify` and its proof payload unchanged. It verifies the local email proof and creates the existing standalone note. The holder wallet then derives its private cutoff locally and reads protection from chain state; do not add an address-based public protection query:

- No cutoff: issuance is complete as a standalone credential.
- Cutoff and live owned root: link the note and report success only after the linked transaction settles.
- Cutoff with a revoked or unavailable root: leave the credential blocked and show the root problem; never fall back to standalone verification.

After initial Passport minting, activate the selected root in the holder wallet, then discover all owned standalone Instagram notes and run the same attachment operation for each. The cutoff already prevents omitted notes or failed migrations from remaining a bypass. Show pending activation and unfinished attachments and resume them when the wallet opens. Each attachment is atomic; the entire wallet does not need one large migration transaction.

On retry, rediscover settled notes and revocation state before submitting. Do not request another Instagram proof or another API issuance merely because linking or its response failed. Register the holder as a known note sender as needed, since migrated notes are holder-authored rather than orchestrator-authored.

## Linked verification and wallet integration

For Instagram, reuse the linked credential/status and root-status checks, but remove the `RootAuthorityNote` argument and its expiry/revocation dependency from the Instagram-specific issuer and sponsor entrypoints. Instagram validity is its own credential status/expiry plus the root's two revocation markers.

Leave Passport verification's authority checks intact. Generalize Instagram hint discovery separately: retrieve the linked credential/status using its claims hash and the root status using its root commitment. Do not use the Instagram claims hash to locate Passport authority.

Update `packages/magna-wallet/src/engine/verification-engine.ts`, `browser/client.ts` and `browser/consumer-login.ts`, the sponsor forwarding methods, and management `lib/wallet-login.ts`. Route Instagram by its discovered standalone/linked mode. The public dApp request and receipt formats stay unchanged.

Preserve `StoredCredentialRef`'s current modes and optional `rootCommitment`; avoid replacing the metadata model. Add an Instagram chain-state reader for its individual revocation, optional root revocation, expiry and standalone cutoff. Extend the existing Passport reader for owner-root revocation. Chain state, not local storage or mere note presence, determines validity.

## Recovery without the lost wallet

Refactor the existing recovery handler and screen; do not build a second recovery protocol.

1. Allow entry from “I forgot my account” without an old session, credential reference or local claims witness.
2. Create/open the destination passkey and use that wallet/PXE as the working session. Keep existing deployment and developer funding mechanisms. Privately derive its cutoff there and check that it has no previous activation before requesting proof. No old wallet key is needed.
3. Prepare the existing destination/nonce/message-secret-bound Recovery V3 request. Use the screen's age threshold, default 18, rather than reading it from the lost credential.
4. From the fresh result, derive the authenticated root and Ghost locally. Discover `RootRecoveryNote` using that Ghost and root; do not require saved Ghost metadata or a comparison with an old browser reference.
5. Use the existing portal, Inbox wait and authenticated Ghost consumption. The Ghost recovery transaction creates the complete Passport note set and invalidates the old root. Then activate the fresh root version in the destination holder wallet, without importing that wallet's secrets into the Ghost PXE. Until this extra private transaction settles, the recovered Passport remains pending and unusable. Old-root credential checks reject the recovery nullifier within the defined verification window; source activation is never undone.
6. Build the destination's Passport claims witness from fresh `localDisclosures(completion, ageThreshold)` and the recovery artifact's new commitment blinds. Do not copy the old witness. Preserve the seven wrapper outputs and authorization encoding.
7. Keep resumable finalization and verify destination notes, transaction success and chain status before displaying completion. Make `sourceCredentialId` optional in pending metadata because no old reference is required.

Passport is the only automatically restored credential. Offer Instagram issuance afterward. If the destination already held standalone Instagram, run the same attachment/resume flow for those destination-owned credentials; do not copy Instagram from the lost source wallet.

The flow continues to require the existing supported Passport proof and chain dependencies. Source-wallet Fee Juice and signing access are not recovery prerequisites. Funding for the destination, Ghost and Ethereum transaction remains subject to the existing profile and is not a new subsidy feature.

## UI changes

Keep the existing pages. Add individual revoke actions to credential cards and a Passport-root revoke action which explains its effect on attached credentials. Revocation and attachment remain usable when local claim witnesses are missing, provided the owner can read the relevant status notes.

Show chain-derived states for Instagram as well as Passport: active, pending activation, revoked, expired, awaiting attachment, and unavailable protection. An Instagram-only wallet explains that Passport fallback is absent. Recovery completion is shown only after destination activation and says Passport was recovered and Instagram must be verified again; it never claims all credentials were restored. Activation adds a holder transaction to initial Passport issuance and recovery; its fee funding must use an available payer and cannot be assumed to come from the API/Ghost balance. Changes to the agreed subsidy policy remain separate work.

## Files and compatibility

The main edits are the issuer and its revocation/constants helpers, Instagram-specific sponsor forwarding, wallet engine/browser clients, management `App.tsx` and its storage/login helpers. Regenerate `packages/contracts-bindings` after ABI changes. Update the canonical protocol/recovery documentation and the stale lifecycle paragraph in `docs/onboarding-gas-policy.md`, without changing its economic policy.

No note layout, proof circuit, recovery wrapper output or portal ABI changes are planned. Existing issuer contracts are not retroactively patched by rebuilding artifacts: validate this release with a fresh local/test deployment. Credentials in older deployments are not silently migrated across issuer addresses. Do not reset any chain as part of design or review.

## Acceptance checks

Use contract tests for policy enforcement and client/UI tests for routing and recovery entry. The existing passing unit tests are a baseline, not proof of these new behaviors.

- Individual revocation works for standalone and linked Instagram, needs no handle witness, and leaves Passport/other credentials valid.
- Exact replay cannot create interchangeable status notes for the same owner and Instagram commitment in either mode; issuing the same handle with a fresh blind remains allowed.
- Owner-root revocation blocks Passport and linked Instagram, including sponsored login. Subsequent fresh-proof recovery succeeds, and renewal cannot revive the old root.
- A recovered root uses a fresh secret; old notes cannot use new root status in another owner. Previously protected destinations and a second root in the same wallet cannot activate or verify, even if an orchestrator/Ghost mint itself succeeds. Test the fresh root-version marker, not only the wallet cutoff.
- Initial/recovered Passport cannot verify before activation. Activation checks genuine owned note membership, key-to-owner binding and root revocation, and emits both markers atomically. Wrong-key hints, omitted activation, renewal and reloads cannot reset the cutoff. Proofs and session receipts do not publish stable protection markers.
- Instagram attachment preserves claims, expiry and local handle witnesses, uses a fresh revocation secret, and rejects wrong owners, wrong storage slots, revoked sources and revoked roots. Failed transactions leave their source notes intact.
- After Passport attachment, direct, sponsored, consumer and session standalone routes reject old copies after the defined anchor window. Test adversarial omission of migration, API issuance after cutoff, cached hints and old anchors; UI checks alone do not count.
- Linked Instagram still verifies when Passport authority has expired or been renewed, provided the root and Instagram credential are live. Passport's own authority checks remain enforced.
- Linking retries rediscover success without duplicate issuance; missing handle witnesses do not block attachment or revocation.
- In an empty browser with no old passkey, old local storage or old claims witness, a fresh Passport proof completes Recovery V3 using only the destination session. API downtime does not block the recovery authorization path.
- Destination claims/witnesses come from the fresh proof, resumable finalization survives reload, and no source Instagram note is reminted.
- Existing proof destination/deployment binding, portal authorization, Inbox replay tests, company sponsorship and SDK receipt verification continue to pass.

## Design decisions requiring review

The user selected the three targeted changes and excluded a shared protection record, external matching infrastructure, new backups and proof-system redesign. The address-derived public cutoff is withdrawn. The private alternative requires holder activation, two secret-keyed markers and root-version verification gates; this is a proposed integration choice, not an implemented behavior. Other proposed choices remain one activated Passport root per wallet address, separate owner-root revocation domain, exact commitment deduplication, a 300-second maximum verification anchor window, and holder-side attachment after existing API issuance. Implementation must not start until the revised design is accepted.
