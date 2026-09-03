# Instagram V2 production-live adapter evidence — refreshed 2026-09-03

## Decision and exact claim

Instagram V2 is the second production-live Magna credential adapter alongside Passport A2. In this
document, production-live means that the checked-in circuit, browser prover, verification API,
governed DKIM-key boundary, Aztec issuer/login path, and tester-facing UI are implemented and have a
reviewer-runnable acceptance suite.

The adapter proves possession of an authentic DKIM-signed Instagram recovery email whose signed
body names the claimed handle. The credential uses the rootless lane. After Passport Root Recovery
V3, the holder opens the recovered wallet and issues Instagram again from a fresh signed Instagram
security email through the same browser-local proof flow.

## Reproducible pinned lane

- `zkemail.nr`: tag `v2.0.0`, resolved commit
  `8264758c6dbd6d5e29a3d58b482c3eb014424efb`
- `sha256`: `v0.1.2`, commit `8f2256780e1946430818ac9d2fc0669d9bc0036a`
- `noir-bignum`: `v0.6.0`, commit `1e9bd8a8b9a5993ce252bb60fc60fee40d0efd87`
- `noir_rsa`: `v0.7.0`, commit `ed2b096676dd37be0c3a7938f1cfea3f65538dd9`
- Nargo / Noir.js / Noir types: `1.0.0-beta.5`
- `@aztec/bb.js`: `0.84.0`
- semantic ACIR SHA-256:
  `abbedc80f0d3338ac2ea8b1ae5991417ff5a7ffbc84b752e4a35eb10466ba295`
  (`1,228,221` decoded bytecode bytes)
- Docker Nargo archive SHA-256:
  - Linux arm64: `f13753f589374ccba54a28d19f81937f04fda459f5911fa3c2ee9a0be01f70fc`
  - Linux amd64: `a99c2aaab24e97a41a72224dd345aa82e8c8c21911b3d51ab38c232987fbdb5e`

The compiler wrapper requires the exact Nargo version, force-compiles with Brillig constraint
lookback, verifies the semantic ACIR hash used at runtime, and fails on any unexpected diagnostic or
audited dependency-source change. It does not use `--silence-warnings` or skip the compiler check.

## Five compiler diagnostics: source audit and enforcement

Nargo beta.5 emits five `Brillig function call isn't properly covered by a manual constraint`
diagnostics. The compiler wrapper accepts exactly these five locations and verifies the complete
source-file hashes before accepting the artifact:

| Source | Lines | File SHA-256 | Why the witness is bound |
| --- | ---: | --- | --- |
| `sha256 v0.1.2/src/sha256.nr` | 49, 110 | `5577519b2799ba3ff7472c803df281e012667395c0679928826faad4f8339a68` | `build_msg_block` is reconstructed byte-for-byte by `verify_msg_block`; final padding and encoded length are checked by `verify_msg_len`. |
| `noir-bignum v0.6.0/src/fns/expressions.nr` | 258 | `324bdc6c7e1f53a1789eb85ba69611213ff3407203a3ec2a39ab349d676fe1e0` | The returned quotient is range-constrained and recomputed in the complete modular relation; borrow flags are boolean/range constrained and the final limb relation is asserted zero. |
| `zkemail.nr v2.0.0/lib/src/partial_hash.nr` | 191, 252 | `fdd10d1fac6369a694bd690832fe9e11ad6fdd2021dcbc8fb961d8a3f4390bfa` | Every suffix block is rebuilt by `verify_msg_block`; padding bytes, pointer progression, and final encoded length are asserted before compression. |

The upstream partial-SHA construction deliberately takes the SHA state before the selected suffix as
a private witness. Its security is the documented SHA preimage assumption: the prover must know a
prefix state that completes with the constrained suffix to the DKIM-signed body hash. Magna does not
treat that state as an externally authenticated public value.

The `constraint-audit.spec.ts` test mutates the exact signed header, DKIM signature, partial body
hash, and signed body and requires circuit execution to fail. `redc` is intentionally a prover input:
changing it may execute, but zkemail.nr v2.0.0 binds it with the modulus into public output zero.
The test requires that output to change, and the API separately rejects any commitment outside
`MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES` before loading the issuer. This is the v2.0.0 remediation for
the prior unbound-REDC finding.

The pinned `get_body_hash` implementation also constrains the `bh=` value to the authenticated
DKIM-Signature field, requires a valid `:bh=`/`; bh=` boundary and terminating semicolon, closing the
older arbitrary-header-occurrence issue. The two audit PDFs bundled upstream describe the earlier
2024 commit, not v2.0.0; their findings were traced against the pinned current source rather than
treated as a remediation attestation.

## Real input and proof path

The committed fixture SHA-256 is
`da26e96d83a4c221539550b3098ba36835904889366360cbc139c1bb6914c01d`.
It is a real DKIM-signed Instagram recovery email, not a generated witness. Tests verify it offline
with ZK Email's DKIM verifier and a separately captured DNS TXT key for
`s1024-2013-q3._domainkey.mail.instagram.com`.

The supported client lane fails closed unless preprocessing reports:

- signing domain `mail.instagram.com`;
- algorithm `rsa-sha256`;
- canonicalization `relaxed/simple`; and
- a 1024-bit RSA modulus.

Those client checks avoid silent preprocessing drift. The cryptographic trust boundary remains the
proof-bound modulus+REDC commitment governed by the API, because a custom prover is not trusted to
run Magna's TypeScript helper.

The circuit verifies the RSA DKIM signature, authenticated sender, DKIM body hash, and exact signed
English ownership footer. It exposes only the governed key commitment, signature-derived email
nullifier, blinded claims commitment, expiry, active owner, issuer, and chain. The `.eml`, handle,
handle hash, and handle blind never leave the wallet origin.

## Reviewer commands

After building the clean pinned Docker image with `npm run docker:local`, run:

```bash
npm run test:reviewer:critical:docker
```

The Instagram portion force-compiles and audits the diagnostic set, runs input/profile and
adversarial witness tests, independently verifies the real email's DKIM signature, generates a real
UltraHonk proof, and verifies that proof. It contains no mocked email, witness, prover, verifier, or
API allowlist bypass.

For only this adapter:

```bash
npm run test:instagram-proof:docker
```

Any dependency revision, source hash, warning location/count, ACIR hash, governed key, runtime
version, or public-input layout change is a new adapter version and requires a fresh audit and
acceptance run.
