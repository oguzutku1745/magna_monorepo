import {
  formatBoundData,
  getAgeParameterCommitment,
  getBindParameterCommitment,
  getDiscloseParameterCommitment,
} from "@zkpassport/utils";

export type DisclosureWitness = {
  discloseMask: number[];
  disclosedBytes: number[];
};

export type MinimalZkPassportWitness = {
  nationalityDisclosure: DisclosureWitness;
  expiryDisclosure: DisclosureWitness;
  agePredicate: {
    minAge: number;
    maxAge: number;
  };
  bind: {
    customData: string;
  };
};

export type ZkPassportParameterCommitmentManifest = {
  nationalityDisclosureCommitment: string;
  expiryDisclosureCommitment: string;
  agePredicateCommitment: string;
  bindCommitment: string;
};

const FORBIDDEN_ZKPASSPORT_KEYS = new Set([
  "proofs",
  "originalQuery",
  "queryResult",
  "committedInputs",
  "outerProof",
  "outerPublicInputs",
  "publicInputs",
  "nationality",
  "nationalityAlpha3",
  "passportExpiryDate",
  "expiryTs",
  "expiry_date",
  "uniqueIdentifier",
]);

function assertByteArray(value: number[], label: string): void {
  for (const byte of value) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label} must contain bytes in [0, 255].`);
    }
  }
}

export async function computeZkPassportParameterCommitmentManifest(
  witness: MinimalZkPassportWitness,
): Promise<ZkPassportParameterCommitmentManifest> {
  assertByteArray(witness.nationalityDisclosure.discloseMask, "nationality disclose mask");
  assertByteArray(witness.nationalityDisclosure.disclosedBytes, "nationality disclosed bytes");
  assertByteArray(witness.expiryDisclosure.discloseMask, "expiry disclose mask");
  assertByteArray(witness.expiryDisclosure.disclosedBytes, "expiry disclosed bytes");

  const bindBytes = formatBoundData({ custom_data: witness.bind.customData });
  const [nationalityDisclosureCommitment, expiryDisclosureCommitment, agePredicateCommitment, bindCommitment] =
    await Promise.all([
      getDiscloseParameterCommitment(
        witness.nationalityDisclosure.discloseMask,
        witness.nationalityDisclosure.disclosedBytes,
      ),
      getDiscloseParameterCommitment(
        witness.expiryDisclosure.discloseMask,
        witness.expiryDisclosure.disclosedBytes,
      ),
      getAgeParameterCommitment(witness.agePredicate.minAge, witness.agePredicate.maxAge),
      getBindParameterCommitment(bindBytes),
    ]);

  return {
    nationalityDisclosureCommitment: nationalityDisclosureCommitment.toString(),
    expiryDisclosureCommitment: expiryDisclosureCommitment.toString(),
    agePredicateCommitment: agePredicateCommitment.toString(),
    bindCommitment: bindCommitment.toString(),
  };
}

export function assertNoZkPassportPrivateArtifacts(value: unknown): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (FORBIDDEN_ZKPASSPORT_KEYS.has(key)) {
        throw new Error(`PII-bearing zkPassport artifact is forbidden in orchestrator payload: ${key}`);
      }
      stack.push(child);
    }
  }
}
