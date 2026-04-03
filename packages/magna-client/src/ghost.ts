import { CredentialType, type GhostDerivationInput, type GhostKeyMaterial } from "./types.js";
import { MAGNA_GHOST_DS, poseidon2FieldHasher } from "./encoding.js";

export function recoveryScope(credentialType: CredentialType): string {
  return `magna_recovery::${credentialType}`;
}

function parseUniqueIdentifierField(input: bigint | string): bigint {
  if (typeof input === "bigint") return input;
  if (/^0x[0-9a-fA-F]+$/.test(input)) return BigInt(input);
  if (/^[0-9]+$/.test(input)) return BigInt(input);
  throw new Error(
    "uniqueIdentifier must be a Field-compatible bigint (or decimal/0x string) for Poseidon KDF",
  );
}

export function deriveGhostKeyMaterial(input: GhostDerivationInput): GhostKeyMaterial {
  const scope = recoveryScope(input.credentialType);
  const uniqueIdentifierField = parseUniqueIdentifierField(input.uniqueIdentifier);
  const domainSeparator = input.domainSeparator ?? MAGNA_GHOST_DS;
  const seedField = poseidon2FieldHasher(domainSeparator, [uniqueIdentifierField]);
  const seedHex = seedField.toString(16).padStart(64, "0");

  return {
    scope,
    domainSeparator,
    seedField,
    // Keep legacy fields for compatibility with current client call-sites.
    saltHex: seedHex,
    secretHex: seedHex,
  };
}
