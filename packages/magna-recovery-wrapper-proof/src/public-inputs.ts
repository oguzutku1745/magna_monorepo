import { MAGNA_RECOVERY_V3_SCHEMA } from "@magna/recovery-v3/protocol";
import { RECOVERY_WRAPPER_PUBLIC_INPUT_COUNT, type RecoveryWrapperPublicOutputs } from "./types.js";

export function normalizeRecoveryPublicField(value: string, label: string): string {
  try {
    return BigInt(value).toString();
  } catch {
    throw new Error(`${label} must be a decimal or 0x-prefixed field string.`);
  }
}

export function parseRecoveryWrapperPublicInputs(values: readonly string[]): RecoveryWrapperPublicOutputs {
  if (values.length !== RECOVERY_WRAPPER_PUBLIC_INPUT_COUNT) {
    throw new Error(`Recovery V3 wrapper must expose exactly ${RECOVERY_WRAPPER_PUBLIC_INPUT_COUNT} public inputs.`);
  }
  const normalized = values.map((value, index) => normalizeRecoveryPublicField(value, `publicInputs[${index}]`));
  if (BigInt(normalized[0]) !== MAGNA_RECOVERY_V3_SCHEMA) {
    throw new Error("Recovery wrapper public input 0 has the wrong V3 schema.");
  }
  return {
    schema: normalized[0],
    authorization: normalized[1],
    messageSecretHash: normalized[2],
    proofCurrentDate: normalized[3],
    certificateRegistryRoot: normalized[4],
    circuitRegistryRoot: normalized[5],
    trustContext: normalized[6],
  };
}
