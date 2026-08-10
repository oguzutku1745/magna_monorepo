# Passport A2 Manual Readiness Test

Use this checklist before enabling Passport A2 in a production deployment.

## Preconditions

- `VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND=a2` (or unset, because A2 is the only supported path).
- `VITE_MAGNA_ZKPASSPORT_DEV_MODE=false` and `MAGNA_ZKPASSPORT_DEV_MODE=false`.
- `VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR=false`.
- `VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP=false`.
- `MAGNA_ZKPASSPORT_EVM_RPC_URL` points at the verifier chain RPC.
- `npm run readiness:passport-a2` passes.

## Flow

1. Open the management app with the production-like A2 configuration.
2. Start Passport A2 issuance and scan the zkPassport QR code with the zkPassport mobile app.
3. Confirm the app requests a `compressed` proof, discloses document type, nationality and expiry,
   binds the request context, and does not enable zkPassport dev mode.
4. Complete the mobile proof handoff.
5. Confirm the frontend logs local A2 witness building and recursive wrapper proof generation.
6. Confirm the API request contains only the A2 schema, wrapper proof and eight public inputs,
   registry context, lifecycle owners, validity, mode and Ghost derivation version. The outer proof
   and its public inputs must not cross the API boundary.
7. Confirm the API rejects any request containing `queryResult`, `originalQuery`, `committedInputs`,
   raw claims, the outer proof, scoped or unique identifiers, claim blinds, private note hints,
   revocation secrets, or local witness data.
8. Confirm issuance succeeds through the v2 issuer path and the response contains no `normalizedClaims`.
9. Refresh the app, select Login with Magna, and verify the issued A2 credential uses the stored
   local committed-claims witness for presentation.
10. Confirm renewal and recovery each require a fresh A2 passport proof and keep note spending local.

## Expected Result

Passport A2 issuance, renewal, recovery and Login with Magna presentation succeed without
cleartext passport PII, the outer zkPassport proof, or private note material crossing the
frontend-to-API boundary.
