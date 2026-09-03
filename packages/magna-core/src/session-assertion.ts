import { normalizePolicy } from "./policy.js";
import type { Policy } from "./types.js";

export const SESSION_ASSERTION_VERSION = 2 as const;
export const MAGNA_SESSION_AUTHORIZATION_DS = 0x4d534132; // "MSA2"
const NOIR_FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type SessionVerificationReceipt = {
  id: string;
  kind: string;
  /** Mined Aztec transaction whose effect contains the request-bound authorization nullifier. */
  receipt: string;
};

/**
 * v2 transport envelope. It is deliberately unsigned: @magna/client verifies
 * every receipt against Aztec instead of trusting a key shipped in frontend JS.
 */
export type SessionAssertion = {
  v: typeof SESSION_ASSERTION_VERSION;
  clientId: string;
  origin: string;
  requestId: string;
  sessionChallenge: string;
  policyHash: string;
  verified: true;
  issuedAt: number;
  expiresAt: number;
  authorizationContract: string;
  receipt: string;
  receipts: SessionVerificationReceipt[];
};

function hexField(value: string, label: string, byteLength: number): bigint {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!new RegExp(`^[0-9a-f]{${byteLength * 2}}$`).test(normalized)) {
    throw new Error(`${label} must be ${byteLength} bytes of lowercase hexadecimal`);
  }
  const field = BigInt(`0x${normalized}`);
  if (field >= NOIR_FIELD_MODULUS) throw new Error(`${label} is outside the Noir field modulus`);
  return field;
}

/** Exact Poseidon preimage used by MagnaCompanySponsor. */
export function sessionAuthorizationFields(input: {
  consumerGatewayAddress: string;
  requestId: string;
  sessionChallenge: string;
  expiresAt: number;
  requirementIndex: number;
  policy: Policy;
}): bigint[] {
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) {
    throw new Error("expiresAt must be a positive safe integer");
  }
  if (!Number.isSafeInteger(input.requirementIndex) || input.requirementIndex < 0 || input.requirementIndex > 255) {
    throw new Error("requirementIndex must be a u8");
  }
  const policy = normalizePolicy(input.policy);
  return [
    BigInt(SESSION_ASSERTION_VERSION),
    hexField(input.consumerGatewayAddress, "consumerGatewayAddress", 32),
    hexField(input.requestId, "requestId", 16),
    hexField(input.sessionChallenge, "sessionChallenge", 32),
    BigInt(input.expiresAt),
    BigInt(input.requirementIndex),
    BigInt(policy.credentialType),
    ...policy.constraints.flatMap(constraint => {
      if (constraint.value < 0n || constraint.value >= NOIR_FIELD_MODULUS) {
        throw new Error("policy constraint value is outside the Noir field modulus");
      }
      return [BigInt(constraint.claimId), BigInt(constraint.op), constraint.value];
    }),
  ];
}
