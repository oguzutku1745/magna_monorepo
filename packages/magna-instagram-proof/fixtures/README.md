# Private Instagram test email

Real signed emails are not distributed in Git, npm packages, or Docker images.
The application does not need a test fixture; users provide their own email in
the management wallet as before.

The real-DKIM input, circuit-mutation, and end-to-end proof tests require a
privately supplied English Instagram recovery email. No test is silently skipped
and no mock proof replaces the real proof when the file is missing.

From the repository root:

```sh
export MAGNA_INSTAGRAM_TEST_EMAIL_PATH=/absolute/private/path/instagram.eml
export MAGNA_INSTAGRAM_TEST_HANDLE=your_handle
npm run test:instagram-proof
# After building the Docker image:
npm run test:instagram-proof:docker
npm run test:reviewer:critical:docker
```

Alternatively, keep the existing local test email in the Git-ignored directory
`.private-test-fixtures/instagram-valid.eml`. Its original test handle remains
the default; set `MAGNA_INSTAGRAM_TEST_HANDLE` for a different email. Docker test
commands mount the email read-only for the lifetime of the disposable test
container. It is never copied into the application image.

Tests still verify the real signature against the independently captured public
DNS key in `src/fixture-dkim.ts`. The supported fixture profile is selector
`s1024-2013-q3`, domain `mail.instagram.com`, RSA-1024/SHA-256, canonicalization
`relaxed/simple`, and the English ownership footer. A different signing key or
template requires a separately reviewed test update; do not bypass verification.

Keep the file private. Do not commit it, attach it to public issues, or include
its contents or proof witness in test logs. The fixture requirement does not
change the production circuit, API key allowlist, or application behavior.
