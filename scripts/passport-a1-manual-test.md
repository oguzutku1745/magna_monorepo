# Passport A1 Manual Readiness Test

Use this checklist before enabling Passport A1 in a production deployment.

## Preconditions

- `VITE_MAGNA_ZKPASSPORT_ISSUANCE_KIND=a1`.
- `VITE_MAGNA_ZKPASSPORT_DEV_MODE=false` and `MAGNA_ZKPASSPORT_DEV_MODE=false`.
- `VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR=false`.
- `VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP=false`.
- `MAGNA_ZKPASSPORT_EVM_RPC_URL` points at the verifier chain RPC.
- `npm run readiness:passport-a1 -- --profile=production` passes.

## Flow

1. Open the web app or management app with the production-like A1 configuration.
2. Start Passport A1 issuance and scan the zkPassport QR code with the zkPassport mobile app.
3. Confirm the app requests a `compressed-evm` proof and does not enable zkPassport dev mode.
4. Complete the mobile proof handoff.
5. Confirm the frontend logs local A1 witness building and local wrapper proof generation.
6. Confirm the API accepts only `wrapperProof`, `wrapperPublicInputs`, `zkPassportOuterProof`, `zkPassportOuterPublicInputs`, `claimsHash`, `credentialValidUntil`, `ghostOwner`, `rootCommitment`, `mode`, and `ghostDerivationVersion`.
7. Confirm the API rejects any request containing `queryResult`, `originalQuery`, `committedInputs`, `nationality`, `expiry_date`, `expiryTs`, `uniqueIdentifier`, `nationalityBlind`, `expiryBlind`, or local witness data.
8. Confirm issuance succeeds through the v2 issuer path and the response contains no `normalizedClaims`.
9. Refresh the app, select Login with Magna, and verify the issued A1 credential uses the stored local v2 witness for presentation.
10. Confirm renewal, recovery, and sponsored verification remain disabled for A1 unless they are explicitly wired to the same local v2 witness path.

## Expected Result

Passport A1 issuance and Login with Magna v2 presentation succeed without cleartext passport PII crossing the frontend-to-API boundary.
