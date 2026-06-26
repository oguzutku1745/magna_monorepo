import {
  computePassportCommittedClaimsHash,
  computePassportExpiryCommitment,
  computePassportNationalityCommitment,
  poseidon2FieldHasher,
} from "../../../../packages/magna-wallet/src/engine/encoding";
import { deriveGhostKeyMaterial } from "../../../../packages/magna-wallet/src/engine/ghost";
import { deriveRootCommitment } from "../../../../packages/magna-wallet/src/engine/root";
import type { GhostDerivationVersion, GhostKeyMaterial } from "../../../../packages/magna-wallet/src/engine/types";
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";
import { Fr } from "@aztec/aztec.js/fields";
import { CredentialType } from "@magna/core";
import type {
  VerifyAndIssuePassportPilotPayload,
  VerifyAndIssuePassportPilotResponse,
  VerifyAndIssueResponse,
  ZkPassportCompletion,
} from "./zkpassport";

export type PassportIssuanceKind = "legacy" | "pilot" | "a1";
export type VerifiedPassportCompletion = Extract<ZkPassportCompletion, { status: "verified" }>;

export const A1_UNAVAILABLE_MESSAGE = "A1 wrapper issuance is not available yet.";
export const PILOT_CREDENTIAL_UNUSABLE_MESSAGE =
  "Pilot or rediscovered passport credentials cannot be used for relying-party verification, renewal, or recovery until A1/v2 presentation support is enabled. Re-issue with A1/v2 support before using this credential.";

const PILOT_SCHEMA = "passport-pii-blind-v0";
const PILOT_VALIDITY_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const AZTEC_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

type PassportMode = "passport" | "rooted";
type ProofMode = "fast" | "compressed" | "compressed-evm";

type PassportIssuanceInput = {
  issuanceKind: PassportIssuanceKind;
  verificationApiUrl: string;
  completion: VerifiedPassportCompletion;
  activeOwner: string;
  ageThreshold: number;
  mode: PassportMode;
  ghostDerivationVersion: GhostDerivationVersion;
  preparedGhostOwner?: string;
};

type PassportIssuanceDependencies = {
  verifyAndIssueThroughBackend: VerifyAndIssueThroughBackendFn;
  verifyAndIssuePassportPilotThroughBackend: VerifyAndIssuePassportPilotThroughBackendFn;
  deriveGhostAccountPreview?: DeriveGhostAccountPreview;
  randomField?: () => bigint;
  nowMs?: () => number;
};

type GhostPreview = {
  address: string;
  uniqueIdentifier: string;
  material: GhostKeyMaterial;
  rootCommitment?: bigint;
};

type DeriveGhostAccountPreview = (input: {
  uniqueIdentifier: string;
  credentialType: CredentialType;
  derivationVersion?: GhostDerivationVersion;
}) => Promise<GhostPreview>;

type PassportIssuanceResult =
  | { issuanceKind: "legacy"; response: VerifyAndIssueResponse }
  | { issuanceKind: "pilot"; response: VerifyAndIssuePassportPilotResponse };

type VerifyAndIssueThroughBackendFn = (
  verificationApiUrl: string,
  payload: {
    proofs: VerifiedPassportCompletion["proofs"];
    originalQuery: VerifiedPassportCompletion["originalQuery"];
    queryResult: VerifiedPassportCompletion["queryResult"];
    activeOwner: string;
    ageThreshold: number;
    mode?: PassportMode;
    ghostDerivationVersion?: GhostDerivationVersion;
  },
) => Promise<VerifyAndIssueResponse>;

type VerifyAndIssuePassportPilotThroughBackendFn = (
  verificationApiUrl: string,
  payload: VerifyAndIssuePassportPilotPayload,
) => Promise<VerifyAndIssuePassportPilotResponse>;

export function proofModeForPassportIssuanceKind(kind: PassportIssuanceKind): ProofMode | undefined {
  if (kind === "legacy") return undefined;
  if (kind === "pilot") return "compressed-evm";
  throw new Error(A1_UNAVAILABLE_MESSAGE);
}

export function passportPilotCredentialUsageBlock(
  credential:
    | {
        issuanceKind?: PassportIssuanceKind;
        normalizedClaims?: unknown;
      }
    | null
    | undefined,
): string | undefined {
  if (!credential) return undefined;
  if (credential.issuanceKind === "legacy") return undefined;
  if (credential.issuanceKind === "pilot" || credential.issuanceKind === "a1") {
    return PILOT_CREDENTIAL_UNUSABLE_MESSAGE;
  }
  if (credential.normalizedClaims) return undefined;
  return PILOT_CREDENTIAL_UNUSABLE_MESSAGE;
}

function readPath(value: unknown, path: Array<string | number>): unknown {
  let cursor = value;
  for (const segment of path) {
    if (cursor === null || cursor === undefined || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  return cursor;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return trimmed;
}

function normalizeIsoDateString(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date string.`);
  }
  return date.toISOString().slice(0, 10);
}

function requireIsoDateLike(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    return normalizeIsoDateString(value, fieldName);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${fieldName} must be a valid date.`);
    }
    return value.toISOString().slice(0, 10);
  }
  if (!value || typeof value !== "object") {
    throw new Error(`${fieldName} must be a string or date-like value.`);
  }

  const isoCandidate =
    readPath(value, ["iso"]) ??
    readPath(value, ["value"]) ??
    readPath(value, ["date"]) ??
    readPath(value, ["formatted"]);
  if (typeof isoCandidate === "string") {
    return normalizeIsoDateString(isoCandidate, fieldName);
  }

  const year = readPath(value, ["year"]);
  const month = readPath(value, ["month"]);
  const day = readPath(value, ["day"]);
  if (
    typeof year === "number" &&
    Number.isInteger(year) &&
    typeof month === "number" &&
    Number.isInteger(month) &&
    typeof day === "number" &&
    Number.isInteger(day)
  ) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(`${fieldName} must be a valid calendar date.`);
    }
    return date.toISOString().slice(0, 10);
  }

  throw new Error(`${fieldName} must be a string or date-like value.`);
}

function parseIsoDateToExpiryTs(value: string): bigint {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("expiry_date must be a valid date string.");
  }
  const endOfDayUtcMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 0);
  return BigInt(Math.floor(endOfDayUtcMs / 1000));
}

function normalizeNationality(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("Disclosed nationality must be an alpha-3 country code (e.g. TUR, USA, DEU).");
  }
  return normalized;
}

function parseAgeThreshold(queryResult: unknown, override: number): number {
  if (Number.isFinite(override)) {
    return Number(override);
  }
  const expected = readPath(queryResult, ["age", "gte", "expected"]);
  if (typeof expected === "number" && Number.isFinite(expected)) {
    return expected;
  }
  if (typeof expected === "string" && expected.trim()) {
    const parsed = Number.parseInt(expected, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error("Could not determine age threshold from zkPassport result.");
}

function randomField(): bigint {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random generation is unavailable for passport pilot issuance.");
  }

  const bytes = new Uint8Array(32);
  for (;;) {
    cryptoApi.getRandomValues(bytes);
    const candidate = BigInt(`0x${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`);
    if (candidate > 0n && candidate < AZTEC_FIELD_MODULUS) {
      return candidate;
    }
  }
}

function fieldFromHexString(value: string, label: string): Fr {
  try {
    return Fr.fromHexString(value.startsWith("0x") ? value : `0x${value}`);
  } catch {
    throw new Error(`${label} must be a valid field-compatible hex string.`);
  }
}

async function derivePilotGhostAccountPreview(input: {
  uniqueIdentifier: string;
  credentialType: CredentialType;
  derivationVersion?: GhostDerivationVersion;
}): Promise<GhostPreview> {
  const material = deriveGhostKeyMaterial(input);
  const address = await getSchnorrAccountContractAddress(
    fieldFromHexString(material.secretHex, "Ghost secret"),
    fieldFromHexString(material.saltHex, "Ghost salt"),
  );
  return {
    address: address.toString(),
    uniqueIdentifier: input.uniqueIdentifier,
    material,
    rootCommitment: deriveRootCommitment({ uniqueIdentifier: input.uniqueIdentifier }),
  };
}

function localPilotClaims(queryResult: unknown, ageThreshold: number, nextRandomField: () => bigint): bigint {
  const ageResult = readPath(queryResult, ["age", "gte", "result"]);
  if (ageResult !== true) {
    throw new Error("zkPassport query result did not satisfy age.gte.");
  }

  const nationalityAlpha3 = normalizeNationality(
    requireString(readPath(queryResult, ["nationality", "disclose", "result"]), "queryResult.nationality.disclose.result"),
  );
  const expiryDate = requireIsoDateLike(
    readPath(queryResult, ["expiry_date", "disclose", "result"]),
    "queryResult.expiry_date.disclose.result",
  );
  const minAgeProven = parseAgeThreshold(queryResult, ageThreshold);
  const expiryTs = parseIsoDateToExpiryTs(expiryDate);
  const nationalityCommitment = computePassportNationalityCommitment(
    nationalityAlpha3,
    nextRandomField(),
    poseidon2FieldHasher,
  );
  const expiryCommitment = computePassportExpiryCommitment(expiryTs, nextRandomField(), poseidon2FieldHasher);

  return computePassportCommittedClaimsHash(
    {
      schemaVersion: 2,
      credentialType: CredentialType.Passport,
      nationalityCommitment,
      minAgeProven,
      expiryCommitment,
    },
    poseidon2FieldHasher,
  );
}

async function derivePilotGhost(input: {
  uniqueIdentifier: string | undefined;
  credentialType: CredentialType;
  ghostDerivationVersion: GhostDerivationVersion;
  preparedGhostOwner?: string;
  deriveGhostAccountPreview: DeriveGhostAccountPreview;
}): Promise<{ ghostOwner: string; rootCommitment: bigint }> {
  if (!input.uniqueIdentifier) {
    throw new Error("zkPassport verification succeeded but uniqueIdentifier is missing for pilot issuance.");
  }
  const preview = await input.deriveGhostAccountPreview({
    uniqueIdentifier: input.uniqueIdentifier,
    credentialType: input.credentialType,
    derivationVersion: input.ghostDerivationVersion,
  });
  return {
    ghostOwner: input.preparedGhostOwner ?? preview.address,
    rootCommitment: preview.rootCommitment ?? deriveRootCommitment({ uniqueIdentifier: input.uniqueIdentifier }),
  };
}

export async function issuePassportThroughConfiguredBackend(
  input: PassportIssuanceInput,
  dependencies: PassportIssuanceDependencies,
): Promise<PassportIssuanceResult> {
  if (input.issuanceKind === "a1") {
    throw new Error(A1_UNAVAILABLE_MESSAGE);
  }

  if (input.issuanceKind === "legacy") {
    return {
      issuanceKind: "legacy",
      response: await dependencies.verifyAndIssueThroughBackend(input.verificationApiUrl, {
        proofs: input.completion.proofs,
        originalQuery: input.completion.originalQuery,
        queryResult: input.completion.queryResult,
        activeOwner: input.activeOwner,
        ageThreshold: input.ageThreshold,
        mode: input.mode,
        ghostDerivationVersion: input.ghostDerivationVersion,
      }),
    };
  }

  const nextRandomField = dependencies.randomField ?? randomField;
  const claimsHash = localPilotClaims(input.completion.queryResult, input.ageThreshold, nextRandomField);
  const ghost = await derivePilotGhost({
    uniqueIdentifier: input.completion.uniqueIdentifier,
    credentialType: CredentialType.Passport,
    ghostDerivationVersion: input.ghostDerivationVersion,
    preparedGhostOwner: input.preparedGhostOwner,
    deriveGhostAccountPreview: dependencies.deriveGhostAccountPreview ?? derivePilotGhostAccountPreview,
  });
  const nowMs = dependencies.nowMs ?? Date.now;
  const credentialValidUntil = Math.floor(nowMs() / 1000) + PILOT_VALIDITY_WINDOW_SECONDS;

  return {
    issuanceKind: "pilot",
    response: await dependencies.verifyAndIssuePassportPilotThroughBackend(input.verificationApiUrl, {
      pilotSchema: PILOT_SCHEMA,
      activeOwner: input.activeOwner,
      claimsHash: claimsHash.toString(),
      ghostOwner: ghost.ghostOwner,
      rootCommitment: ghost.rootCommitment.toString(),
      credentialValidUntil: credentialValidUntil.toString(),
      mode: input.mode,
      ghostDerivationVersion: input.ghostDerivationVersion,
    }),
  };
}
