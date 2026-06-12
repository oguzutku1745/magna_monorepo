# Magna v1 Golden Vectors (Noir ↔ TS)

These vectors are deterministic lock points used by both:

- Source of truth: `vectors/golden-vectors.json`
- Generated Noir constants: `contracts/magna-issuer/src/test/generated_golden_vectors.nr`
- Generated TS constants: `packages/magna-wallet/src/engine/generated-golden-vectors.ts`
- Sync command: `npm run vectors:sync`

## Claims hash

Formula:

- `compute_passport_claims_hash(schema_version, credential_type, nationality_alpha3_packed, min_age_proven, expiry_ts, MAGNA_CLAIMS_DS)`

Inputs:

- `schema_version = 1`
- `credential_type = 1`
- `nationality_alpha3_packed = pack_alpha3("CAN")`
- `min_age_proven = 21`
- `expiry_ts = 1893456000`
- `MAGNA_CLAIMS_DS = 0x4D414743`

Expected output:

- `10880147918856782488068909366336209471148257952328592858445600480948578306801`

## Revocation nullifier

Formula:

- `compute_revocation_nullifier(revocation_secret, credential_type, claims_hash, MAGNA_REVOCATION_DS)`

Inputs:

- `revocation_secret = 700`
- `credential_type = 1`
- `claims_hash = (claims vector above)`
- `MAGNA_REVOCATION_DS = 0x4D415247`

Expected output:

- `7370071108435081914129093848765719243676864858628479488232109689038950796840`

## Ghost seed KDF

Formula:

- `ghost_seed = Poseidon2_with_separator([uniqueIdentifier_field], MAGNA_GHOST_DS)`

Inputs:

- `uniqueIdentifier_field = 0x0123456789abcdef`
- `MAGNA_GHOST_DS = 0x4D414748`

Expected output:

- `2135043267113077479662583570444290566838512477708566341925878150838630415736`
