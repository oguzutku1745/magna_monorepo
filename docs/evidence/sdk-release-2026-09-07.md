# SDK publication and installed reference app — 2026-09-07

Result: **published and verified**. M5 shipping is complete for the agreed local
integration. The npm organization is `magna-protocol`.

- [@magna-protocol/core@0.1.0](https://www.npmjs.com/package/@magna-protocol/core/v/0.1.0)
- [@magna-protocol/client@0.2.0](https://www.npmjs.com/package/@magna-protocol/client/v/0.2.0)

## Published artifacts

Both packages were prepared from clean source commit
`31623c0a1014d34fa87a6662cdc8cebba79b276f`. `artifacts/sdk/release.json` reported
`sourceDirty: false`. Core was published first, then client, with holder-approved
npm browser authentication. Registry integrity values match the tested tarballs.

| Package | Tarball SHA-256 |
| --- | --- |
| `@magna-protocol/core@0.1.0` | `978aa293c7f073b38579f8b07a942a996d31025d93f472237d12f000c4e9ab53` |
| `@magna-protocol/client@0.2.0` | `ef5c13305be0f23760d70f976fefa34ff5b0bac49d643668d323bc75dfc68d2b` |

```text
@magna-protocol/core@0.1.0
sha512-uSzxLG1Gr7sHcm17663d4EA12fnIMw2HsQG9FQ0fQ+mSHyzCa/+xOVH3+Iu9qtQr/Nhbedgjqcv2b1nWAyAEPQ==

@magna-protocol/client@0.2.0
sha512-i2Nl8kFOC8pAq2/tVh5zqYNJvURljsGIT8rJyMYHerjcKmUgcgwyqLq2M+cJd11rHVywKgzXKXQbwMdFwaUVvA==
```

The archives contain only package metadata, README, JavaScript and declarations.
Core has 16 files and client has 8. They exclude tests, source TypeScript,
tsconfig, deployment state and wallet internals. Every file was compared with
the preceding release candidates: only the agreed namespace substitution changed.

## Installation and live reference app

`npm run test:sdk:consumer -- --from-registry --env-file <public-reference-env>`
passed outside the monorepo on Node.js 24.19.0. Both dependencies were installed
by version from npm. Their installed lockfile URLs point to npm, integrity
values match the release manifest, and neither installation is a workspace
symlink. All five reference-app tests, TypeScript validation and the Vite
production build passed.

The initial npm install requests received a stale 404 after client publication.
The successful installation used `npm_config_prefer_online=true` and
`npm_config_full_metadata=true`; both published versions and their integrities
were independently checked against the registry.

The initial installed-consumer check served `http://localhost:5175`, with the active
Docker deployment's public reference environment. Its landing and eligibility
screens were checked in a real browser, including the Instagram field and
Login with Magna control. This is not a new end-to-end passkey login result.

The old Docker reference frontend was stopped to free port 5175. The management
wallet, API, Anvil and Aztec stayed running. The existing management image
predates the namespace rename; its mounted source now imports the new core
name, so the verified core distribution was added to that container. Management
source-module loading and API health returned HTTP 200. A future rebuilt image
resolves the renamed workspace through the committed package metadata normally.

The external consumer directory is recorded locally in
`artifacts/sdk/consumer.json`. Use `npm run reference-dapp:published` to restart
it after stopping the process already occupying 5175. Recreate the consumer if
its OS temporary directory has been removed. The reference app now also pins
both published npm tarballs in its own manifest and lockfile. Its normal local
and Docker commands reject workspace SDK resolution, including the client's
transitive core dependency. The external consumer is an additional isolation
check. See [the release procedure](../sdk-release.md).

## Regression evidence and source boundary

The clean Docker image built from runtime commit
`247bd9dcda9fdeab6c25cd8034f35f110c90d13c` passed all four WebAuthn account tests
and all 14 reviewer-critical stages, including 89 issuer tests, recovery,
wallet, API, management, reference app and real Instagram DKIM proof generation
and verification. The image is `magna-sdk-review:247bd9d`, immutable ID
`sha256:94cd00770a60dcf2c1f1b1aafbcdeb29f1875dab081a5175598ed681967ac026`.
Its context was a fresh Git archive and its build used `--no-cache`.

The subsequent SDK namespace commit `31623c0` contains exact package-name,
import and release-filename substitutions. After the rename, SDK tests, all
21 wallet test files, Passport A2 wrapper tests, 84 management tests and the
management production build passed, followed by the independent consumer checks
above. The final documentation and published-consumer launcher do not change
the published tarballs. The earlier Docker suite is not claimed as a new image
build after the namespace rename.

The [mobile recovery](recovery-v3-mobile-2026-09-06.md) and
[clock/issuance evidence](local-clock-docker-2026-09-06.md) retain their separate
deployment identities. Raw passport/email data, private witnesses, credentials,
runtime environments and generated artifacts remain outside Git.
