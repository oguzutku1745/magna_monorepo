# SDK release candidate verification — 2026-09-06

Registry publication: **pending npm authentication and scope access**.
Packages: `@magna/core@0.1.0`, `@magna/client@0.2.0`.

## Package checks

`npm run sdk:prepare` passed on Node.js 24.19.0. Core and client tests passed;
`prepack` performed clean release builds excluding all test files. Tarball
contents were checked against an allowlist: JavaScript and declarations under
`dist`, README and `package.json`. Core has 16 files; client has 8 files. Neither
contains source TypeScript, tests, tsconfig, wallet internals or deployment state.

The exact tarball SHA-256/SRI and source commit are recorded by the reproducible
command in ignored `artifacts/sdk/release.json`. Final candidates must be
regenerated after committing the source and must report `sourceDirty: false`.

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
A build and reviewer check from the committed release source remain to be recorded.

The current reviewer entry point is [the reviewer guide](../reviewer-guide.md).
Obsolete September 3 status and test-summary documents were consolidated there;
distinct historical security/adapter evidence is retained with its dates.

## Publication completion

Follow [the release procedure](../sdk-release.md): authenticate as a scope
publisher, publish the tested core tarball followed by the client tarball,
compare registry integrities, and rerun the consumer test with `--from-registry`.
Until those checks pass, M5 shipping is not marked complete.
