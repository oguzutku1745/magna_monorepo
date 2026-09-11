# Apache-2.0 release and public history — 2026-09-12

The repository is public at [oguzutku1745/magna_monorepo](https://github.com/oguzutku1745/magna_monorepo).
The root and both published SDK packages include the Apache-2.0 license text;
their package manifests declare `"license": "Apache-2.0"`.

## Published SDK

- [@magna-protocol/core@0.1.1](https://www.npmjs.com/package/@magna-protocol/core/v/0.1.1)
- [@magna-protocol/client@0.2.1](https://www.npmjs.com/package/@magna-protocol/client/v/0.2.1)

Both tarballs were prepared from clean source commit
`dfc606a4bed832640ac7e5d70b76ac6276463fb5`. Registry integrity values match the
audited tarballs. All distributed JavaScript and TypeScript declarations are
byte-for-byte identical to core 0.1.0 and client 0.2.0; this patch release changes
licensing, documentation and package metadata, including the client's core pin.

| Package | Tarball SHA-256 |
| --- | --- |
| `@magna-protocol/core@0.1.1` | `ddc3f846060353db1958abbf2de6531bd48319a7bccc6f2a2a408364a77bf04c` |
| `@magna-protocol/client@0.2.1` | `f42e5952792fbcabb7d12a5767c581b0c5b4a83884dc39a39b17bccb757713b7` |

The reference dApp manifest and lockfile pin these npm tarballs. Its startup
guard resolves both the client and its transitive core dependency from installed
packages. Five reference tests, TypeScript validation and the Vite production
build passed in the repository and in a fresh external consumer installed from
npm. Both installations' integrity values match the release manifest. The
external check also verified the installed license fields and license text.

## Private fixture and history

The authentic Instagram email is supplied privately for tests, outside tracked
files and Docker build contexts. The public history was rewritten to remove the
email file. The former repository remains private; a separate repository at the
original public URL contains the cleaned branches, without the old pull-request
refs. A fresh clone audit scanned 2,388 reachable Git objects: no original email
blob, recipient address or historical `.eml` path was present.

The history rewrite preserved the current source tree exactly. Instagram tests
still verify and prove the real signed email when supplied through the documented
[private fixture configuration](../../packages/magna-instagram-proof/fixtures/README.md).
Missing private input produces an explicit error; the proof check is not skipped
or replaced with a mock. Existing clones of the former history should be replaced
with fresh clones before contributing. Earlier dated evidence retains its original
build identities and may refer to commit hashes from before the rewrite.

## Regression boundary

The full reviewer-critical Docker suite passed, including issuer, recovery,
wallet, API, management, reference dApp and real Instagram DKIM proof checks.
Validation used the existing pinned Aztec 5.1.0 image with the current source
overlaid and the private email mounted read-only. It was not a fresh image build
or a new live mobile recovery run. The later reference dependency update was
checked by the repository and external-consumer tests and builds above.

Application runtime and circuit behavior were not changed by this release.
Production deployment limitations remain documented in the reviewer guide and
threat model.
