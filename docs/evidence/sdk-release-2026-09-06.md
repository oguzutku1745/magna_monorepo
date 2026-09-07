# SDK release candidate verification — 2026-09-06

Registry publication: **pending npm 2FA setup and verified scope access**.
Packages: `@magna/core@0.1.0`, `@magna/client@0.2.0`.

## Package checks

`npm run sdk:prepare` passed on Node.js 24.19.0. Core and client tests passed;
`prepack` performed clean release builds excluding all test files. Tarball
contents were checked against an allowlist: JavaScript and declarations under
`dist`, README and `package.json`. Core has 16 files; client has 8 files. Neither
contains source TypeScript, tests, tsconfig, wallet internals or deployment state.

The final candidates were regenerated from clean commit
`247bd9dcda9fdeab6c25cd8034f35f110c90d13c`; the release manifest reports
`sourceDirty: false`. Their bytes match the independently installed and
browser-tested candidates. `artifacts/sdk/release.json` is generated locally
and excluded from Git.

| Package | Tarball SHA-256 |
| --- | --- |
| `@magna/core@0.1.0` | `08f0febd743d8d9361bf99d5110b97cf828ad254992de327bff5b4bf30e6a093` |
| `@magna/client@0.2.0` | `7767faf4ff07598eabf185f28d7997f7e755d07fb0d520920a1d1ed1e3456509` |

Expected npm registry integrity values:

```text
@magna/core@0.1.0
sha512-OsBa3JHcWtWOrV8+E84Nm9FL+h/xFyFp+koetfOn6psczwg1pLtZa8DQ4tpGBtUI4XP8q2oUH/ZLK0dfbTbQtw==

@magna/client@0.2.0
sha512-Yeej7zQPaJh7YT5jsofTnSKvv1BZm02LwiNF8hSXGv0JVB5Z6fKAMEcwdxXFebQkRLDtVK2YI6AuN7zZV5clrw==
```

## Independent consumer

`npm run test:sdk:consumer -- --env-file <public-reference-env>` passed in a new
OS temporary directory outside the monorepo. Both Magna dependencies were
installed from their tarballs, their versions were checked, and symlinks/workspace
resolution were explicitly rejected. All five reference-dApp tests passed;
TypeScript and Vite production builds passed.

The installed app was started at `http://127.0.0.1:15175` and inspected in a real
browser. The landing screen and eligibility/login screen rendered, including the
Instagram handle field and Login with Magna control, with no captured browser
errors. This is a package/render smoke test, not a new passkey login: that port
is not the registered relying-party origin. The holder's prior full login was
against the normal `localhost:5175` application.

## Repository validation

The full reviewer suite passed for the clock/application implementation before
SDK metadata changes; see [clock evidence](local-clock-docker-2026-09-06.md).
A clean Docker build from release commit
`247bd9dcda9fdeab6c25cd8034f35f110c90d13c` passed on September 7. Its context was
a fresh `git archive` extraction; a disposable builder ran with `--no-cache`.
The image contains no live deployment state. The successful mobile recovery
stack was left running throughout.

Image: `magna-sdk-review:247bd9d`.
Immutable image ID:
`sha256:94cd00770a60dcf2c1f1b1aafbcdeb29f1875dab081a5175598ed681967ac026`.
The image revision label matches the full source commit above.

Validation command:

```sh
docker run --rm -e NODE_OPTIONS=--max-old-space-size=3072 \
  -e HARDWARE_CONCURRENCY=2 --entrypoint sh magna-sdk-review:247bd9d \
  -lc 'cd /workspace && npm run test:contracts:webauthn-account && npm run test:reviewer:critical'
```

Validation passed with exit code 0. All four WebAuthn account tests and all
14 reviewer stages passed: clock diagnostics and pinned-runtime hooks, issuer
(89 tests), session authorization, core vectors, wallet, client, Passport A2
wrapper, Recovery V3 protocol and wrapper, EVM portal, API, management,
reference dApp, and real Instagram DKIM proof generation/verification. The
real Instagram proof test completed in 74.023 seconds.

This verifies the committed image build and automated checks. The earlier
live-chain timing/issuance tests and holder's mobile run retain their own
deployment identities and are not represented as reruns on this review image.
The subsequent evidence-record commit changes documentation only; runtime and
SDK source remain exactly those validated at `247bd9d`.

The current reviewer entry point is [the reviewer guide](../reviewer-guide.md).
Obsolete September 3 status and test-summary documents were consolidated there;
distinct historical security/adapter evidence is retained with its dates.

## Publication completion

On September 7, npm login was verified and both local tarball hashes matched
the candidates above. Neither package existed publicly. Publishing the core
tarball was rejected with HTTP 403 requiring 2FA; the authenticated account's
profile confirmed 2FA was disabled. The organization lookup did not establish
membership in `@magna`. Neither package was published by this attempt.

Follow [the release procedure](../sdk-release.md): authenticate as a scope
publisher, publish the tested core tarball followed by the client tarball,
compare registry integrities, and rerun the consumer test with `--from-registry`.
Until those checks pass, M5 shipping is not marked complete.
