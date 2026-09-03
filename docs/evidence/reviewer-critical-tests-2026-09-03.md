# Reviewer-critical acceptance suite — 2026-09-03

## One command

First build the clean, digest-pinned development image with the documented ordered deployment:

```bash
npm run docker:local
```

Then run the critical automated acceptance suite against that exact image:

```bash
npm run test:reviewer:critical:docker
```

The command is implemented by `scripts/run-reviewer-critical-tests.mjs` and stops on the first
failure. It covers:

- MagnaIssuer constraints and recovery transition tests;
- company-sponsor session-authorization entrypoints, shared TypeScript/Noir authorization hashes,
  wallet transaction construction, and `@magna/client` transaction-effect validation;
- Passport A2 recursive-wrapper bindings (review Blocker 1);
- Recovery V3 protocol vectors and Noir constraints;
- Recovery V3 recursive wrapper and EVM portal mutation/replay tests (review Blocker 2);
- verification API substitution, PII, registry, and governed-DKIM boundaries;
- management-wallet and relying-party login regressions;
- Instagram's forced compiler-diagnostic audit, real DKIM fixture, adversarial witness mutations,
  full UltraHonk proof generation, and proof verification.

The official zkPassport mobile scan is intentionally not replaced by a fixture. The automated suite
therefore complements, rather than replaces, the preserved Gate B-dev live-scan evidence in
`recovery-v3-gate-b-dev-2026-08-28.md`.

The static image suite checks the issuance-nullifier formula and normal contract paths. With the
ordered Docker stack still running, execute the real-network duplicate check separately:

```bash
npm run test:issuance-uniqueness:e2e
```

That test deploys a fresh issuer, mines the first rooted Passport A2 issuance, then changes the
active owner, Ghost owner, claims, and expiry while retaining the same proof-bound root. The second
transaction must be rejected by Aztec's nullifier tree. It does not replace this check with an API
database, fixture receipt, or mocked chain response.

## Reviewer interpretation

- Blocker 1 is an automated circuit/API property and must pass this command.
- Blocker 2 is both an automated contract/portal property and an empirical official-mobile flow.
  The command proves the former; the preserved Gate B-dev evidence proves the latter for the local
  developer profile.
- Login with Magna has no frontend/backend signing private key. The suite checks that altered request,
  challenge, policy, expiry, requirement index, sponsor, receipt status, or transaction nullifier is
  rejected.
- Rooted Passport A2 initial issuance is one-use per scoped identity. The contract test pins the
  domain-separated TypeScript/Noir hash vector; `npm run test:issuance-uniqueness:e2e` proves the
  duplicate is rejected by a real local Aztec state transition.
- Gate B-production is a release gate, not an M1-M5 Docker-development test. It requires a fresh
  `SALTED = 1` proof from a supported physical document through the unmodified official zkPassport
  application during testnet deployment. It does not require a Magna fork of the mobile application,
  and zkPassport's current lack of dev-mode OPRF support does not block the local Docker lane.
