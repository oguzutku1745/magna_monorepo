import { bytesToHex } from "./bytes.js";
import { MAX_CONSTRAINTS, normalizePolicy } from "./policy.js";
import { ClaimId, ConstraintOp, CredentialType, type Policy } from "./types.js";
import type { SessionAssertion } from "./session-assertion.js";

export type WirePolicy = {
  credentialType: Policy["credentialType"];
  constraints: { claimId: number; op: number; value: string }[];
};

export type WirePolicyLoginRequirement = {
  id: string;
  kind: "policy";
  policy: WirePolicy;
};

export type WireInstagramHandleLoginRequirement = {
  id: string;
  kind: "instagram-handle";
  handle: string;
};

export type WireLoginRequirement =
  | WirePolicyLoginRequirement
  | WireInstagramHandleLoginRequirement;

export type LoginRequirement =
  | {
      id: string;
      kind: "policy";
      policy: Policy;
    }
  | {
      id: string;
      kind: "instagram-handle";
      handle: string;
    };

export type LoginRequest = {
  v: 1;
  kind: "magna:login-request";
  clientId: string;
  origin: string;
  requestId: string;
  sessionChallenge: string;
  policy: WirePolicy;
  policyHash: string;
  requirements?: WireLoginRequirement[];
  responseMode: "postMessage" | "redirectCode";
  redirectUri?: string;
};

export type LoginResponse = {
  v: 2;
  kind: "magna:login-response";
  requestId: string;
  assertion: SessionAssertion;
};

export type LoginErrorResponse = {
  v: 1;
  kind: "magna:login-error";
  requestId: string;
  error: string;
};

const MAX_DECIMAL_DIGITS = 78;

function webCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    throw new Error("Web Crypto API is unavailable");
  }
  return cryptoApi;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnumValue<T extends Record<string, string | number>>(enumObject: T, value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && Object.values(enumObject).includes(value);
}

function assertCanonicalDecimal(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || value.length > MAX_DECIMAL_DIGITS) {
    throw new Error("policy constraint value must be a canonical bounded decimal string");
  }
}

function assertWirePolicy(policy: unknown): asserts policy is WirePolicy {
  if (!isObject(policy)) {
    throw new Error("policy must be an object");
  }
  if (!isEnumValue(CredentialType, policy.credentialType)) {
    throw new Error("policy credentialType is invalid");
  }
  if (!Array.isArray(policy.constraints) || policy.constraints.length > MAX_CONSTRAINTS) {
    throw new Error(`policy constraints must contain at most ${MAX_CONSTRAINTS} entries`);
  }
  for (const constraint of policy.constraints) {
    if (!isObject(constraint)) {
      throw new Error("policy constraint must be an object");
    }
    if (!isEnumValue(ClaimId, constraint.claimId)) {
      throw new Error("policy constraint claimId is invalid");
    }
    if (!isEnumValue(ConstraintOp, constraint.op)) {
      throw new Error("policy constraint op is invalid");
    }
    assertCanonicalDecimal(constraint.value);
  }
}

const REQUIREMENT_ID_PATTERN = /^[a-z0-9_-]{1,40}$/;
const INSTAGRAM_HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

function assertRequirementId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !REQUIREMENT_ID_PATTERN.test(value)) {
    throw new Error("login requirement id is invalid");
  }
}

function assertInstagramHandle(value: unknown): asserts value is string {
  if (typeof value !== "string" || !INSTAGRAM_HANDLE_PATTERN.test(value)) {
    throw new Error("instagram handle requirement is invalid");
  }
}

function assertWireLoginRequirements(value: unknown): asserts value is WireLoginRequirement[] {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw new Error("login requirements must contain 1 to 4 entries");
  }
  const ids = new Set<string>();
  for (const requirement of value) {
    if (!isObject(requirement)) {
      throw new Error("login requirement must be an object");
    }
    assertRequirementId(requirement.id);
    if (ids.has(requirement.id)) {
      throw new Error("login requirement ids must be unique");
    }
    ids.add(requirement.id);
    if (requirement.kind === "policy") {
      assertWirePolicy(requirement.policy);
      continue;
    }
    if (requirement.kind === "instagram-handle") {
      assertInstagramHandle(requirement.handle);
      continue;
    }
    throw new Error("login requirement kind is invalid");
  }
}

function assertHex(value: unknown, byteLength: number, label: string, prefixed = false): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const pattern = prefixed
    ? new RegExp(`^0x[0-9a-f]{${byteLength * 2}}$`)
    : new RegExp(`^[0-9a-f]{${byteLength * 2}}$`);
  if (!pattern.test(value)) {
    throw new Error(`${label} must be ${byteLength} bytes of lowercase hex${prefixed ? " with 0x prefix" : ""}`);
  }
}

export function assertLoginRequest(value: unknown): asserts value is LoginRequest {
  if (!isObject(value)) {
    throw new Error("login request must be an object");
  }
  if (value.v !== 1 || value.kind !== "magna:login-request") {
    throw new Error("login request has invalid version or kind");
  }
  if (typeof value.clientId !== "string" || value.clientId.length === 0) {
    throw new Error("login request clientId is required");
  }
  if (typeof value.origin !== "string" || value.origin.length === 0) {
    throw new Error("login request origin is required");
  }
  assertHex(value.requestId, 16, "requestId");
  assertHex(value.sessionChallenge, 32, "sessionChallenge");
  assertHex(value.policyHash, 32, "policyHash", true);
  assertWirePolicy(value.policy);
  assertWireLoginRequirements(value.requirements);
  if (value.responseMode !== "postMessage" && value.responseMode !== "redirectCode") {
    throw new Error("login request responseMode is invalid");
  }
  if (value.responseMode === "redirectCode" && typeof value.redirectUri !== "string") {
    throw new Error("redirectUri is required for redirectCode responseMode");
  }
}

export function randomHex(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error("byteLength must be a non-negative safe integer");
  }
  const bytes = webCrypto().getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

/** A canonical 32-byte value guaranteed to fit in the Noir/Aztec field. */
export function randomFieldHex(): string {
  return `00${randomHex(31)}`;
}

/** Wire-format policy: bigint values as decimal strings. */
export function policyToWire(policy: Policy): WirePolicy {
  return {
    credentialType: policy.credentialType,
    constraints: policy.constraints.map(c => ({
      claimId: Number(c.claimId),
      op: Number(c.op),
      value: c.value.toString(),
    })),
  };
}

export function policyFromWire(wire: WirePolicy): Policy {
  assertWirePolicy(wire);
  return {
    credentialType: wire.credentialType,
    constraints: wire.constraints.map(c => ({
      claimId: c.claimId,
      op: c.op,
      value: BigInt(c.value),
    })),
  } as Policy;
}

export function loginRequirementsToWire(requirements: LoginRequirement[]): WireLoginRequirement[] {
  return requirements.map(requirement => {
    if (requirement.kind === "policy") {
      return {
        id: requirement.id,
        kind: "policy",
        policy: policyToWire(normalizePolicy(requirement.policy)),
      };
    }
    return {
      id: requirement.id,
      kind: "instagram-handle",
      handle: requirement.handle,
    };
  });
}
