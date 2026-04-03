# Magna E2E Tests

These tests validate the end-to-end Magna flow against a local Aztec network:

- Issuance from orchestrator
- Verify/login policy checks (multi-constraint AND list)
- Recovery flow wiring and failure/success simulation patterns

## Prerequisites

- Local Aztec network running at `http://localhost:8080`
- Contract bindings generated in `@magna/contracts-bindings`:
  - `npm run codegen:contracts`

## Run

```bash
AZTEC_E2E=1 npm run -w @magna/e2e-tests test
```

Without `AZTEC_E2E=1`, tests are skipped to keep default CI/local loops fast.
