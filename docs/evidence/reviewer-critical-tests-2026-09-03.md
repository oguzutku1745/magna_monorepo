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

## Reviewer interpretation

- Blocker 1 is an automated circuit/API property and must pass this command.
- Blocker 2 is both an automated contract/portal property and an empirical official-mobile flow.
  The command proves the former; the preserved Gate B-dev evidence proves the latter for the local
  developer profile.
- Gate B-production is a release gate, not an M1-M5 Docker-development test. It requires a fresh
  `SALTED = 1` proof from a supported physical document through the unmodified official zkPassport
  application. It does not require a Magna fork of the mobile application.
