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
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error(`${label} public input must fit in u8.`);
  }
  return parsed;
}

export function parsePassportWrapperPublicInputs(
  publicInputs: readonly string[],
): PassportWrapperPublicOutputs {
  if (publicInputs.length !== PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT) {
    throw new Error(
      `Passport A2 proof must expose exactly ${PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT} public inputs.`,
    );
  }
  const values = publicInputs.map((entry, index) =>
    normalizePublicFieldString(entry, `publicInputs[${index}]`),
  );
  return {
    claimsHash: values[0],
    nationalityCommitment: values[1],
    expiryCommitment: values[2],
    minAgeProven: parsePublicU8(values[3], "minAgeProven"),
    credentialValidUntil: values[4],
    rootCommitment: values[5],
    requestContextHash: values[6],
    proofCurrentDate: values[7],
  };
}
