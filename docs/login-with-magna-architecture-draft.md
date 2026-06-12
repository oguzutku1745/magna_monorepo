# Login with Magna - Architecture & SDK Design Draft

> Status: IMPLEMENTATION COMPLETE FOR PLAN SCOPE as of 2026-06-12, with production audit still required. Authored 2026-06-09; audit corrections applied 2026-06-10; audit re-verified against primary sources (repo, W3C WebAuthn L3, Noir/barretenberg source, aztec-packages v4.2.0-aztecnr-rc.2 tag, noir_webauthn v0.37.2 source) on 2026-06-10; implementation regression passed under Node 24 on 2026-06-12.
> This is an architecture specification plus implementation status note. It records the target design, the evidence gate that corrected earlier overclaims, and the concrete implementation boundaries that were built in the Login with Magna plan.

## 0. Settled Decisions

1. **Separate-wallet model.** "Login with Magna" works like "Sign in with Google": the dApp triggers a popup or redirect to a **Magna-owned origin** such as `wallet.magna.xyz`; the user authenticates there; only a privacy-preserving result returns to the dApp.
2. **The wallet is the trusted surface.** Passkey ceremonies, PXE, account control, private notes, and verification execution live under Magna's origin and are never embedded in the integrating dApp.
3. **Why not embed in each dApp.** WebAuthn credentials are scoped to a Relying Party ID. Unrelated third-party origins cannot create or use credentials for Magna's RP ID, and each dApp origin would otherwise fragment identity. A single Magna wallet origin also protects PXE data and matches Aztec's wallet model.
4. **Passkey key custody.** The current `credentialId`-derived JS signing key must be replaced. The target account uses a real WebAuthn P-256 credential whose private key remains inside the authenticator; the Aztec account contract verifies WebAuthn assertions.
5. **Thin dApp SDK.** The dApp-facing package is a connector only. Wallet machinery moves behind Magna's wallet surface and is not linked into third-party dApps.
6. **Trust model for v1.** The dApp trusts a Magna-signed session assertion for the login result. Independent on-chain receipt binding is deferred until a later `session_nonce` or receipt/event binding change.

---

## 1. Evidence Gate

This section records the audit result that must drive implementation. Claims are classified as `confirmed`, `incorrect`, `overstated`, `requires port/audit`, or `deferred`.

| Claim | Status | Evidence / implication |
|---|---:|---|
| Repo targets Aztec `4.2.0-aztecnr-rc.2`. | confirmed | `npm run aztec:version` returned `4.2.0-aztecnr-rc.2`; `@aztec/*` packages and `Nargo.toml` dependencies are pinned to the same release tag. |
| Noir has a native secp256r1 verifier. | confirmed | Official Noir docs expose `std::ecdsa_secp256r1::verify_signature(public_key_x, public_key_y, signature, message_hash) -> bool` with `[u8; 32]` key coordinates, `[u8; 64]` signature, and `[u8; 32]` message hash. |
| `noir_webauthn` does the whole WebAuthn account-verification job. | incorrect | Full source review of v0.37.2 (`src/lib.nr` is the entire library): it checks only (1) byte-equality of the base64url-encoded 32-byte challenge at a caller-supplied `challenge_index` (no JSON parsing) and (2) the P-256 signature over `sha256(authenticator_data \|\| sha256(client_data_json))`. It performs **no** validation of `clientDataJSON.type`, expected origin, `crossOrigin`, `authenticatorData.rpIdHash`, or UP/UV flags. |
| `noir_webauthn` can be used without review. | requires port/audit | `v0.37.2` is the latest tag. It is pre-1.0, has no published audit, depends on `noir_base64 v0.4.1` and `nodash v0.41.3`, its CI targets nargo `1.0.0-beta.4`/`1.0.0-beta.5`, and its repo makes no Aztec/aztec-nr compatibility statement. It must be ported/tested against Aztec `4.2.0-aztecnr-rc.2` before production use. |
| WebAuthn signs the raw Aztec payload hash directly. | incorrect | WebAuthn assertions sign `authenticatorData || SHA256(clientDataJSON)`. Noir's verifier expects a 32-byte hash, so the circuit must verify `SHA256(authenticatorData || SHA256(clientDataJSON))`. |
| WebAuthn ES256 signatures can be passed directly to Noir. | incorrect | Browser WebAuthn ES256 assertions are ASN.1/DER encoded (WebAuthn L3 §6.5.5 mandates ASN.1 DER `Ecdsa-Sig-Value` for ES256). Wallet witness code must decode DER to fixed 32-byte `r` and 32-byte `s`, normalize `s`, then pass `[u8; 64]` to Noir. |
| High-`s` WebAuthn signatures should be rejected by the wallet. | incorrect | Noir/barretenberg require BIP-0062 low-`s` (Noir stdlib doc comment; ACVM solver returns `false` on high-`s`; barretenberg circuit constrains `s < (n+1)/2`). But WebAuthn authenticators are not required to emit low-`s`, so roughly half of genuine assertions would be high-`s`. The wallet must **normalize** `s := n - s` (an equally valid ECDSA signature for the same message and key), not reject. |
| Popup/redirect is the right v1 transport. | confirmed | It keeps WebAuthn in a top-level Magna context and avoids relying on experimental cross-origin iframe permissions. |
| Cross-origin iframe WebAuthn is impossible. | overstated | It can work with `publickey-credentials-get/create` Permissions Policy, transient activation, and browser support caveats. It is not the v1 default. |
| Current passkey account already keeps private keys out of JS. | incorrect | `apps/magna-web/src/lib/wallet.ts` derives secp256r1 material from `credentialId` and calls `wallet.createECDSARAccount(...)` with a JS signing key. |
| Current `@magna/client` is already thin. | incorrect | `packages/magna-client` peers on `@aztec/aztec.js`, depends on `@aztec/foundation` and contract bindings, and calls issuer/sponsor contracts directly. |
| Current issuer supports many consumer gateways. | incorrect | `consumer_gateway` is a single `PublicImmutable<AztecAddress>` and `verify_consumer` checks equality with `msg_sender`. |
| `sync_state` should be manually called from app code. | incorrect | Aztec injects an unconstrained `sync_state` via the `#[aztec]` macro and PXE invokes it during note syncing. PXE actively forbids manual invocation (it throws ``Forbidden `sync_state` invocation``). `pxe.debug.sync()` lives on `PXEDebugUtils`, whose docstring says it "must not be used in production". The migration target is removing direct `pxe.debug.sync()` reliance, not calling `sync_state` manually. |
| Existing hint getters are safe to keep forever. | overstated | They are useful transitional utilities, but should be isolated behind wallet-internal note discovery code and not leak into the dApp connector surface. |
| On-chain receipt binding to a login request is required in v1. | deferred | A Magna-signed session assertion is sufficient for v1. Receipt binding can be added later by binding a session nonce into the verification path or emitted receipt. |

Primary sources: [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/), [Noir ECDSA docs](https://noir-lang.org/docs/noir/standard_library/cryptographic_primitives/ecdsa_sig_verification), [Aztec migration notes](https://docs.aztec.network/developers/docs/resources/migration_notes), [Aztec note discovery](https://docs.aztec.network/developers/docs/foundational-topics/advanced/storage/note_discovery), [Aztec wallets](https://docs.aztec.network/developers/docs/foundational-topics/wallets), [Aztec authwits](https://docs.aztec.network/developers/docs/foundational-topics/advanced/authwit), [`noir_webauthn` README](https://raw.githubusercontent.com/olehmisar/noir_webauthn/main/README.md), and [`noir_webauthn` source](https://raw.githubusercontent.com/olehmisar/noir_webauthn/v0.37.2/src/lib.nr).

---

## 2. System Topology

```text
+----------------------+         popup / redirect          +---------------------------------+
|  Integrating dApp     |  -- authorize(policy, nonce) -->  | Magna Wallet (wallet.magna.xyz)  |
|  any origin           |                                    | - WebAuthn passkey ceremony       |
|                       |                                    | - EmbeddedWallet + PXE             |
|  @magna/client        |  <-- signed result / receipt ---  | - WebAuthn Aztec account           |
|  no aztec.js          |       postMessage or redirect      | - verify execution + session sign  |
+----------------------+                                    +-----------------+---------------+
                                                                                | sponsored/gasless tx
                                                                                v
                                       Magna Issuer + Consumer Gateways + Company Sponsor + Rights Registry
                                       Verification API / Orchestrator
```

**Surfaces:**

- **Magna Wallet.** The only surface that touches passkeys, PXE, notes, account deployment, verification transactions, and recovery.
- **Integrating dApp.** Installs `@magna/client`, asks for a policy, receives `{ verified, assertion, receipt? }`, and gates UI.
- **Contracts + Verification API.** Existing issuer, sponsor, rights registry, and verification API are reused; issuer needs a multi-tenant consumer gateway change.

---

## 3. Package Topology

| Package | Consumer | Contents | Implementation status |
|---|---|---|---|
| `@magna/core` | connector and wallet | Pure policy builders, claims encoding, shared types, policy hash, session assertion types, nullifier/ghost math that has no wallet dependency | new extraction from today's thick client |
| `@magna/client` | third-party dApps | `login(policy)`, popup/redirect transport, request validation, session assertion verification, redirect-code exchange, no Aztec imports | replace current thick contract caller |
| `@magna/wallet` | Magna wallet surface only | EmbeddedWallet lifecycle, passkey registration/assertion, WebAuthn account integration, note discovery, verify execution, recovery, session assertion signing | extract from `apps/magna-web/src/lib/*` |
| `magna_lib` | Noir contracts | Policy primitives and claim matching | exists |
| `magna-webauthn-account` | wallet | Aztec account contract that verifies WebAuthn assertions over authwit payloads | new |
| `magna-webauthn` | account contract dependency | Controlled fork/vendor of `noir_webauthn` with Magna-required validations | new fork/vendor, not upstream-as-is |

`@magna/client` must not peer on `@aztec/aztec.js`, import contract bindings, or expose note hints. Current direct contract methods such as `loginWithMagna(...)` and `loginWithCompanySponsor(...)` move behind `@magna/wallet` or internal orchestration APIs.

---

## 4. Connector Protocol

**dApp side:**

```ts
const magna = new MagnaClient({
  clientId: "dapp_abc",
  walletOrigin: "https://wallet.magna.xyz",
  magnaPublicKey: "...",
});

const result = await magna.login({
  credentialType: "Passport",
  constraints: [ageGte(18), countryNeq("USA")],
});

if (result.verified) unlockApp();
```

**Request fields:**

- `clientId`: registered dApp identifier.
- `origin`: dApp origin observed by the client and checked by wallet against registration.
- `requestId`: random per-login ID.
- `sessionChallenge`: 32-byte random nonce generated by the dApp connector.
- `policy`: canonical policy object.
- `policyHash`: canonical hash computed in `@magna/core`.
- `responseMode`: `postMessage` for popup, `redirectCode` for redirect fallback.

**Response fields:**

- `verified`: boolean.
- `requestId` and `sessionChallenge`: must match request.
- `policyHash`: must match request.
- `clientId` and `origin`: must match registered dApp.
- `issuedAt` and `expiresAt`: short-lived session assertion window.
- `receipt`: optional Aztec tx hash or privacy-preserving receipt metadata.
- `signature`: Magna wallet/session signing key signature over the full response envelope.

**Transport decision.** Popup + `postMessage` is primary. Full-page redirect with a one-time code is fallback for popup-blocked and mobile contexts. Cross-origin iframe WebAuthn is not the v1 transport because it depends on Permissions Policy and uneven browser support.

**dApp trust model.** v1 trusts Magna's signed session assertion. The dApp does not learn user identifiers, claims, PXE state, note contents, passkey material, or Aztec account secrets. On-chain receipt verification is optional in v1 and not sufficient to bind a login unless a future `session_nonce` is included in the verification path.

---

## 5. WebAuthn Account Creation and Signing

### 5.1 Principle

The account must be controlled by a real WebAuthn assertion, not by a private key derived from a credential ID. The WebAuthn private key remains inside the authenticator. JavaScript can request an assertion, but it never receives or reconstructs the private key.

Current code to remove after replacement:

- `deriveValidSecp256r1PrivateKey(...)` in `apps/magna-web/src/lib/wallet.ts`
- `derivePasskeyAccountMaterial(...)` in `apps/magna-web/src/lib/wallet.ts`
- the `walletAuth: "passkey-derived"` path in `createPasskeyWalletSession(...)`
- `derivePasskeyDeterministicBytes(...)` as signing-key material in `apps/magna-web/src/lib/passkey.ts`

### 5.2 Registration

1. `wallet.magna.xyz` calls `navigator.credentials.create()` in a secure top-level context.
2. Creation options require ES256/P-256 (`alg: -7`) and user verification.
3. The wallet records:
   - credential ID
   - RP ID
   - expected origin
   - P-256 public key coordinates `x` and `y`
   - transports and authenticator metadata for UX only
4. The wallet deploys or registers `magna-webauthn-account` with the P-256 public key as its signing authorizer.
5. The account's protocol keys and PXE state remain under `@magna/wallet`; the dApp never sees them.

The public key extraction must use the registration response's public key material, not the credential ID. If relying on `AuthenticatorAttestationResponse.getPublicKey()` (returns DER SubjectPublicKeyInfo; supported since Chrome 85, Firefox 119, Safari 16), store the returned SPKI public key after parsing and validating the algorithm. Because the spec allows `getPublicKey()` to return `null`, a fallback that parses the attestation object's CBOR authenticator data to extract the COSE key is required, not optional.

### 5.3 Per-transaction assertion

1. Aztec wallet/account code computes the authwit outer hash `H` for the transaction or authorized action.
2. The wallet calls:

```ts
await navigator.credentials.get({
  publicKey: {
    challenge: H,
    rpId: "wallet.magna.xyz",
    userVerification: "required",
    allowCredentials: [{ type: "public-key", id: credentialIdBytes }],
  },
});
```

3. Browser returns `authenticatorData`, `clientDataJSON`, and `signature`.
4. Wallet witness code:
   - DER-decodes ES256 signature into `r` and `s`.
   - Left-pads `r` and `s` to 32 bytes each.
   - Rejects zero, overlong, negative, or malformed DER integers.
   - Normalizes high-`s` values to low-`s` (`s := n - s`) before building the witness. Noir/barretenberg enforce BIP-0062 low-`s` and authenticators are not required to emit low-`s`, so rejecting instead of normalizing would fail roughly half of genuine assertions.
   - Computes `challengeIndex` for the base64url challenge string in `clientDataJSON`.
   - Packages `authenticatorData`, `clientDataJSON`, `[u8; 64] signature`, `challenge`, and indexes as the auth witness.

### 5.4 Noir verification

The account contract must not verify a raw Aztec hash directly. It verifies the WebAuthn-wrapped assertion:

```noir
let client_data_hash = sha256(client_data_json);
let webauthn_payload = concat(authenticator_data, client_data_hash);
let message_hash = sha256(webauthn_payload);

assert(contains_challenge(client_data_json, expected_challenge, challenge_index));
assert(client_data_type_is_get(client_data_json, type_index));
assert(client_data_origin_is_expected(client_data_json, origin_index));
assert(client_data_cross_origin_is_false(client_data_json, cross_origin_index));
assert(authenticator_rp_id_hash_matches(authenticator_data, expected_rp_id_hash));
assert(authenticator_user_present(authenticator_data));
assert(authenticator_user_verified(authenticator_data));

std::ecdsa_secp256r1::verify_signature(
  public_key_x,
  public_key_y,
  signature,
  message_hash,
)
```

`noir_webauthn` v0.37.2 can seed this implementation, but it is not sufficient as-is. Its entire public API is one function: `verify_signature(public_key_x: [u8; 32], public_key_y: [u8; 32], signature: [u8; 64], client_data_json: BoundedVec<u8, N>, authenticator_data: BoundedVec<u8, M>, challenge: [u8; 32], challenge_index: u32) -> bool` (challenge fixed at 32 bytes, encoding to 43 base64url chars; suggested bounds `BoundedVec<u8, 256>` / `BoundedVec<u8, 64>`). The Magna fork/vendor must add at least:

- explicit `webauthn.get` type check
- expected origin check
- `crossOrigin == false` check for the hosted wallet flow
- RP ID hash check against `SHA256("wallet.magna.xyz")`
- UP and UV flag checks
- fixed-size parsing/index discipline for challenge, type, origin, and cross-origin fields
- regression tests against malformed client data and authenticator data

### 5.5 Account Contract Boundaries

Create `contracts/magna-webauthn-account` modeled on `ecdsa_r_account_contract` from aztec-packages `v4.2.0-aztecnr-rc.2` (verified current pattern: `#[external("private")]` attributes, `entrypoint(app_payload, fee_payment_method, cancellable)` delegating to `AccountActions::init(context, is_valid_impl)`, `verify_private_authwit(inner_hash) -> Field` returning `IS_VALID_SELECTOR` (`0x47dacd73`) via `AccountActions`, and `is_valid_impl` as a `#[contract_library_method]` returning `bool` that reads the witness with `get_auth_witness(outer_hash)`), with:

- `Nargo.toml` pinned to Aztec `v4.2.0-aztecnr-rc.2`
- a dependency on the controlled WebAuthn verifier fork/vendor
- public-key storage for P-256 `x` and `y` as a `SinglePrivateImmutable` note (the pattern `ecdsa_r_account_contract` uses for `EcdsaPublicKeyNote`)
- account entrypoint and `verify_private_authwit` following the patterns above
- `is_valid_impl(context, outer_hash)` that loads the WebAuthn witness, validates the WebAuthn envelope, and verifies the P-256 signature
- tests for success, wrong challenge, wrong origin, wrong RP ID hash, wrong type, missing UP, missing UV, malformed witness, and wrong public key


---

## 6. PXE, Storage, and Note Discovery

`@magna/wallet` owns the EmbeddedWallet and PXE. It should use persistent storage under the Magna wallet origin so one Magna identity works across dApps.

Correct note-discovery target:

- Use supported wallet/PXE syncing behavior and `wallet.registerSender(...)` for known senders.
- Do not call `sync_state` manually from application code. It is macro-injected by Aztec, invoked by PXE during note syncing, and PXE throws on manual invocation.
- Remove direct production reliance on `pxe.debug.sync()` where supported APIs can replace it.
- Keep issuer hint getters as wallet-internal transitional helpers only where Aztec `4.2.0-aztecnr-rc.2` still needs them.
- Do not expose hinted notes, PXE sync controls, note contents, or sender registration to `@magna/client`.

Required wallet internal APIs:

- `registerKnownIssuerSender(orchestratorAddress)`
- `syncPrivateStateForIssuer(issuerAddress, ownerAddress)`
- `findCredentialHints(policyHashOrClaimsHash)`
- `runVerification(policy, hints, sponsorContext)`
- `recoverOntoNewDevice(recoveryInputs)`

---

## 7. Sponsorship and dApp-paid Metering

The on-chain primitives mostly exist, but the consumer gateway is currently single-tenant.

Current state:

- `magna-consumer.login_with_magna(...)` calls `MagnaIssuer.verify_consumer(...)` and increments `gated_login_count`.
- `MagnaIssuer.verify_consumer(...)` currently reads one `consumer_gateway` and asserts `self.msg_sender() == gateway`.
- Company sponsor gateways already use a map/disable-map pattern.

Target issuer change:

- Replace `consumer_gateway: PublicImmutable<AztecAddress>` with:
  - `consumer_gateways: Map<AztecAddress, PublicImmutable<bool>, Context>`
  - `disabled_consumer_gateways: Map<AztecAddress, DelayedPublicMutable<bool, DELAY, Context>, Context>`
- Add `add_consumer_gateway(gateway)`.
- Add `remove_consumer_gateway(gateway)`.
- Add `is_consumer_gateway(gateway) -> bool`.
- Update `verify_consumer` to assert `is_consumer_gateway(self.msg_sender())`.
- Because this is pre-launch, prefer replacing `initialize_consumer_gateway` cleanly rather than layering backwards-compatible shims.

Connector wiring:

- `clientId` resolves server-side or wallet-side to a registered gateway address and allowed dApp origin.
- Wallet executes verification through the dApp's registered consumer gateway for metering.
- Company sponsor and rights registry remain the gasless/payment path.

---

## 8. Recovery and Multi-device

V1 keeps the decided recovery-only model:

- A passkey account represents one active device at a time.
- New-device flow reuses existing recovery: derive/discover recovery state, kill-switch old account path, and mint/register onto the new device's passkey account.
- Do not add multi-passkey linking for v1. It expands the attack surface and creates unclear proof-of-legitimate-device ownership.

The recovery path must move behind `@magna/wallet`; `@magna/client` only receives a login result.

---

## 9. Security Model

- **Origin isolation:** third-party dApp JavaScript cannot access keys, PXE, notes, hints, or wallet internals.
- **RP ID scoping:** passkey credentials are scoped to Magna's RP ID. Unrelated dApp origins cannot exercise Magna credentials.
- **WebAuthn envelope validation:** account contract validates challenge, type, origin, RP ID hash, `crossOrigin`, UP, and UV before signature verification.
- **Witness format discipline:** wallet rejects malformed DER and only sends normalized fixed-width `r || s` signatures into Noir.
- **Session replay protection:** `requestId` and `sessionChallenge` are single-use and included in the Magna-signed response envelope.
- **Transport hardening:** wallet posts only to the registered dApp origin; dApp accepts only from configured `walletOrigin`.
- **Data minimization:** dApp receives `verified`, assertion metadata, and optional receipt metadata. It receives no claims, notes, public key material, account secrets, or user identifier.
- **Deferred receipt binding:** independent on-chain receipt verification requires a future session nonce or receipt/event binding and is not a v1 security requirement.


---

## 10. Implementation Workstreams

### Workstream A - WebAuthn Account

1. Fork/vendor `noir_webauthn` v0.37.2.
2. Port it to the repo's Aztec/Noir toolchain.
3. Add missing WebAuthn validation checks.
4. Create `contracts/magna-webauthn-account`.
5. Add account contract tests and fixtures.
6. Add TS witness fixture generation for DER decoding and challenge indexes.
7. Replace credential-derived signing path in Magna wallet.

### Workstream B - SDK/package Split

1. Create `@magna/core` for pure policy/types/session assertion code.
2. Replace `@magna/client` with popup/redirect connector behavior.
3. Remove Aztec dependencies from `@magna/client`.
4. Extract wallet engine code into `@magna/wallet`.
5. Keep current `apps/magna-web` as a consumer of `@magna/wallet`.

### Workstream C - Gateway Multi-tenancy

1. Update issuer storage and public methods.
2. Update generated bindings.
3. Update bootstrap scripts from `initialize_consumer_gateway` to `add_consumer_gateway`.
4. Update issuer and e2e tests.
5. Confirm many registered dApps can verify through different consumer gateways.

### Workstream D - Note Discovery Cleanup

1. Inventory every `pxe.debug.sync()` call.
2. Replace with supported wallet/PXE sync flows where available.
3. Keep hint getters behind `@magna/wallet` only.
4. Add tests that dApp connector cannot access hints, notes, or sync controls.

### Workstream E - Session Assertion and Connector

1. Define canonical session assertion envelope in `@magna/core`.
2. Implement wallet-side signing.
3. Implement dApp-side signature verification.
4. Add popup `postMessage` and redirect-code fallback.
5. Add origin, challenge, request ID, policy hash, expiration, and replay tests.

---

## 11. Verification Plan

**Contract tests:**

- `npm run test:contracts:issuer`
- `npm run test:contracts:company-sponsor`
- `npm run test:contracts:company-rights-registry`
- new `npm run test:contracts:webauthn-account`
- focused multi-tenant gateway tests for allow, remove, disabled gateway, and multiple dApps
- WebAuthn account negative tests for challenge, origin, RP ID hash, type, UP, UV, signature, and public key failures

**TypeScript tests:**

- fixed WebAuthn fixtures for DER-to-`r || s` decoding
- malformed DER rejection
- high-`s` normalization to low-`s` (`s := n - s`), with fixtures covering both low-`s` and high-`s` authenticator outputs
- session assertion signing/verification
- `@magna/client` dependency/import test proving no `@aztec/*`
- popup/redirect validation tests for wrong origin, wrong `requestId`, wrong `sessionChallenge`, wrong `policyHash`, expired assertion, and unknown `clientId`

**Integration tests:**

- existing `login_with_magna` e2e path
- company sponsor metering and rights consumption
- note discovery with registered sender
- recovery onto new passkey device
- local deploy bootstrap with multiple consumer gateways

**Final regression:**

- `npm run test:ci` after contract and package updates
- Node 24 environment for Aztec test suite
- generated bindings refreshed and checked in after contract ABI changes

---

## 12. Migration

The current draft assumes no live user migration is needed. If that remains true, hard-cut:

- remove `credentialId`-derived account creation
- do not preserve old passkey-derived accounts
- regenerate test/demo accounts using the new WebAuthn account path

If live users exist before this ships, this section must be reopened. A live migration would require account recovery or re-enrollment, because a credential-ID-derived JS private key cannot be transformed into an authenticator-held WebAuthn private key.

---

## 13. Open Decisions

**Resolved for v1:**

- Hosted web wallet at `wallet.magna.xyz`.
- Popup + `postMessage` primary; redirect fallback.
- Magna-signed session assertion trust model.
- On-chain receipt binding deferred.
- Recovery-only multi-device UX.
- Multi-tenant consumer gateway required.
- `@magna/client` must be thin and Aztec-free.

**Must be completed before implementation is considered production-ready:**

- [~] Controlled `noir_webauthn` fork/vendor ported and covered by Magna regression tests. External production security audit remains required before launch.
- [x] WebAuthn account contract implemented and tested (`contracts/magna-webauthn-account`, `npm run test:contracts:webauthn-account`).
- [x] Wallet witness encoding validated against generated WebAuthn fixtures and malformed DER/high-`s` cases (`@magna/wallet` WebAuthn tests plus `npm run test:contracts:webauthn`).
- [x] Current credential-derived JS signing path removed; the old `createPasskeyWalletSession` path and credential-ID-derived signing material are gone.
- [x] `pxe.debug.sync()` reliance isolated behind wallet-internal compatibility/test/local helpers and not exported through the dApp connector surface.

---

## 14. Overall Success Criteria

- A third-party dApp integrates in about three steps using only `@magna/client`.
- `@magna/client` has no Aztec, PXE, passkey, note, or contract-binding dependency.
- The user authenticates via a passkey whose private key never enters JavaScript.
- The Aztec account contract verifies real WebAuthn assertions with challenge, origin, RP, and flag checks.
- One Magna identity works across multiple dApps through the Magna RP ID and hosted wallet origin.
- The dApp never receives keys, notes, hints, claims, PXE data, or user identifiers.
- Verify is gasless for the user and metered to the dApp through registered consumer gateways and sponsor rights.
- Existing contract test suite stays green on Node 24 and Aztec `4.2.0-aztecnr-rc.2`.
- New WebAuthn account, connector, and gateway tests cover the failure cases listed above.
