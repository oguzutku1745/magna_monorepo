import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";
import { Fq, Fr } from "@aztec/aztec.js/fields";
import { CredentialType } from "@magna/core";
import type {
  PassportA2Action,
  PassportWrapperLocalWitness,
  PassportWrapperProofArtifact,
  ZkPassportCompressedProof,
} from "@magna/passport-wrapper-proof/safe";
import {
  PASSPORT_A2_INNER_NAME,
} from "@magna/passport-wrapper-proof/safe";
import { deriveGhostKeyMaterial } from "../../../../packages/magna-wallet/src/engine/ghost";
import type { GhostDerivationVersion } from "../../../../packages/magna-wallet/src/engine/types";
import type {
  PassportA2ProofPayload,
  VerifyAndIssuePassportA2Payload,
  VerifyAndIssuePassportA2Response,
  ZkPassportCompletion,
} from "./zkpassport";

export type PassportIssuanceKind = "a2";
export type VerifiedPassportCompletion = Extract<ZkPassportCompletion, { status: "verified" }>;

export const PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE =
  "Passport A2 credential is missing its local committed-claims witness. Re-issue this passport credential on this device.";
export const REDISCOVERED_PASSPORT_WITNESS_MISSING_MESSAGE =
  "Passport note was found in PXE, but this browser is missing the local A2 committed-claims witness required to present it.";

const VALIDITY_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

type PassportMode = "passport" | "rooted";

type FacematchCommittedInputs = {
  rootKeyLeaf: string;
  environment: "development" | "production";
  appIdHash: string;
  integrityPubkeyHash: string;
  mode: "regular" | "strict";
};

type PassportIssuanceInput = {
  issuanceKind: PassportIssuanceKind;
  verificationApiUrl: string;
  completion: VerifiedPassportCompletion;
  activeOwner: string;
  issuerAddress: string;
  ageThreshold: number;
  mode: PassportMode;
  ghostDerivationVersion: GhostDerivationVersion;
  preparedGhostOwner?: string;
  requestScope?: string;
  a2BindCustomData: string;
};

type GhostPreview = {
  address: string;
};

type DeriveGhostAccountPreview = (input: {
  uniqueIdentifier: string;
  credentialType: CredentialType;
  derivationVersion?: GhostDerivationVersion;
}) => Promise<GhostPreview>;

type ProvePassportWrapperFn = (
  witness: PassportWrapperLocalWitness,
) => Promise<PassportWrapperProofArtifact>;

type VerifyAndIssuePassportA2ThroughBackendFn = (
  verificationApiUrl: string,
  payload: VerifyAndIssuePassportA2Payload,
) => Promise<VerifyAndIssuePassportA2Response>;

type PassportIssuanceDependencies = {
  verifyAndIssuePassportA2ThroughBackend: VerifyAndIssuePassportA2ThroughBackendFn;
  provePassportWrapper: ProvePassportWrapperFn;
  deriveGhostAccountPreview?: DeriveGhostAccountPreview;
  randomField?: () => bigint;
  nowMs?: () => number;
  onA2Progress?: (event: PassportA2ProgressEvent) => void;
};

export type PassportA2ProgressEvent =
  | { type: "building_witness" }
  | { type: "generating_wrapper_proof" }
  | { type: "submitting_to_backend" };

export type PassportA2LocalWitness = {
  witness: PassportWrapperLocalWitness;
  wrapperPublicInputs: string[];
};

export type PassportA2ProofMaterial = {
  payload: PassportA2ProofPayload;
  localWitness: PassportA2LocalWitness;
};

export type PassportIssuanceResult = {
  issuanceKind: "a2";
  response: VerifyAndIssuePassportA2Response;
  localWitness: PassportA2LocalWitness;
};

function readPath(value: unknown, path: Array<string | number>): unknown {
  let cursor = value;
  for (const segment of path) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

export function localDisclosures(completion: VerifiedPassportCompletion, ageThreshold: number): {
  nationalityAlpha3: string;
  expiryTs: bigint;
  minAgeProven: number;
} {
  if (readPath(completion.queryResult, ["age", "gte", "result"]) !== true) {
    throw new Error("zkPassport query result did not satisfy age.gte.");
  }
  const nationalityAlpha3 = requireString(
    readPath(completion.queryResult, ["nationality", "disclose", "result"]),
    "queryResult.nationality.disclose.result",
  ).toUpperCase();
  if (!/^[A-Z]{3}$/.test(nationalityAlpha3)) {
    throw new Error("zkPassport nationality must be an ISO alpha-3 code.");
  }
  const expiryValue = readPath(completion.queryResult, ["expiry_date", "disclose", "result"]);
  const expiryDate = expiryValue instanceof Date ? expiryValue : new Date(requireString(expiryValue, "expiry_date"));
  if (Number.isNaN(expiryDate.getTime())) {
    throw new Error("zkPassport expiry_date must be a valid date.");
  }
  const expiryTs = BigInt(
    Date.UTC(
      expiryDate.getUTCFullYear(),
      expiryDate.getUTCMonth(),
      expiryDate.getUTCDate(),
      23,
      59,
      59,
    ) / 1000,
  );
  return { nationalityAlpha3, expiryTs, minAgeProven: ageThreshold };
}

export function secureRandomField(): bigint {
  const bytes = new Uint8Array(32);
  for (;;) {
    globalThis.crypto.getRandomValues(bytes);
    const candidate = BigInt(`0x${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`);
    if (candidate > 0n && candidate < FIELD_MODULUS) return candidate;
  }
}

function fieldFromHexString(value: string, label: string): Fr {
  try {
    return Fr.fromHexString(value.startsWith("0x") ? value : `0x${value}`);
  } catch {
    throw new Error(`${label} must be a valid field-compatible hex string.`);
  }
}

async function deriveGhostPreview(input: {
  uniqueIdentifier: string;
  credentialType: CredentialType;
  derivationVersion?: GhostDerivationVersion;
}): Promise<GhostPreview> {
  const material = deriveGhostKeyMaterial(input);
  const address = await getSchnorrAccountContractAddress(
    Fq.fromHexString(`0x${material.signingKeyHex}`),
    fieldFromHexString(material.saltHex, "Ghost salt"),
  );
  return { address: address.toString() };
}

export function compressedOuterProof(completion: VerifiedPassportCompletion): ZkPassportCompressedProof {
  const proof = completion.proofs.find(candidate => candidate.name === PASSPORT_A2_INNER_NAME);
  if (
    !proof ||
    typeof proof.proof !== "string" ||
    typeof proof.name !== "string" ||
    typeof proof.version !== "string" ||
    typeof proof.vkeyHash !== "string"
  ) {
    throw new Error(`zkPassport did not return the required ${PASSPORT_A2_INNER_NAME} compressed proof.`);
  }
  return {
    proof: proof.proof,
    name: proof.name,
    version: proof.version,
    vkeyHash: proof.vkeyHash,
    index: proof.index,
    total: proof.total,
  };
}

export function profileFacematch(
  completion: VerifiedPassportCompletion,
): FacematchCommittedInputs & { environment: "production" } {
  if (completion.proofProfile !== "development" && completion.proofProfile !== "production") {
    throw new Error("zkPassport proof profile must be explicitly development or production.");
  }
  // In compressed mode zkPassport folds the disclosure proofs into one
  // outer_count_* proof and merges each disclosure's committed inputs onto it.
  // FaceMatch is therefore identified by the committed-input key, not by the
  // outer proof's circuit name.
  const facematchContainers = completion.proofs.filter(
    candidate => candidate.committedInputs?.facematch !== undefined,
  );
  if (facematchContainers.length !== 1) {
    throw new Error(
      `zkPassport must return exactly one authenticated facematch committed-input set; received ${facematchContainers.length}.`,
    );
  }
  const committedInputs = facematchContainers[0].committedInputs!
    .facematch as FacematchCommittedInputs;
  const expectedMode = completion.proofProfile === "development" ? "regular" : "strict";
  if (committedInputs.environment !== "production" || committedInputs.mode !== expectedMode) {
    throw new Error(
      `zkPassport facematch must use the production environment in ${expectedMode} mode for the ${completion.proofProfile} profile.`,
    );
  }
  return { ...committedInputs, environment: "production" };
}

function proofForJson(artifact: PassportWrapperProofArtifact): unknown {
  const bytes = artifact.proof.proof;
  return {
    proof: `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`,
    publicInputs: artifact.publicInputs,
  };
}

const FORBIDDEN_NETWORK_KEYS = new Set([
  "proofs",
  "outerProof",
  "zkPassportOuterProof",
  "outerPublicInputs",
  "zkPassportOuterPublicInputs",
  "queryResult",
  "originalQuery",
  "committedInputs",
  "uniqueIdentifier",
  "scopedNullifier",
  "nationalityAlpha3",
  "expiryTs",
  "nationalityBlind",
  "expiryBlind",
  "localWitness",
  "hintedRootStatusNote",
  "hintedRootAuthorityNote",
]);

export function assertNoPassportA2PrivateArtifacts(value: unknown): void {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (FORBIDDEN_NETWORK_KEYS.has(key)) {
        throw new Error(`Private passport artifact is forbidden in the API payload: ${key}`);
      }
      stack.push(child);
    }
  }
}

export function proofModeForPassportIssuanceKind(_kind: PassportIssuanceKind): "compressed" {
  return "compressed";
}

export function passportA2BindCustomData(input: {
  action: PassportA2Action;
  activeOwner: string;
  requestScope?: string;
}): string {
  const scope = input.requestScope?.trim() || "magna-passport-onboarding";
  const customData = `magna-passport-a2:${input.action}:${scope}:${input.activeOwner.trim().toLowerCase()}`;
  if ([...customData].some(char => char.charCodeAt(0) > 0x7f)) {
    throw new Error("Passport A2 bind data must be ASCII.");
  }
  return customData;
}

export function passportCredentialUsageBlock(
  credential:
    | { issuanceKind?: PassportIssuanceKind; passportCommittedClaimsV2Witness?: unknown }
    | null
    | undefined,
): string | undefined {
  if (!credential || credential.passportCommittedClaimsV2Witness) return undefined;
  return credential.issuanceKind === "a2"
    ? PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE
    : REDISCOVERED_PASSPORT_WITNESS_MISSING_MESSAGE;
}

export async function buildPassportA2ProofMaterial(
  input: PassportIssuanceInput & { action: PassportA2Action; ghostOwner: string },
  dependencies: Pick<PassportIssuanceDependencies, "provePassportWrapper" | "randomField" | "nowMs" | "onA2Progress">,
): Promise<PassportA2ProofMaterial> {
  dependencies.onA2Progress?.({ type: "building_witness" });
  const disclosures = localDisclosures(input.completion, input.ageThreshold);
  const nowSeconds = BigInt(Math.floor((dependencies.nowMs ?? Date.now)() / 1000));
  const credentialValidUntil =
    nowSeconds + BigInt(VALIDITY_WINDOW_SECONDS) < disclosures.expiryTs
      ? nowSeconds + BigInt(VALIDITY_WINDOW_SECONDS)
      : disclosures.expiryTs;
  const randomField = dependencies.randomField ?? secureRandomField;
  const facematch = profileFacematch(input.completion);
  const witness: PassportWrapperLocalWitness = {
    profile: input.completion.proofProfile,
    zkPassportOuterProof: compressedOuterProof(input.completion),
    nationalityAlpha3: disclosures.nationalityAlpha3,
    expiryTs: disclosures.expiryTs,
    minAgeProven: disclosures.minAgeProven,
    agePredicate: { minAge: disclosures.minAgeProven, maxAge: 0 },
    bind: { customData: input.a2BindCustomData },
    facematch: {
      rootKeyLeaf: facematch.rootKeyLeaf,
      environment: facematch.environment,
      appIdHash: facematch.appIdHash,
      integrityPublicKeyHash: facematch.integrityPubkeyHash,
      mode: facematch.mode,
    },
    credentialValidUntil,
    nationalityBlind: randomField(),
    expiryBlind: randomField(),
    requestContext: {
      action: input.action,
      issuer: input.issuerAddress,
      owner: input.activeOwner,
      ghostOwner: input.ghostOwner,
      credentialMode: input.mode,
    },
  };
  dependencies.onA2Progress?.({ type: "generating_wrapper_proof" });
  const wrapper = await dependencies.provePassportWrapper(witness);
  const payload: PassportA2ProofPayload = {
    schema: "passport-a2-v1",
    credentialValidUntil: wrapper.outputs.credentialValidUntil,
    wrapperProof: proofForJson(wrapper),
    wrapperPublicInputs: wrapper.publicInputs,
    registryContext: wrapper.metadata.registryContext,
  };
  assertNoPassportA2PrivateArtifacts(payload);
  return { payload, localWitness: { witness, wrapperPublicInputs: wrapper.publicInputs } };
}

export async function issuePassportThroughConfiguredBackend(
  input: PassportIssuanceInput,
  dependencies: PassportIssuanceDependencies,
): Promise<PassportIssuanceResult> {
  if (!input.completion.uniqueIdentifier) {
    throw new Error("zkPassport verification succeeded without a unique identifier.");
  }
  const preview = await (dependencies.deriveGhostAccountPreview ?? deriveGhostPreview)({
    uniqueIdentifier: input.completion.uniqueIdentifier,
    credentialType: CredentialType.Passport,
    derivationVersion: input.ghostDerivationVersion,
  });
  const ghostOwner = input.preparedGhostOwner ?? preview.address;
  const proofMaterial = await buildPassportA2ProofMaterial(
    { ...input, action: "issue", ghostOwner },
    dependencies,
  );
  const payload: VerifyAndIssuePassportA2Payload = {
    ...proofMaterial.payload,
    activeOwner: input.activeOwner,
    ghostOwner,
    mode: input.mode,
    ghostDerivationVersion: input.ghostDerivationVersion,
  };
  assertNoPassportA2PrivateArtifacts(payload);
  dependencies.onA2Progress?.({ type: "submitting_to_backend" });
  return {
    issuanceKind: "a2",
    response: await dependencies.verifyAndIssuePassportA2ThroughBackend(input.verificationApiUrl, payload),
    localWitness: proofMaterial.localWitness,
  };
}
