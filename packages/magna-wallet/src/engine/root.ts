import type { RootCommitmentInput } from "./types.js";
import { MAGNA_ROOT_DS, poseidon2FieldHasher } from "./encoding.js";

function parseUniqueIdentifierField(input: bigint | string): bigint {
  if (typeof input === "bigint") return input;
  if (/^0x[0-9a-fA-F]+$/.test(input)) return BigInt(input);
  if (/^[0-9]+$/.test(input)) return BigInt(input);
  throw new Error(
    "uniqueIdentifier must be a Field-compatible bigint (or decimal/0x string) for Poseidon KDF",
  );
}

export function deriveRootCommitment(input: RootCommitmentInput): bigint {
  const uniqueIdentifierField = parseUniqueIdentifierField(input.uniqueIdentifier);
  const domainSeparator = input.domainSeparator ?? MAGNA_ROOT_DS;
  return poseidon2FieldHasher(domainSeparator, [uniqueIdentifierField]);
}
