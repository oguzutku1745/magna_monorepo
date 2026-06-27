import {
  PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT,
  type PassportWrapperPublicOutputs,
} from "./types.js";

export function normalizePublicFieldString(value: string, label: string): string {
  try {
    return BigInt(value).toString();
  } catch {
    throw new Error(`${label} public input must be a decimal or 0x-prefixed field string.`);
  }
}

function parsePublicU8(value: string, label: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} public input must be a non-negative integer string.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} public input must be a safe integer.`);
  }
  if (parsed > 255) {
    throw new Error(`${label} public input must fit in u8.`);
  }
  return parsed;
}

export function parsePassportWrapperPublicInputs(
  publicInputs: readonly string[],
): PassportWrapperPublicOutputs {
  if (publicInputs.length !== PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT) {
    throw new Error(
      `Passport wrapper proof must expose exactly ${PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT} public inputs.`,
    );
  }
  const normalizedPublicInputs = publicInputs.map((entry, index) =>
    normalizePublicFieldString(entry, `publicInputs[${index}]`),
  );
  const minAgeProven = parsePublicU8(normalizedPublicInputs[3], "minAgeProven");
  return {
    claimsHash: normalizedPublicInputs[0],
    nationalityCommitment: normalizedPublicInputs[1],
    expiryCommitment: normalizedPublicInputs[2],
    minAgeProven,
    credentialValidUntil: normalizedPublicInputs[4],
    scopedNullifier: normalizedPublicInputs[5],
    nationalityDisclosureCommitment: normalizedPublicInputs[6],
    expiryDisclosureCommitment: normalizedPublicInputs[7],
    agePredicateCommitment: normalizedPublicInputs[8],
    bindCommitment: normalizedPublicInputs[9],
  };
}
