import {
  formatBoundData,
  getAgeParameterCommitment,
  getBindParameterCommitment,
  getDiscloseParameterCommitment,
  getNullifierFromOuterProof,
  getNullifierTypeFromOuterProof,
  getParamCommitmentsFromOuterProof,
  getScopeFromOuterProof,
  getSubscopeFromOuterProof,
} from "@zkpassport/utils";

export type DisclosureWitness = {
  discloseMask: number[];
  disclosedBytes: number[];
};

export type ZkPassportSafeBigintLike = bigint | number | string;

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

export type ZkPassportOuterProofArtifact = {
  proof: unknown;
  verificationKey?: unknown;
  metadata?: Record<string, unknown>;
};

export type ZkPassportOuterProofShape = {
  proofPath: string;
  publicInputsPath: string;
};

export type ZkPassportOuterProofArtifacts = {
  outerProof: ZkPassportOuterProofArtifact;
  outerPublicInputs: readonly ZkPassportSafeBigintLike[];
  shape: ZkPassportOuterProofShape;
};

export type ZkPassportOuterProofUtilityMetadata = {
  parameterCommitments: string[];
  scopedNullifier: string;
  nullifierType: string;
  scope: string;
  subscope: string;
};

export type PassportWrapperWitnessAgePredicate = {
  minAge: number;
  maxAge: number;
};

export type PassportWrapperWitnessBindData = {
  customData: string;
};

export type WalletPassportWrapperLocalWitness = {
  zkPassportOuterProof: ZkPassportOuterProofArtifact;
  zkPassportOuterPublicInputs: readonly ZkPassportSafeBigintLike[];
  minimalZkPassportWitness: MinimalZkPassportWitness;
  nationalityAlpha3: string;
  expiryTs: ZkPassportSafeBigintLike;
  minAgeProven: number;
  credentialValidUntil: ZkPassportSafeBigintLike;
  agePredicate: PassportWrapperWitnessAgePredicate;
  bind: PassportWrapperWitnessBindData;
  nationalityBlind: ZkPassportSafeBigintLike;
  expiryBlind: ZkPassportSafeBigintLike;
  scopedNullifier?: ZkPassportSafeBigintLike | null;
  expectedParameterCommitmentManifest?: ZkPassportParameterCommitmentManifest;
};

export type MinimalZkPassportWitnessDisclosureInput = {
  nationalityAlpha3: string;
  expiryTs: ZkPassportSafeBigintLike;
  agePredicate: PassportWrapperWitnessAgePredicate;
  bind: PassportWrapperWitnessBindData;
};

export type BuildPassportWrapperWitnessFromZkPassportResultInput =
  MinimalZkPassportWitnessDisclosureInput & {
    minAgeProven: number;
    credentialValidUntil: ZkPassportSafeBigintLike;
    nationalityBlind: ZkPassportSafeBigintLike;
    expiryBlind: ZkPassportSafeBigintLike;
    scopedNullifier?: ZkPassportSafeBigintLike | null;
  };

const FORBIDDEN_ZKPASSPORT_KEYS = new Set([
  "proofs",
  "originalQuery",
  "queryResult",
  "committedInputs",
  "outerProof",
  "outerPublicInputs",
  "publicInputs",
  "paramCommitments",
  "parameterCommitments",
  "parameterCommitmentManifest",
  "nationalityDisclosureCommitment",
  "expiryDisclosureCommitment",
  "agePredicateCommitment",
  "bindCommitment",
  "nationality",
  "nationalityAlpha3",
  "passportExpiryDate",
  "expiryTs",
  "expiry_date",
  "uniqueIdentifier",
]);

const MAX_U8 = 255;
const MAX_U64 = (1n << 64n) - 1n;
const asciiEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !ArrayBuffer.isView(value);
}

function bigintFrom(value: ZkPassportSafeBigintLike, label: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a safe integer.`);
    }
    return BigInt(value);
  }
  if (!/^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)) {
    throw new Error(`${label} must be an unsigned bigint string.`);
  }
  return BigInt(value);
}

function u8From(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U8) {
    throw new Error(`${label} must be an integer in [0, 255].`);
  }
  return value;
}

function u64From(value: ZkPassportSafeBigintLike, label: string): bigint {
  const parsed = bigintFrom(value, label);
  if (parsed < 0n) {
    throw new Error(`${label} must be non-negative.`);
  }
  if (parsed > MAX_U64) {
    throw new Error(`${label} must fit in u64.`);
  }
  return parsed;
}

function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

function arrayPath(parent: string, index: number): string {
  return `${parent}[${index}]`;
}

function asciiBytes(value: string, label: string): number[] {
  const bytes = Array.from(asciiEncoder.encode(value));
  if (bytes.length !== value.length) {
    throw new Error(`${label} must contain ASCII characters only.`);
  }
  return bytes;
}

function canonicalExpiryTimestampFromMrz(mrzExpiry: string): bigint {
  if (!/^[0-9]{6}$/.test(mrzExpiry)) {
    throw new Error("expiry disclosure must be an MRZ YYMMDD date.");
  }
  const year = 2000 + Number(mrzExpiry.slice(0, 2));
  const month = Number(mrzExpiry.slice(2, 4));
  const day = Number(mrzExpiry.slice(4, 6));
  const ms = Date.UTC(year, month - 1, day, 23, 59, 59, 0);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error("expiry disclosure must be a valid MRZ YYMMDD date.");
  }
  return BigInt(Math.floor(ms / 1000));
}

function mrzExpiryFromTimestamp(expiryTs: ZkPassportSafeBigintLike): string {
  const parsed = u64From(expiryTs, "expiryTs");
  const expiryMs = parsed * 1000n;
  if (expiryMs > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("expiryTs is too large to convert to a UTC disclosure date.");
  }
  const date = new Date(Number(expiryMs));
  if (Number.isNaN(date.getTime())) {
    throw new Error("expiryTs must be a valid UTC timestamp.");
  }
  const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mrzExpiry = `${yy}${mm}${dd}`;
  if (canonicalExpiryTimestampFromMrz(mrzExpiry) !== parsed) {
    throw new Error("expiryTs must be the canonical end-of-day UTC timestamp for its MRZ date.");
  }
  return mrzExpiry;
}

function assertBigintLike(value: unknown, label: string): asserts value is ZkPassportSafeBigintLike {
  if (typeof value === "bigint") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a safe integer.`);
    }
    return;
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)) {
    return;
  }
  throw new Error(`${label} must be a bigint, safe integer, or unsigned bigint string.`);
}

function normalizeOuterPublicInputs(value: unknown, path: string): readonly ZkPassportSafeBigintLike[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array of public input field values.`);
  }
  value.forEach((entry, index) => assertBigintLike(entry, `${path}[${index}]`));
  return [...value];
}

export function extractZkPassportOuterProofUtilityMetadata(
  outerPublicInputs: readonly ZkPassportSafeBigintLike[],
): ZkPassportOuterProofUtilityMetadata {
  const proofData = {
    publicInputs: outerPublicInputs.map(value => value.toString()),
  } as Parameters<typeof getParamCommitmentsFromOuterProof>[0];

  return {
    parameterCommitments: getParamCommitmentsFromOuterProof(proofData).map(value => value.toString()),
    scopedNullifier: getNullifierFromOuterProof(proofData).toString(),
    nullifierType: getNullifierTypeFromOuterProof(proofData).toString(),
    scope: getScopeFromOuterProof(proofData).toString(),
    subscope: getSubscopeFromOuterProof(proofData).toString(),
  };
}

function verificationKeyFrom(
  proofContainer: Record<string, unknown>,
  rawProof: unknown,
): unknown {
  if (isRecord(rawProof)) {
    return rawProof.verificationKey ?? rawProof.verification_key ?? proofContainer.verificationKey ?? proofContainer.verification_key;
  }
  return proofContainer.verificationKey ?? proofContainer.verification_key;
}

function normalizeOuterProofArtifact(
  proofContainer: Record<string, unknown>,
  proofKey: "outerProof" | "proof",
  proofPath: string,
  publicInputsKey: "outerPublicInputs" | "publicInputs",
  publicInputsPath: string,
): ZkPassportOuterProofArtifacts {
  const rawProof = proofContainer[proofKey];
  const rawProofRecord = isRecord(rawProof) ? rawProof : undefined;
  const proof = rawProofRecord && "proof" in rawProofRecord ? rawProofRecord.proof : rawProof;
  const normalizedProofPath = rawProofRecord && "proof" in rawProofRecord ? childPath(proofPath, "proof") : proofPath;
  const verificationKey = verificationKeyFrom(proofContainer, rawProof);
  const outerPublicInputs = normalizeOuterPublicInputs(proofContainer[publicInputsKey], publicInputsPath);
  const zkPassportUtils =
    outerPublicInputs.length >= 8
      ? extractZkPassportOuterProofUtilityMetadata(outerPublicInputs)
      : { skipped: "insufficient_public_inputs" };
  const outerProof: ZkPassportOuterProofArtifact = {
    proof,
    metadata: {
      source: "zkpassport-completion",
      localOnly: true,
      proofPath: normalizedProofPath,
      publicInputsPath,
      proofKey,
      publicInputsKey,
      zkPassportUtils,
    },
  };

  if (verificationKey !== undefined) {
    outerProof.verificationKey = verificationKey;
  }

  return {
    outerProof,
    outerPublicInputs,
    shape: {
      proofPath: normalizedProofPath,
      publicInputsPath,
    },
  };
}

function tryExtractFromRecord(
  record: Record<string, unknown>,
  path: string,
): ZkPassportOuterProofArtifacts | undefined {
  const proofKeys = ["outerProof", "proof"] as const;
  const publicInputsKeys = ["outerPublicInputs", "publicInputs"] as const;

  for (const proofKey of proofKeys) {
    if (!(proofKey in record)) {
      continue;
    }
    for (const publicInputsKey of publicInputsKeys) {
      if (!(publicInputsKey in record)) {
        continue;
      }
      return normalizeOuterProofArtifact(
        record,
        proofKey,
        childPath(path, proofKey),
        publicInputsKey,
        childPath(path, publicInputsKey),
      );
    }
  }

  return undefined;
}

function assertByteArray(value: number[], label: string): void {
  for (const byte of value) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label} must contain bytes in [0, 255].`);
    }
  }
}

export function buildMinimalZkPassportWitnessFromDisclosures(
  input: MinimalZkPassportWitnessDisclosureInput,
): MinimalZkPassportWitness {
  if (!/^[A-Z]{3}$/.test(input.nationalityAlpha3)) {
    throw new Error("nationalityAlpha3 must be an uppercase ISO 3166-1 alpha-3 code.");
  }
  const minAge = u8From(input.agePredicate.minAge, "agePredicate.minAge");
  const maxAge = u8From(input.agePredicate.maxAge, "agePredicate.maxAge");
  if (maxAge < minAge) {
    throw new Error("agePredicate.maxAge must be greater than or equal to agePredicate.minAge.");
  }
  const nationalityBytes = asciiBytes(input.nationalityAlpha3, "nationalityAlpha3");
  const expiryBytes = asciiBytes(mrzExpiryFromTimestamp(input.expiryTs), "expiryTs");

  return {
    nationalityDisclosure: {
      discloseMask: nationalityBytes.map(() => 1),
      disclosedBytes: nationalityBytes,
    },
    expiryDisclosure: {
      discloseMask: expiryBytes.map(() => 1),
      disclosedBytes: expiryBytes,
    },
    agePredicate: {
      minAge,
      maxAge,
    },
    bind: {
      customData: input.bind.customData,
    },
  };
}

export function extractZkPassportOuterProofArtifacts(value: unknown): ZkPassportOuterProofArtifacts {
  const queue: Array<{ value: unknown; path: string }> = [{ value, path: "" }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => queue.push({ value: entry, path: arrayPath(current.path, index) }));
      continue;
    }
    if (!isRecord(current.value)) {
      continue;
    }

    const extracted = tryExtractFromRecord(current.value, current.path);
    if (extracted) {
      return extracted;
    }

    for (const [key, child] of Object.entries(current.value)) {
      if (Array.isArray(child) || isRecord(child)) {
        queue.push({ value: child, path: childPath(current.path, key) });
      }
    }
  }

  throw new Error("Could not find zkPassport outer proof and public inputs in the supplied local result.");
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

export async function buildPassportWrapperWitnessFromZkPassportResult(
  zkPassportResult: unknown,
  input: BuildPassportWrapperWitnessFromZkPassportResultInput,
): Promise<WalletPassportWrapperLocalWitness> {
  const extracted = extractZkPassportOuterProofArtifacts(zkPassportResult);
  const minimalZkPassportWitness = buildMinimalZkPassportWitnessFromDisclosures(input);
  const expectedParameterCommitmentManifest =
    await computeZkPassportParameterCommitmentManifest(minimalZkPassportWitness);

  return {
    zkPassportOuterProof: extracted.outerProof,
    zkPassportOuterPublicInputs: extracted.outerPublicInputs,
    minimalZkPassportWitness,
    nationalityAlpha3: input.nationalityAlpha3,
    expiryTs: input.expiryTs,
    minAgeProven: input.minAgeProven,
    credentialValidUntil: input.credentialValidUntil,
    agePredicate: { ...input.agePredicate },
    bind: { ...input.bind },
    nationalityBlind: input.nationalityBlind,
    expiryBlind: input.expiryBlind,
    scopedNullifier: input.scopedNullifier,
    expectedParameterCommitmentManifest,
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
