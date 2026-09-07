# SDK release procedure

Release candidates: `@magna/core@0.1.0` and `@magna/client@0.2.0`.
Publication is pending until the registry confirms both versions. The SDK is
for the current Aztec 5.1.0 integration; no public Magna network is implied.

## Prepare and verify

Use Node.js 24.12+ and npm from the repository root:

```sh
npm ci
npm run sdk:prepare
npm run test:sdk:consumer
```

`sdk:prepare` runs package tests, rebuilds the distributable without test files,
packs both packages, and checks every tarball entry. `artifacts/sdk/release.json`
records the source commit, whether the worktree was dirty, and SHA-256/SRI hashes.
Only JavaScript, TypeScript declarations, README and package metadata are shipped.

The consumer check copies the reference dApp into a fresh OS temporary directory,
installs the tarballs with ordinary npm resolution, rejects workspace symlinks,
then runs the reference tests, TypeScript check and Vite build. Its directory is
recorded in `artifacts/sdk/consumer.json`. Add `-- --env-file /path/to/reference.env`
to use the current deployment's public configuration.

For interactive login, run that installed app on `localhost:5175`, which is the
registered reference origin. Stop only the existing reference-dApp server to
free that port; keep the management wallet, API and chain running. Port 15175 is
suitable for bundle/render smoke checks but is not a registered login origin.

## Publish the tested tarballs

Commit the reviewed source before final preparation. Require
`sourceDirty: false` in the final release manifest. Inspect the archive contents
and hashes before publication. Do not run the destructive local reset merely
to publish the SDK.

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish ./artifacts/sdk/magna-core-0.1.0.tgz --access public --registry=https://registry.npmjs.org
npm publish ./artifacts/sdk/magna-client-0.2.0.tgz --access public --registry=https://registry.npmjs.org
```

The account must own or have publishing access to the `@magna` scope. Complete
npm's browser/2FA prompt in your own terminal; do not share credentials. Interactive
publishing requires account 2FA even after a successful login. If npm returns the 403
"Two-factor authentication" error, enable 2FA under the npm website's Account
settings, register a passkey/security key, and save recovery codes privately.
See [npm's 2FA setup instructions](https://docs.npmjs.com/configuring-two-factor-authentication/).
Publish core first because the client depends on it. A published version is immutable;
if either version already exists, compare its registry integrity with the
release manifest before taking further action.

After publication:

```sh
npm view @magna/core@0.1.0 dist.integrity --registry=https://registry.npmjs.org
npm view @magna/client@0.2.0 dist.integrity --registry=https://registry.npmjs.org
npm run test:sdk:consumer -- --from-registry
```

Both registry integrity values must match the tested tarballs. Record the
release commit, package versions/integrities and installed-consumer result in
the release evidence. Keep npm tokens, generated environments, runtime state,
tarballs and build output out of Git.
