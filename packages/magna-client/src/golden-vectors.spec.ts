import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  deriveGhostKeyMaterial,
  SCOPED_GHOST_DERIVATION_VERSION,
  LEGACY_GHOST_DERIVATION_VERSION,
} from "./ghost.js";
import {
  MAGNA_GHOST_DS,
  computePassportClaimsHash,
  computeRevocationNullifier,
  packAlpha3,
  poseidon2FieldHasher,
} from "./encoding.js";
import { GOLDEN_DS, GOLDEN_INPUTS, GOLDEN_OUTPUTS } from "./generated-golden-vectors.js";
import { CredentialType, type PassportCanonicalClaims } from "./types.js";

describe("Noir↔TS golden vectors", () => {
  it("ghost DS is separated from revocation DS", () => {
    assert.equal(MAGNA_GHOST_DS, GOLDEN_DS.ghost);
    assert.notEqual(GOLDEN_DS.ghost, GOLDEN_DS.revocation);
  });

  it("claims hash matches canonical Noir formula", () => {
    const claims: PassportCanonicalClaims = {
      schemaVersion: GOLDEN_INPUTS.schemaVersion,
      credentialType: CredentialType.Passport,
      nationalityAlpha3Packed: packAlpha3(GOLDEN_INPUTS.nationalityAlpha3),
      minAgeProven: GOLDEN_INPUTS.minAgeProven,
      expiryTs: GOLDEN_INPUTS.expiryTs,
    };

    const claimsHash = computePassportClaimsHash(claims, poseidon2FieldHasher);
    assert.equal(claimsHash, GOLDEN_OUTPUTS.claimsHash);
  });

  it("revocation nullifier matches Noir preimage and DS", () => {
    const nullifier = computeRevocationNullifier(
      GOLDEN_INPUTS.revocationSecret,
      CredentialType.Passport,
      GOLDEN_OUTPUTS.claimsHash,
      poseidon2FieldHasher,
    );
    assert.equal(nullifier, GOLDEN_OUTPUTS.revocationNullifier);
  });

  it("ghost derivation matches Poseidon(uniqueIdentifier, DS) vector", () => {
    const ghost = deriveGhostKeyMaterial({
      uniqueIdentifier: GOLDEN_INPUTS.uniqueIdentifierField,
      credentialType: CredentialType.Passport,
      derivationVersion: LEGACY_GHOST_DERIVATION_VERSION,
      domainSeparator: MAGNA_GHOST_DS,
    });

    assert.equal(ghost.seedField, GOLDEN_OUTPUTS.ghostSeed);
    assert.equal(
      ghost.secretHex,
      GOLDEN_OUTPUTS.ghostSeed.toString(16).padStart(64, "0"),
    );
  });

  it("scoped ghost derivation changes when credential scope changes", () => {
    const passportGhost = deriveGhostKeyMaterial({
      uniqueIdentifier: GOLDEN_INPUTS.uniqueIdentifierField,
      credentialType: CredentialType.Passport,
      derivationVersion: SCOPED_GHOST_DERIVATION_VERSION,
      domainSeparator: MAGNA_GHOST_DS,
    });
    const instagramGhost = deriveGhostKeyMaterial({
      uniqueIdentifier: GOLDEN_INPUTS.uniqueIdentifierField,
      credentialType: CredentialType.Instagram,
      derivationVersion: SCOPED_GHOST_DERIVATION_VERSION,
      domainSeparator: MAGNA_GHOST_DS,
    });

    assert.notEqual(passportGhost.seedField, instagramGhost.seedField);
  });
});
