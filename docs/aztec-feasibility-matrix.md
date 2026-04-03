# Aztec Feasibility Matrix (v1)

This matrix records each Magna v1 Aztec-dependent assumption and its evidence.

| Component | Magna assumption | Evidence |
| --- | --- | --- |
| PXE execution | Private proving is client-side, private inputs remain local | https://docs.aztec.network/developers/docs/concepts/pxe |
| Private/public sequencing | Private execution can enqueue public calls; failures can revert whole tx | https://docs.aztec.network/developers/docs/foundational-topics/call_types |
| Notes/nullifiers | Private state modeled as notes + nullifiers | https://docs.aztec.network/developers/docs/foundational-topics/state_management |
| Sender-for-tags | Discovery tags depend on tx-origin sender-for-tags | https://docs.aztec.network/developers/docs/aztec-nr/framework-description/note_delivery |
| Nullifier non-inclusion | `assert_nullifier_did_not_exist_by` historical proof support | https://docs.aztec.network/developers/docs/guides/smart_contracts/advanced/how_to_prove_history |
| Deterministic account recreation | Account creation from secret/salt via aztec.js APIs | https://docs.aztec.network/developers/docs/aztec-js/how_to_create_account |
| Signing key rotation boundary | Signing keys rotatable by account contract implementation | https://docs.aztec.network/developers/docs/concepts/accounts/keys |
| Wallet recovery capability | Wallet should expose signing key rotation/recovery when supported | https://docs.aztec.network/developers/docs/concepts/wallets |
| Fee sponsorship | Sponsored fee-payment and custom fee-payment models supported | https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees |
| Oracle model | Oracles are unconstrained, user/PXE-injected and must be constrained | https://docs.aztec.network/developers/docs/aztec-nr/framework-description/advanced/protocol_oracles |

## Source-backed implementation notes

- `random()` oracle module exists in aztec-nr source (`random.nr`) and is unconstrained randomness suitable for note blinding:
  - https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v4.0.0-devnet.2-patch.0/noir-projects/aztec-nr/aztec/src/oracle/mod.nr
  - https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v4.0.0-devnet.2-patch.0/noir-projects/aztec-nr/aztec/src/oracle/random.nr

- Sender-for-tags helper APIs also exist in aztec-nr oracle notes module:
  - https://raw.githubusercontent.com/AztecProtocol/aztec-packages/v4.0.0-devnet.2-patch.0/noir-projects/aztec-nr/aztec/src/oracle/notes.nr
