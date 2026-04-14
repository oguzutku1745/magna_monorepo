import {
  CredentialType,
  type GhostDerivationInput,
  type GhostDerivationVersion,
  type GhostKeyMaterial,
} from "./types.js";
import { MAGNA_GHOST_DS, poseidon2FieldHasher } from "./encoding.js";

export function recoveryScope(credentialType: CredentialType): string {
  return `magna_recovery::${credentialType}`;
}

export const LEGACY_GHOST_DERIVATION_VERSION: GhostDerivationVersion = "v1_legacy_unscoped";
export const SCOPED_GHOST_DERIVATION_VERSION: GhostDerivationVersion = "v2_scoped";

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
  const derivationVersion = input.derivationVersion ?? LEGACY_GHOST_DERIVATION_VERSION;
  const uniqueIdentifierField = parseUniqueIdentifierField(input.uniqueIdentifier);
  const domainSeparator = input.domainSeparator ?? MAGNA_GHOST_DS;
  const seedField =
    derivationVersion === SCOPED_GHOST_DERIVATION_VERSION
      ? poseidon2FieldHasher(domainSeparator, [uniqueIdentifierField, BigInt(input.credentialType)])
      : poseidon2FieldHasher(domainSeparator, [uniqueIdentifierField]);
  const seedHex = seedField.toString(16).padStart(64, "0");

  return {
    scope,
    derivationVersion,
    domainSeparator,
    seedField,
    // Keep both fields identical for compatibility with current call-sites.
    saltHex: seedHex,
    secretHex: seedHex,
  };
}
