# Proof-Bound Recovery Authorization — Design

- **Date:** 2026-06-07
- **Status:** Draft for review
- **Area:** `magna-issuer` contract recovery, `magna-verification-api`, `magna-web` recovery flow, `@zkpassport/sdk` integration

## 1. Problem & threat model

Recovery of a rooted passport lineage is currently authorized by control of the **ghost account**. The ghost's private key is derived deterministically and *solely* from the zkPassport `uniqueIdentifier`:

- `seed = Poseidon(MAGNA_GHOST_DS, [uniqueIdentifier, credentialType])` — `packages/magna-client/src/ghost.ts:32`
- `rootCommitment = Poseidon(MAGNA_ROOT_DS, [uniqueIdentifier])` — `packages/magna-client/src/root.ts:16`

On-chain, `recover_root_for_caller` authorizes the owner change with a single check — "are you the ghost?" — and then hands the recovered lineage to a **caller-chosen** `new_active_owner`:

- `assert(hinted_root_recovery.owner == caller, ...)` — `contracts/magna-issuer/src/main.nr:1453`
- fresh root status + recovery notes minted to `new_active_owner` / caller — `main.nr:1480-1495`

**The vulnerability:** `uniqueIdentifier` is **not a secret**. By zkPassport's design it is a scoped identifier disclosed to every verifier; the holder re-derives it client-side; the Magna backend receives it in plaintext and itself reconstructs the ghost key material (`deriveGhostOwnerAddress`, `apps/magna-verification-api/src/service.ts:412-426`). Any party that learns a user's `uniqueIdentifier` — the backend, its logs/traces, a MITM, or an insider — can regenerate the ghost key, call recovery, and redirect the entire identity lineage to an attacker-controlled wallet. A single backend compromise exposes every user's recovery.

**Root cause:** a *disclosed* value is used as the *private-key seed* for the recovery authority. Knowledge of a public identifier must not be sufficient to recover.

This is a known constraint: there is currently no better passport-bound primitive available, and the zkPassport team has stated they are still working on replacing `uniqueIdentifier`. This design therefore treats `uniqueIdentifier` as **public** and moves authorization to a factor an attacker cannot reproduce.

## 2. Design principle

> Authorization to change a lineage's active owner must require proof of **live possession of the physical passport**, cryptographically **bound to the chosen destination address**. Knowledge of any derived/disclosed value must be insufficient.

An attacker holding only the `uniqueIdentifier` string cannot produce a fresh zkPassport proof (no document, chip, or biometrics). That live proof is the only factor that distinguishes the legitimate holder from an attacker, so it must gate recovery.

## 3. Goals / non-goals

**Goals**
- A third party who knows a user's `uniqueIdentifier` cannot recover/hijack their lineage.
- Recovery still works from any new device (the holder re-scans their passport).
- Reuse existing infrastructure: the orchestrator already verifies fresh proofs during a recovery preflight (`/zkpassport/verify-for-root-recovery`, `apps/magna-web/src/lib/zkpassport.ts:325-334`).

**Non-goals (this iteration)**
- Native, trustless on-chain verification of the zkPassport proof inside Aztec/Noir (see §9 — the SDK ships only an EVM/Solidity verifier; no Noir verifier exists).
- Removing the orchestrator from the issuance trust base.
- Changing the Instagram credential path or the verification (login) path.

## 4. Key capability check (resolved)

The `@zkpassport/sdk@0.15.1` query builder supports **binding arbitrary data into a proof**:

- `bind(key, value)` with `BoundData = { user_address?: string; chain?: SupportedChain; custom_data?: string }` (`@zkpassport/utils` `index-BvuBflCR.d.ts:639-643`; `bind` on the builder, sdk `index.d.ts:201`).
- Bound data is a **committed public input** (dedicated `bind` circuit; `getBindParameterCommitment`, `getBoundDataFromCommittedInputs`, `formatBoundData`), so a verifier can extract the bound `user_address` from the proof and reject any mismatch. A proof bound to owner A cannot be replayed to recover into owner B.
- On-chain verification is **EVM/Solidity only** (`getSolidityVerifierParameters`, `*_evm` circuits). There is no Noir verifier in the package, which is why trustless on-Aztec verification is out of scope here.

## 5. Architecture

Recovery stays **ghost-submitted** (the ghost remains the transaction sender, as today) but becomes **orchestrator-authorized**: the on-chain `recover_root` additionally requires a fresh, **destination-bound authorization witness** that the orchestrator issues only after verifying a live, destination-bound zkPassport proof.

```
Holder device                Orchestrator / verification-api          magna-issuer (Aztec)
-------------                ------------------------------          --------------------
1. fresh zkPassport proof
   bind("user_address",
        newActiveOwner)
   bind("custom_data",
        rootCommitment|nonce)
        |
        |  proof + newActiveOwner + rootCommitment
        v
                             2. sdk.verify(proof) -> { verified, uniqueIdentifier }
                                read bound data via QueryResult.bind /
                                  getBoundDataFromCommittedInputs
                                assert verified
                                assert boundData.user_address == newActiveOwner
                                assert boundData.custom_data carries rootCommitment + fresh nonce
                                assert deriveGhost(uniqueIdentifier) == root's ghost owner
                                |
                                |  issue private authwit (on_behalf_of = orchestrator)
                                |  over recover_root(hintedRootRecovery, newActiveOwner),
                                |  caller = ghost; return authwit to client
                                v
        ghost submits recover_root (msg_sender = ghost), carrying the authwit
        |
        v
                                                        3. assert(owner == caller)   // ghost
                                                           assert_current_call_valid_authwit(
                                                             context, orchestrator)
                                                           spend ghost root-recovery note
                                                           push kill-switch nullifier
                                                           re-mint fresh root status +
                                                             recovery note to newActiveOwner
```

### 5.1 Contract change (`magna-issuer`)

The ghost **must stay the transaction sender** — this is structural, not incidental. `recover_root_for_caller` asserts `hinted_root_recovery.owner == caller` where `caller = self.msg_sender()` (`main.nr:1453`); the spent `RootRecoveryNote` is owned by the ghost, so nullifying it needs the ghost's keys (`main.nr:1464`); and the re-armed `RootRecoveryNote` is minted back to `caller` (`main.nr:1493`). Making the orchestrator the sender would break all three. So instead of gating on the *sender*, gate on an orchestrator **authorization witness** over the call.

Add one new assertion to the `recover_root` path, alongside the existing `owner == caller` check:

- `assert_current_call_valid_authwit(&mut self.context, self.storage.orchestrator.read())` (aztec-nr `authwit`, `auth.nr:251`).
- Keep the existing owner check, note-spend, kill-switch nullifier (`compute_root_revocation_nullifier`), and self-rearm mint logic (`main.nr:1453-1495`) unchanged.

How the authwit binds the destination (verified against the pinned `v4.2.0-aztecnr-rc.2`):

- `assert_current_call_valid_authwit` reconstructs the current call as `inner_hash = compute_inner_authwit_hash([msg_sender = ghost, selector = recover_root, args_hash])`, where `args_hash = context.get_args_hash()` covers **all** `recover_root` arguments — including `new_active_owner` (`auth.nr:251-256`).
- It cross-calls the orchestrator's account contract (`verify_private_authwit(inner_hash)`, `auth.nr:271-285`) to confirm the orchestrator authorized *exactly* this `inner_hash`, then pushes a one-shot nullifier (`compute_authwit_nullifier(orchestrator, inner_hash)`, `auth.nr:284`) so the authorization can't be replayed.
- The full authorized message is `hash(consumer, chain_id, version, inner_hash)` (`auth.nr:29`), `consumer` = the issuer contract — so the authorization is scoped to this contract and chain.

Effect: an attacker who knows `uniqueIdentifier` can still derive the ghost key and satisfy `owner == caller`, but cannot make the orchestrator's account attest to an `inner_hash` carrying the attacker's `new_active_owner`. The orchestrator's signing key is independent of `uniqueIdentifier`, and it issues the authwit only after the backend's proof check (§5.2). Changing `new_active_owner` → different `args_hash` → different `inner_hash` → no matching authorization → revert.

> Note: `args_hash` covers every argument, including the `HintedNote<RootRecoveryNote>`. The orchestrator must build the authwit over the **exact** argument tuple the ghost will submit; see §10 Q1 for who assembles the canonical args. This also depends on the orchestrator being an Aztec account contract that implements the authwit interface — see §8.

### 5.2 Backend change (`magna-verification-api`)

Promote the existing recovery preflight from **advisory** to **authoritative**, and have it mint the authwit:

- `sdk.verify(proof)` returns `{ verified, uniqueIdentifier, uniqueIdentifierType, queryResultErrors }` — it does **not** return the bound data. Read the bound data separately from the `QueryResult` (`QueryResult.bind`) or via `getBoundDataFromCommittedInputs` (zkpassport utils), then assert **all** of:
  1. `verified === true`.
  2. `boundData.user_address === newActiveOwner` (destination the holder chose).
  3. `boundData.custom_data` encodes the target `rootCommitment` **and** a fresh nonce / not-before timestamp within an acceptance window (replay/staleness protection).
  4. `deriveGhostOwnerAddress(uniqueIdentifier, derivationVersion)` equals the ghost owner bound to the target root (same identity as the lineage being recovered).
- Only on success does the orchestrator **issue a private authwit** (`on_behalf_of = orchestrator`) over the `recover_root(hintedRootRecovery, newActiveOwner)` call with `caller = ghost`, and return it to the client. The client (the ghost) submits the on-chain transaction (§5.3).
- Continue logging only `uniqueIdentifierPresent: true`, never the raw value (existing pattern, `service.ts:80/98/115`).

### 5.3 Client change (`magna-web`)

- The recovery flow builds the fresh zkPassport request with `bind("user_address", newActiveOwner)` and `bind("custom_data", encode(rootCommitment, nonce))` in addition to the existing disclosures (`startPassportZkRequest`, `lib/zkpassport.ts:236-240`).
- The chosen `newActiveOwner` is the user's new device/account; it is selected on the device and embedded in the proof commitment. This prevents a **network/MITM attacker** (and an honest, merely-relaying orchestrator) from substituting a different destination, since any substitution invalidates the bind commitment the backend checks. It does **not** by itself constrain a *malicious* orchestrator — see §6.
- On success the client receives the orchestrator authwit and submits `recover_root(hintedRootRecovery, newActiveOwner)` as the ghost, attaching the authwit. The submitted args must match the tuple the orchestrator authorized (§5.1 note, §10 Q1).
- Post-recovery UX: keep the re-issue guidance already added (`isAwaitingReissue` guard in `App.tsx`), since recovery still restores only the minimal root status and the user must re-issue to restore verifiability.

## 6. Security analysis (honest scope)

**What this prevents (the reported vulnerability):**
A third party who knows a victim's public `uniqueIdentifier` can no longer recover their lineage. On-chain recovery is orchestrator-gated, and the orchestrator only acts after a fresh, destination-bound proof that requires the physical passport. The replay hole is closed by the `user_address` binding plus a nonce/timestamp.

**What this does NOT prevent (residual trust):**
Because the contract cannot natively verify the zkPassport proof, the on-chain `recover_root` *trusts the orchestrator* to have checked it before issuing the authwit. A **malicious orchestrator** could issue an authwit for an attacker-chosen `new_active_owner`. **This does not expand the existing trust base:** the orchestrator is already the *sole* gate on every `register_*` entry point (`main.nr:210/226/250/298`), so it can already register/issue a lineage to any destination it chooses, and it already derives every ghost key from `uniqueIdentifier` (`service.ts:412-426`). Recovery-gating adds no theft capability beyond what issuance trust already grants. Constraining the orchestrator itself requires on-chain proof verification (§9).

**Liveness tradeoff:**
Recovery now depends on the orchestrator being available and willing. This sacrifices the censorship-resistance of ghost-initiated recovery in exchange for unforgeability against the public-identifier attacker. Given `uniqueIdentifier` is public, this is a strict net security improvement.

## 7. Defense-in-depth (optional, recommended)

- **Auditable proof commitment (future):** the orchestrator publishes the proof (or its bind commitment) so the binding can be checked against the on-chain `new_active_owner` out-of-band using the EVM verifier — an optimistic/fraud-proof path toward constraining the orchestrator without a Noir verifier.

## 8. Error handling & edge cases

- **Stale/replayed proof:** rejected by the nonce/not-before window in `custom_data` (§5.2.3).
- **Wrong destination:** `boundData.user_address !== newActiveOwner` → reject before any on-chain action.
- **Identity mismatch:** proof's derived ghost owner ≠ root's ghost owner → reject.
- **Reload during post-recovery window:** the in-memory `recoveryStage` guard is lost on reload (known gap). Durable detection — "root_status exists but root_authority missing" — is recommended hardening and tracked separately.
- **SDK lacking bind at runtime:** binding is required; if unavailable the recovery request must fail closed (no fallback to the legacy unauthenticated path).
- **Missing/expired/replayed authwit:** `assert_current_call_valid_authwit` reverts if the orchestrator never authorized this exact call; the one-shot authwit nullifier (`auth.nr:284`) prevents re-use of a consumed authorization.
- **Argument mismatch:** if the args the ghost submits differ from what the orchestrator authorized (e.g. a different hinted note), `args_hash` differs → `inner_hash` differs → revert. The canonical args must be agreed (§10 Q1).
- **Orchestrator account capability (dependency):** authwit verification cross-calls `verify_private_authwit` on the orchestrator's account contract (`auth.nr:271-285`). This assumes the deployed orchestrator is an Aztec account contract implementing the authwit interface (standard account contracts do). Confirm the orchestrator account type before implementation.

## 9. Out of scope / future work

- **Native trustless verification on Aztec:** verifying the zkPassport proof inside the Noir contract (porting/recursing the EVM verifier) would remove orchestrator trust from recovery entirely. Large, uncertain effort; deferred.
- **Time-lock + veto window on active-owner changes:** a recovery takes effect after a delay during which the current active owner can cancel. Explicitly deferred — not in scope this iteration.
- **Replacing `uniqueIdentifier`:** dependent on upstream zkPassport work.
- **Instagram / login paths:** unchanged.

## 10. Open questions

1. **Canonical `recover_root` args / authwit assembly:** since `args_hash` covers all arguments (including the `HintedNote`), the orchestrator and client must agree on the exact tuple so the authwit matches. Does the backend reconstruct the hinted note from `(rootCommitment, ghostOwner)`, or does the client send the assembled args for the orchestrator to authorize?
2. **Exact `custom_data` encoding** for `rootCommitment` + nonce (field packing, max length).
3. **Authoritative endpoint shape:** extend `/zkpassport/verify-for-root-recovery` to also mint the authwit, or add a dedicated endpoint that returns it.
4. **Confirm orchestrator account type** supports private authwit issuance (§8 dependency).

Resolved during design:
- Recovery stays ghost-submitted; the orchestrator authorizes via authwit rather than sending the tx (§5.1, Finding 1).
- Time-lock/veto is out of scope this iteration (§9).
