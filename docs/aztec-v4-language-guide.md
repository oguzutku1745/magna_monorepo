# Aztec v4 Noir Guide (Source-Backed)

This guide captures the exact Aztec v4 (`4.0.0-devnet.2-patch.0`) rules used while migrating this repo.
Every rule below is backed by official Aztec docs and/or Aztec official contract sources.

## Version and Toolchain

- Target version: `4.0.0-devnet.2-patch.0`
- CLI check: `aztec --version`
- Compile command: `aztec compile`
- Test command: `aztec test`
- Codegen command: `aztec codegen <abi-or-project> -o <outdir>`

## Contract Structure Rules

- One contract per Noir crate.
- `#[external(...)]` functions must live directly in the contract file.
- `#[internal(...)]` helper functions can be used for modular logic.

Sources:
- https://docs.aztec.network/developers/docs/aztec-nr/framework-description/contract_structure
- https://docs.aztec.network/developers/docs/aztec-nr/framework-description/functions/attributes

## Storage Rules

- Storage struct uses `#[storage]` and **must** be generic: `struct Storage<Context>`.
- Use Aztec state vars with `Context` generic, e.g.:
  - `PublicImmutable<T, Context>`
  - `PublicMutable<T, Context>`
  - `Map<K, V, Context>`
  - `Owned<S, Context>`

Sources:
- https://docs.aztec.network/developers/docs/aztec-nr/framework-description/state_variables
- Official examples:
  - `noir-projects/noir-contracts/contracts/app/simple_token_contract/src/main.nr`
  - `noir-projects/noir-contracts/contracts/app/nft_contract/src/main.nr`

## Note Type Rules

- Standard notes use:
  - `#[derive(Eq, Packable)]` (optionally plus `Serialize, Deserialize` when needed for ABI/test usage)
  - `#[note]`
- For advanced custom hash/nullifier logic, use `#[custom_note]`.
- `HintedNote` is generic: `HintedNote<MyNote>`.

Sources:
- https://docs.aztec.network/developers/docs/guides/smart_contracts/how_to_implement_custom_notes
- https://docs.aztec.network/developers/docs/aztec-nr/framework-description/functions/attributes
- Official examples:
  - `noir-projects/aztec-nr/uint-note/src/uint_note.nr`
  - `noir-projects/noir-contracts/contracts/app/nft_contract/src/types/nft_note.nr`
  - `noir-projects/aztec-nr/aztec/src/history/note.nr`

## Trait and Import Rules

- Use Aztec protocol traits from:
  - `aztec::protocol::traits::{Serialize, Deserialize, Packable, ToField, ...}`
- Poseidon helper path:
  - `aztec::protocol::hash::poseidon2_hash_with_separator`
- If a library crate uses Aztec traits/types, Aztec must be in `[dependencies]` of its `Nargo.toml`.

Sources:
- `noir-projects/noir-protocol-circuits/crates/types/src/traits.nr`
- `noir-projects/noir-contracts/contracts/test/spam_contract/src/main.nr`

## ABI Visibility Rules

- Types used in external function params/returns must be public enough for generated ABI wrappers.
- In practice:
  - `pub struct ...` for note/struct types referenced by external ABI
  - fields should be `pub` where accessed across modules/tests

Sources:
- Aztec macro-generated ABI constraints observed during compile
- Official examples with exported external argument structs:
  - `noir-projects/noir-contracts/contracts/app/private_voting_contract/src/main.nr`

## Comparison and Integer Rules

- Field bitwise and ordered comparisons are restricted; use integer types for bitwise/range checks.
- For bitmask policy logic, use `u64`/`u128` state and operations instead of `Field`.

Sources:
- Compiler diagnostics on v4
- Official bitwise examples:
  - `noir-projects/noir-contracts/contracts/test/avm_test_contract/src/main.nr`
  - `noir-projects/noir-contracts/contracts/app/token_blacklist_contract/src/types/roles.nr`

## Test Rules (`TestEnvironment`)

- Canonical setup:
  - `let mut env = TestEnvironment::new();`
  - `env.create_light_account()` / `env.create_contract_account()`
  - `let initializer_call = MyContract::interface().constructor(...)`
  - `env.deploy("MyContract").with_public_initializer(owner, initializer_call)`
- Calls:
  - `env.call_private(...)`
  - `env.call_public(...)`
  - `env.view_public(...)`
  - `env.simulate_utility(...)`

Sources:
- https://docs.aztec.network/developers/docs/aztec-nr/how_to_test_contracts
- Official test utils:
  - `noir-projects/noir-contracts/contracts/app/token_contract/src/test/utils.nr`
  - `noir-projects/noir-contracts/contracts/app/private_voting_contract/src/test/utils.nr`

## Strict Migration Workflow (No Guessing)

1. Run `aztec compile`.
2. For each compile error:
   - find the exact API/type in official docs or official Aztec sources,
   - patch only with that source-backed pattern.
3. Re-run `aztec compile`.
4. Run `aztec test`.
5. Run `aztec codegen` from produced artifacts.
