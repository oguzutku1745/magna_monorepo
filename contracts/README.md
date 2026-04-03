# Magna Contracts Workspace

This directory now follows a one-contract-per-crate layout:

- `contracts/magna-issuer/`: core Magna issuer/recovery protocol contract.
- `contracts/magna-company-sponsor/`: dedicated company-owned sponsor gateway for sponsored verify flows.
- `contracts/magna-company-rights-registry/`: L2 rights ledger keyed by sponsor contract address.
- `contracts/magna-verify-meter-hook/`: public sponsorship metering hook contract.
- `contracts/magna-consumer/`: tiny consumer dApp gate using `magna-lib` policy helpers.
- `contracts/magna-verify-meter-hook-instant/`: zero-delay verify meter hook for live E2E sponsorship path.

Each crate has its own `Nargo.toml`, `src/main.nr`, and crate-level README.
