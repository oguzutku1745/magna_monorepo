import { bytesToHex } from "./bytes.js";
import { normalizePolicy } from "./policy.js";
import type { Policy } from "./types.js";
import type { WireLoginRequirement } from "./connector-protocol.js";

/**
 * Canonical SESSION-LAYER policy hash: SHA-256 over a versioned, deterministic
 * byte encoding of the normalized policy. This binds the dApp's request to the
 * wallet's response envelope. It is intentionally NOT the on-chain poseidon
 * hash; the wallet maps the policy to contract types separately, keeping
 * @magna-protocol/core (and therefore @magna-protocol/client) free of Aztec dependencies.
 */
export async function computePolicyHash(policy: Policy): Promise<string> {
  const normalized = normalizePolicy(policy);
  const canonical = JSON.stringify({
    v: 1,
    credentialType: normalized.credentialType,
    constraints: normalized.constraints.map(c => ({
      claimId: c.claimId,
      op: c.op,
      value: c.value.toString(),
    })),
  });
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is unavailable");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}

function canonicalPolicy(policy: Policy) {
  const normalized = normalizePolicy(policy);
  return {
    credentialType: normalized.credentialType,
    constraints: normalized.constraints.map(c => ({
      claimId: c.claimId,
      op: c.op,
      value: c.value.toString(),
    })),
  };
}

function canonicalWireRequirement(requirement: WireLoginRequirement) {
  if (requirement.kind === "policy") {
    return {
      id: requirement.id,
      kind: requirement.kind,
      policy: canonicalPolicy({
        credentialType: requirement.policy.credentialType,
        constraints: requirement.policy.constraints.map(c => ({
          claimId: c.claimId,
          op: c.op,
          value: BigInt(c.value),
        })),
      }),
    };
  }
  return {
    id: requirement.id,
    kind: requirement.kind,
    handle: requirement.handle,
  };
}

/**
 * Canonical session-layer hash for combined login requirements. This deliberately
 * hashes public request intent, not Noir/Aztec witness data.
 */
export async function computeLoginRequirementsHash(requirements: WireLoginRequirement[]): Promise<string> {
  const canonical = JSON.stringify({
    v: 1,
    requirements: requirements.map(canonicalWireRequirement),
  });
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is unavailable");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `0x${bytesToHex(new Uint8Array(digest))}`;
}
