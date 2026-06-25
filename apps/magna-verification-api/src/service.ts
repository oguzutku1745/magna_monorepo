import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractArtifact } from "@aztec/aztec.js/abi";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient, waitForNode, type AztecNode } from "@aztec/aztec.js/node";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { contractInstanceWithAddressFromPlainObject } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import {
  assertNoZkPassportPrivateArtifacts,
  computeInstagramClaimsHash,
  computeInstagramHandleHash,
  computePassportClaimsHash,
  CredentialType,
  deriveGhostKeyMaterial,
  deriveRootCommitment,
  poseidon2FieldHasher,
  packAlpha3,
  type GhostDerivationVersion,
  type InstagramCanonicalClaims,
  type PassportCanonicalClaims,
} from "@magna/wallet";
import { MagnaIssuerContract } from "@magna/contracts-bindings";
import type { ProofResult, Query, QueryResult } from "@zkpassport/sdk";
import { proveInstagramEmail, type InstagramProofArtifact } from "@magna/instagram-proof";

export type VerificationMode = "passport" | "rooted";

export const PASSPORT_PII_BLIND_PILOT_SCHEMA = "passport-pii-blind-v0" as const;

export type VerificationApiConfig = {
  port: number;
  allowedOrigin: string;
  zkPassportDomain: string;
  zkPassportScope: string;
  zkPassportDevMode: boolean;
  aztecNodeUrl: string;
  issuerAddress: string;
  localTestAccountIndex: number;
  orchestratorAddress?: string;
};

export type VerifyAndIssueRequest = {
  proofs: ProofResult[];
  originalQuery: Query;
  queryResult: QueryResult;
  activeOwner: string;
  ageThreshold?: number;
  mode?: VerificationMode;
  ghostDerivationVersion?: GhostDerivationVersion;
};

export type VerifyAndIssuePassportPilotRequest = {
  pilotSchema: typeof PASSPORT_PII_BLIND_PILOT_SCHEMA;
  activeOwner: string;
  claimsHash: string;
  ghostOwner: string;
  rootCommitment: string;
  credentialValidUntil: string;
  mode?: VerificationMode;
  ghostDerivationVersion?: GhostDerivationVersion;
};

export type VerifyAndIssueInstagramRequest = {
  emlBase64: string;
  claimedHandle: string;
  activeOwner: string;
  expiryTs?: string | number | bigint;
  ghostDerivationVersion?: GhostDerivationVersion;
};

export type VerifyAndRefreshRootAuthorityRequest = {
  proofs: ProofResult[];
  originalQuery: Query;
  queryResult: QueryResult;
  ghostOwner: string;
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
  ageThreshold?: number;
};

export type VerifyRootRecoveryPreflightRequest = {
  proofs: ProofResult[];
  originalQuery: Query;
  queryResult: QueryResult;
  expectedGhostOwner: string;
  expectedRootCommitment: string;
  ghostDerivationVersion?: GhostDerivationVersion;
  ageThreshold?: number;
};

type VerifyAndIssuePassportResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  mode: VerificationMode;
  ghostDerivationVersion: GhostDerivationVersion;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    uniqueIdentifierPresent: true;
  };
  normalizedClaims: {
    nationalityAlpha3: string;
    minAgeProven: number;
    passportExpiryDate: string;
    expiryTs: string;
  };
};

type VerifyAndIssuePassportPilotResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  mode: VerificationMode;
  ghostDerivationVersion: GhostDerivationVersion;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    pilot: true;
    piiBlind: true;
  };
};

export type VerifyAndIssueResponse = VerifyAndIssuePassportResponse | VerifyAndIssuePassportPilotResponse;

export type VerifyAndIssueInstagramResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  claimsHash: string;
  ghostDerivationVersion: GhostDerivationVersion;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    dkimPubkeyHash: string;
    emailNullifier: string;
  };
  normalizedClaims: {
    instagramHandle: string;
    handleHash: string;
    handleLen: number;
    handlePacked: string;
    expiryTs: string;
  };
};

export type VerifyAndRefreshRootAuthorityResponse = {
  renewalTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    uniqueIdentifierPresent: true;
  };
  normalizedClaims: {
    nationalityAlpha3: string;
    minAgeProven: number;
    passportExpiryDate: string;
    expiryTs: string;
  };
};

export type VerifyRootRecoveryPreflightResponse = {
  expectedGhostOwner: string;
  derivedGhostOwner: string;
  expectedRootCommitment: string;
  derivedRootCommitment: string;
  ghostDerivationVersion: GhostDerivationVersion;
  matchesExpectedGhostOwner: true;
  matchesExpectedRootCommitment: true;
  verificationSummary: {
    verified: true;
    uniqueIdentifierPresent: true;
  };
  normalizedClaims: {
    nationalityAlpha3: string;
    minAgeProven: number;
    passportExpiryDate: string;
    expiryTs: string;
  };
};

type IssuanceContext = {
  wallet: EmbeddedWallet;
  issuer: MagnaIssuerContract;
  orchestratorAddress: AztecAddress;
};

type ZkPassportVerificationResult = {
  verified: boolean;
  uniqueIdentifier?: string;
};

const require = createRequire(import.meta.url);

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function requiredEnv(names: string[]): string {
  const value = readFirstEnv(names);
  if (!value) {
    throw new Error(`${names.join(" or ")} is required.`);
  }
  return value;
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf8");
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function manifestString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function manifestStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(manifestString).filter((entry): entry is string => Boolean(entry));
  }
  const asString = manifestString(value);
  return asString
    ? asString
        .split(",")
        .map(entry => entry.trim())
        .filter(Boolean)
    : [];
}

export function deploymentManifestEnvEntries(manifest: unknown): Record<string, string> {
  const l2 = readPath(manifest, ["l2"]);
  const endpoints = readPath(manifest, ["endpoints"]);
  const entries: Record<string, string> = {};

  const aztecNodeUrl = manifestString(readPath(endpoints, ["aztecNodeUrl"]));
  if (aztecNodeUrl) {
    entries.MAGNA_AZTEC_NODE_URL = aztecNodeUrl;
    entries.VITE_AZTEC_NODE_URL = aztecNodeUrl;
  }

  const issuerAddress = manifestString(readPath(l2, ["issuerAddress"]));
  if (issuerAddress) {
    entries.MAGNA_ISSUER_ADDRESS = issuerAddress;
    entries.VITE_MAGNA_ISSUER_ADDRESS = issuerAddress;
  }

  const companySponsorAddress = manifestString(readPath(l2, ["companySponsorAddress"]));
  if (companySponsorAddress) {
    entries.VITE_MAGNA_COMPANY_SPONSOR_ADDRESS = companySponsorAddress;
  }

  const companySponsorAddresses = manifestStringList(readPath(l2, ["companySponsorAddresses"]));
  if (companySponsorAddresses.length > 0) {
    entries.VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES = companySponsorAddresses.join(",");
  }

  const activeCompanySponsorAddress = manifestString(readPath(l2, ["activeCompanySponsorAddress"]));
  if (activeCompanySponsorAddress) {
    entries.VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS = activeCompanySponsorAddress;
  }

  const orchestratorAddress = manifestString(readPath(l2, ["adminAddress"]));
  if (orchestratorAddress) {
    entries.MAGNA_ORCHESTRATOR_ADDRESS = orchestratorAddress;
    entries.VITE_MAGNA_ORCHESTRATOR_ADDRESS = orchestratorAddress;
  }

  return entries;
}

function resolveDeploymentManifestPath(repoRoot: string): string | undefined {
  const explicitPath = readFirstEnv(["MAGNA_DEPLOYMENT_MANIFEST", "VITE_MAGNA_DEPLOYMENT_MANIFEST"]);
  if (explicitPath) {
    return resolve(repoRoot, explicitPath);
  }
  const useLocalManifest = parseBoolean(
    readFirstEnv(["MAGNA_USE_LOCAL_DEPLOYMENT_MANIFEST", "VITE_MAGNA_ENABLE_LOCAL_TEST_BOOTSTRAP"]),
    false,
  );
  return useLocalManifest ? resolve(repoRoot, "deployments/local.json") : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isArtifactClassMismatch(error: unknown): boolean {
  return errorMessage(error).includes("Artifact does not match expected class id");
}

export function buildStaleIssuerDeploymentMessage(issuerAddress: string, causeMessage?: string): string {
  return [
    `Configured Magna issuer ${issuerAddress} was deployed with a different contract class than the current artifact.`,
    "This usually means local Aztec chain state, deployment env, and compiled contracts drifted after a branch switch or contract rebuild.",
    "Run `npm run web:bootstrap:local -- --skip-rights-deploy`, then restart `npm run verification-api:dev` and the frontend dev server.",
    causeMessage ? `Aztec details: ${causeMessage}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export function applyHydratedEnvEntries(
  entries: Record<string, string>,
  target: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(entries)) {
    target[key] = value;
  }
}

export function hydrateVerificationApiEnvFromFiles(): void {
  const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const candidatePaths = [
    resolve(repoRoot, "apps/magna-web/.env"),
    resolve(repoRoot, "apps/magna-web/.env.local"),
    resolve(repoRoot, "apps/magna-verification-api/.env"),
    resolve(repoRoot, "apps/magna-verification-api/.env.local"),
  ];

  for (const path of candidatePaths) {
    const parsed = parseEnvFile(path);
    applyHydratedEnvEntries(parsed);
  }

  const manifestPath = resolveDeploymentManifestPath(repoRoot);
  if (manifestPath && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    applyHydratedEnvEntries(deploymentManifestEnvEntries(manifest));
  }
}

export function loadVerificationApiConfigFromEnv(): VerificationApiConfig {
  return {
    port: parseNumber(process.env.MAGNA_VERIFICATION_API_PORT, 4310),
    allowedOrigin: process.env.MAGNA_VERIFICATION_ALLOWED_ORIGIN?.trim() || "*",
    // For local dev we default to localhost if no explicit domain is provided.
    zkPassportDomain: readFirstEnv(["MAGNA_ZKPASSPORT_DOMAIN"]) ?? "localhost",
    zkPassportScope:
      readFirstEnv(["MAGNA_ZKPASSPORT_SCOPE", "VITE_MAGNA_ZKPASSPORT_REQUEST_SCOPE"]) ?? "magna-passport-onboarding",
    zkPassportDevMode: parseBoolean(
      readFirstEnv(["MAGNA_ZKPASSPORT_DEV_MODE", "VITE_MAGNA_ZKPASSPORT_DEV_MODE"]),
      false,
    ),
    aztecNodeUrl: readFirstEnv(["MAGNA_AZTEC_NODE_URL", "VITE_AZTEC_NODE_URL"]) ?? "http://localhost:8080",
    issuerAddress: requiredEnv(["MAGNA_ISSUER_ADDRESS", "VITE_MAGNA_ISSUER_ADDRESS"]),
    localTestAccountIndex: parseNumber(
      readFirstEnv(["MAGNA_LOCAL_TEST_ACCOUNT_INDEX", "VITE_MAGNA_LOCAL_TEST_ACCOUNT_INDEX"]),
      0,
    ),
    orchestratorAddress: parseOptionalString(
      readFirstEnv(["MAGNA_ORCHESTRATOR_ADDRESS", "VITE_MAGNA_ORCHESTRATOR_ADDRESS"]),
    ),
  };
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

function parseAgeThreshold(queryResult: unknown, override?: number): number {
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
  throw new Error("Could not determine age threshold from zkPassport result. Provide ageThreshold in request.");
}

function normalizeNationality(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("Disclosed nationality must be an alpha-3 country code (e.g. TUR, USA, DEU).");
  }
  return normalized;
}

export function normalizePassportClaimsFromQueryResult(
  queryResult: unknown,
  ageThresholdOverride?: number,
): {
  claims: PassportCanonicalClaims;
  nationalityAlpha3: string;
  passportExpiryDate: string;
} {
  const ageResult = readPath(queryResult, ["age", "gte", "result"]);
  if (ageResult !== true) {
    throw new Error("zkPassport query result did not satisfy age.gte.");
  }

  const nationalityDisclosed = requireString(
    readPath(queryResult, ["nationality", "disclose", "result"]),
    "queryResult.nationality.disclose.result",
  );
  const expiryDisclosed = requireIsoDateLike(
    readPath(queryResult, ["expiry_date", "disclose", "result"]),
    "queryResult.expiry_date.disclose.result",
  );

  const nationalityAlpha3 = normalizeNationality(nationalityDisclosed);
  const minAgeProven = parseAgeThreshold(queryResult, ageThresholdOverride);
  const expiryTs = parseIsoDateToExpiryTs(expiryDisclosed);

  return {
    claims: {
      schemaVersion: 1,
      credentialType: CredentialType.Passport,
      nationalityAlpha3Packed: packAlpha3(nationalityAlpha3),
      minAgeProven,
      expiryTs,
    },
    nationalityAlpha3,
    passportExpiryDate: expiryDisclosed,
  };
}

function toFieldFromHex(value: string, label: string): Fr {
  try {
    return Fr.fromHexString(value.startsWith("0x") ? value : `0x${value}`);
  } catch {
    throw new Error(`${label} must be a field-compatible hex string.`);
  }
}

export async function deriveGhostOwnerAddress(
  uniqueIdentifier: string,
  derivationVersion: GhostDerivationVersion,
): Promise<string> {
  return deriveCredentialGhostOwnerAddress(uniqueIdentifier, CredentialType.Passport, derivationVersion);
}

export async function deriveCredentialGhostOwnerAddress(
  uniqueIdentifier: string,
  credentialType: CredentialType,
  derivationVersion: GhostDerivationVersion,
): Promise<string> {
  const material = deriveGhostKeyMaterial({
    uniqueIdentifier,
    credentialType,
    derivationVersion,
  });
  const address = await getSchnorrAccountContractAddress(
    toFieldFromHex(material.secretHex, "Ghost secret"),
    toFieldFromHex(material.saltHex, "Ghost salt"),
  );
  return address.toString();
}

export function resolveVerificationMode(inputMode: VerifyAndIssueRequest["mode"]): VerificationMode {
  return inputMode === "passport" ? "passport" : "rooted";
}

export function resolveGhostDerivationVersion(
  inputVersion: GhostDerivationVersion | undefined,
  mode: VerificationMode,
): GhostDerivationVersion {
  if (inputVersion) {
    return inputVersion;
  }
  return mode === "rooted" ? "v2_scoped" : "v1_legacy_unscoped";
}

export function resolveRootRecoveryGhostDerivationVersion(
  inputVersion: GhostDerivationVersion | undefined,
): GhostDerivationVersion {
  return inputVersion ?? "v2_scoped";
}

function readTxHash(receipt: unknown): string | undefined {
  if (!receipt || typeof receipt !== "object") {
    return undefined;
  }
  const txHashSource =
    Reflect.get(receipt, "receipt") && typeof Reflect.get(receipt, "receipt") === "object"
      ? Reflect.get(receipt, "receipt")
      : receipt;
  const txHash = Reflect.get(txHashSource as object, "txHash");
  if (typeof txHash === "string") {
    return txHash;
  }
  if (txHash && typeof txHash === "object" && "toString" in txHash) {
    return String((txHash as { toString(): string }).toString());
  }
  return undefined;
}

async function ensureImportedLocalTestAccountAddress(
  wallet: EmbeddedWallet,
  index: number,
): Promise<AztecAddress> {
  const initialAccounts = await getInitialTestAccountsData();
  const accountData = initialAccounts[index];
  if (!accountData) {
    throw new Error(`Local test account index ${index} is not available.`);
  }

  const currentAccounts = await wallet.getAccounts();
  const existing = currentAccounts.find(account => account.item.equals(accountData.address));
  if (existing) {
    return existing.item;
  }

  const alias = `local-test-${index}`;
  const importedAccount = await wallet.createSchnorrAccount(
    accountData.secret,
    accountData.salt,
    accountData.signingKey,
    alias,
  );
  const updatedAccounts = await wallet.getAccounts();
  const importedMatch = updatedAccounts.find(account => account.item.equals(importedAccount.address));
  return importedMatch?.item ?? importedAccount.address;
}

async function registerContractArtifactAtAddress(
  wallet: Wallet,
  nodeUrl: string,
  contractAddress: string,
  artifact: ContractArtifact,
): Promise<void> {
  const address = AztecAddress.fromString(contractAddress);
  const existingMetadata = await wallet.getContractMetadata(address);
  if (existingMetadata.instance) {
    try {
      await wallet.registerContract(existingMetadata.instance, artifact);
    } catch (error) {
      if (isArtifactClassMismatch(error)) {
        throw new Error(buildStaleIssuerDeploymentMessage(contractAddress, errorMessage(error)));
      }
      throw error;
    }
    return;
  }

  const walletBackedNode = (wallet as Wallet & { aztecNode?: AztecNode }).aztecNode;
  const rawInstance = await (walletBackedNode ?? createAztecNodeClient(nodeUrl)).getContract(address);
  if (!rawInstance) {
    throw new Error(`Contract ${contractAddress} is not deployed on the current Aztec node.`);
  }

  const instance = contractInstanceWithAddressFromPlainObject(address, rawInstance);
  try {
    await wallet.registerContract(instance, artifact);
  } catch (error) {
    if (isArtifactClassMismatch(error)) {
      throw new Error(buildStaleIssuerDeploymentMessage(contractAddress, errorMessage(error)));
    }
    throw error;
  }
}

async function createIssuanceContext(config: VerificationApiConfig): Promise<IssuanceContext> {
  const node = createAztecNodeClient(config.aztecNodeUrl);
  await waitForNode(node);
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true });
  const localOrchestrator = await ensureImportedLocalTestAccountAddress(wallet, config.localTestAccountIndex);
  const orchestratorAddress = localOrchestrator;
  if (config.orchestratorAddress && config.orchestratorAddress !== orchestratorAddress.toString()) {
    throw new Error(
      `Configured orchestrator ${config.orchestratorAddress} does not match local test account ${orchestratorAddress.toString()}.`,
    );
  }

  await registerContractArtifactAtAddress(wallet, config.aztecNodeUrl, config.issuerAddress, MagnaIssuerContract.artifact);
  const issuer = await MagnaIssuerContract.at(AztecAddress.fromString(config.issuerAddress), wallet);

  return {
    wallet,
    issuer,
    orchestratorAddress,
  };
}

function toZkPassportResult(value: unknown): ZkPassportVerificationResult {
  if (!value || typeof value !== "object") {
    throw new Error("Unexpected zkPassport verify result.");
  }
  const verified = readPath(value, ["verified"]);
  const uniqueIdentifier = readPath(value, ["uniqueIdentifier"]);
  return {
    verified: verified === true,
    uniqueIdentifier: typeof uniqueIdentifier === "string" ? uniqueIdentifier : undefined,
  };
}

async function verifyZkPassportPassportClaims(
  config: VerificationApiConfig,
  input: {
    proofs: ProofResult[];
    originalQuery: Query;
    queryResult: QueryResult;
    ageThreshold?: number;
  },
): Promise<{
  verification: { verified: true; uniqueIdentifier: string };
  normalized: ReturnType<typeof normalizePassportClaimsFromQueryResult>;
}> {
  if (!Array.isArray(input.proofs) || input.proofs.length === 0) {
    throw new Error("proofs must be a non-empty array.");
  }
  if (!input.originalQuery || typeof input.originalQuery !== "object") {
    throw new Error("originalQuery is required.");
  }
  if (!input.queryResult || typeof input.queryResult !== "object") {
    throw new Error("queryResult is required.");
  }

  const { ZKPassport } = require("@zkpassport/sdk") as typeof import("@zkpassport/sdk");
  const zkPassport = new ZKPassport(config.zkPassportDomain);
  const verificationRaw = await zkPassport.verify({
    proofs: input.proofs,
    originalQuery: input.originalQuery,
    queryResult: input.queryResult,
    scope: config.zkPassportScope,
    devMode: config.zkPassportDevMode,
  });
  const verification = toZkPassportResult(verificationRaw);
  if (!verification.verified) {
    throw new Error("zkPassport verification failed.");
  }
  if (!verification.uniqueIdentifier) {
    throw new Error("zkPassport verification succeeded but uniqueIdentifier is missing.");
  }

  return {
    verification: {
      verified: true,
      uniqueIdentifier: verification.uniqueIdentifier,
    },
    normalized: normalizePassportClaimsFromQueryResult(input.queryResult, input.ageThreshold),
  };
}

function requireFieldLikeString(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  if (typeof value === "bigint" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "toString" in value) {
    const asString = String((value as { toString(): string }).toString());
    if (asString && asString !== "[object Object]") {
      return asString;
    }
  }
  throw new Error(`${fieldName} must be field-like.`);
}

function requireDecimalString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${fieldName} must be a decimal string.`);
  }
  return value;
}

function requirePositiveUnixTimestampString(value: unknown, fieldName: string): string {
  const normalized = requireDecimalString(value, fieldName);
  if (BigInt(normalized) <= 0n) {
    throw new Error(`${fieldName} must be a positive unix timestamp string.`);
  }
  return normalized;
}

function requireOptionalPilotMode(value: unknown): VerificationMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "passport" || value === "rooted") {
    return value;
  }
  throw new Error("mode must be passport or rooted.");
}

function requireOptionalPilotGhostDerivationVersion(value: unknown): GhostDerivationVersion | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "v1_legacy_unscoped" || value === "v2_scoped") {
    return value;
  }
  throw new Error("ghostDerivationVersion must be v1_legacy_unscoped or v2_scoped.");
}

export function isPassportPilotRequest(input: unknown): input is VerifyAndIssuePassportPilotRequest {
  return Boolean(
    input &&
      typeof input === "object" &&
      Reflect.get(input, "pilotSchema") === PASSPORT_PII_BLIND_PILOT_SCHEMA,
  );
}

export function validatePassportPilotRequest(
  input: VerifyAndIssuePassportPilotRequest,
): VerifyAndIssuePassportPilotRequest {
  assertNoZkPassportPrivateArtifacts(input);
  if (input.pilotSchema !== PASSPORT_PII_BLIND_PILOT_SCHEMA) {
    throw new Error("pilotSchema must be passport-pii-blind-v0.");
  }
  requireString(input.activeOwner, "activeOwner");
  requireString(input.ghostOwner, "ghostOwner");
  requireDecimalString(input.claimsHash, "claimsHash");
  requireDecimalString(input.rootCommitment, "rootCommitment");
  requirePositiveUnixTimestampString(input.credentialValidUntil, "credentialValidUntil");
  const mode = resolveVerificationMode(requireOptionalPilotMode(input.mode));
  resolveGhostDerivationVersion(requireOptionalPilotGhostDerivationVersion(input.ghostDerivationVersion), mode);
  return input;
}

function defaultInstagramExpiryTs(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
}

function parseOptionalExpiryTs(value: VerifyAndIssueInstagramRequest["expiryTs"]): bigint {
  if (value === undefined || value === null || value === "") {
    return defaultInstagramExpiryTs();
  }
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("expiryTs must be a positive safe integer.");
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error("expiryTs must be a unix timestamp string.");
  }
  return BigInt(trimmed);
}

function decodeBase64Email(value: unknown): Buffer {
  const emlBase64 = requireString(value, "emlBase64");
  try {
    const decoded = Buffer.from(emlBase64, "base64");
    if (decoded.length === 0) {
      throw new Error("empty");
    }
    return decoded;
  } catch {
    throw new Error("emlBase64 must be a valid base64-encoded .eml file.");
  }
}

function assertInstagramProofMatchesMetadata(proof: InstagramProofArtifact): void {
  if (proof.outputs.handleLen !== proof.metadata.handleLen) {
    throw new Error("Instagram proof handle length output did not match generated metadata.");
  }
  if (BigInt(proof.outputs.handlePacked) !== proof.metadata.handlePacked) {
    throw new Error("Instagram proof handle output did not match generated metadata.");
  }
}

export async function verifyAndIssuePassport(
  config: VerificationApiConfig,
  input: VerifyAndIssueRequest,
  contextLoader: () => Promise<IssuanceContext>,
): Promise<VerifyAndIssueResponse> {
  const activeOwner = requireString(input.activeOwner, "activeOwner");
  const mode = resolveVerificationMode(input.mode);
  const ghostDerivationVersion = resolveGhostDerivationVersion(input.ghostDerivationVersion, mode);
  const { verification, normalized } = await verifyZkPassportPassportClaims(config, input);
  const ghostOwner = await deriveGhostOwnerAddress(verification.uniqueIdentifier, ghostDerivationVersion);
  const rootCommitment = deriveRootCommitment({ uniqueIdentifier: verification.uniqueIdentifier });
  const context = await contextLoader();
  const claimsHash = computePassportClaimsHash(normalized.claims, poseidon2FieldHasher);
  const activeOwnerAddress = AztecAddress.fromString(activeOwner);
  const ghostOwnerAddress = AztecAddress.fromString(ghostOwner);
  const interaction =
    mode === "rooted"
      ? context.issuer.methods.register_rooted_passport(
          activeOwnerAddress,
          ghostOwnerAddress,
          new Fr(rootCommitment),
          new Fr(claimsHash),
          normalized.claims.expiryTs,
        )
      : context.issuer.methods.register_credential(
          activeOwnerAddress,
          ghostOwnerAddress,
          new Fr(claimsHash),
          normalized.claims.credentialType,
          normalized.claims.expiryTs,
        );
  const receipt = await interaction.send({ from: context.orchestratorAddress });

  return {
    issuanceTxHash: readTxHash(receipt),
    ghostOwner,
    rootCommitment: rootCommitment.toString(),
    claimsHash: claimsHash.toString(),
    mode,
    ghostDerivationVersion,
    issuerAddress: config.issuerAddress,
    orchestratorAddress: context.orchestratorAddress.toString(),
    verificationSummary: {
      verified: true,
      uniqueIdentifierPresent: true,
    },
    normalizedClaims: {
      nationalityAlpha3: normalized.nationalityAlpha3,
      minAgeProven: normalized.claims.minAgeProven,
      passportExpiryDate: normalized.passportExpiryDate,
      expiryTs: normalized.claims.expiryTs.toString(),
    },
  };
}

export async function verifyAndIssuePassportPilot(
  config: VerificationApiConfig,
  input: VerifyAndIssuePassportPilotRequest,
  contextLoader: () => Promise<IssuanceContext>,
): Promise<VerifyAndIssueResponse> {
  const validated = validatePassportPilotRequest(input);
  const mode = resolveVerificationMode(validated.mode);
  const ghostDerivationVersion = resolveGhostDerivationVersion(validated.ghostDerivationVersion, mode);
  const context = await contextLoader();
  const activeOwnerAddress = AztecAddress.fromString(validated.activeOwner);
  const ghostOwnerAddress = AztecAddress.fromString(validated.ghostOwner);
  const claimsHash = new Fr(BigInt(validated.claimsHash));
  const credentialValidUntil = BigInt(validated.credentialValidUntil);

  const interaction =
    mode === "rooted"
      ? context.issuer.methods.register_rooted_passport_v2(
          activeOwnerAddress,
          ghostOwnerAddress,
          new Fr(BigInt(validated.rootCommitment)),
          claimsHash,
          credentialValidUntil,
        )
      : context.issuer.methods.register_credential_v2(
          activeOwnerAddress,
          ghostOwnerAddress,
          claimsHash,
          CredentialType.Passport,
          credentialValidUntil,
        );

  const receipt = await interaction.send({ from: context.orchestratorAddress });
  return {
    issuanceTxHash: readTxHash(receipt),
    ghostOwner: validated.ghostOwner,
    rootCommitment: validated.rootCommitment,
    claimsHash: validated.claimsHash,
    mode,
    ghostDerivationVersion,
    issuerAddress: config.issuerAddress,
    orchestratorAddress: context.orchestratorAddress.toString(),
    verificationSummary: {
      verified: true,
      pilot: true,
      piiBlind: true,
    },
  };
}

export async function verifyAndIssueInstagram(
  config: VerificationApiConfig,
  input: VerifyAndIssueInstagramRequest,
  contextLoader: () => Promise<IssuanceContext>,
  dependencies?: {
    proveEmail?: typeof proveInstagramEmail;
    deriveGhostOwner?: typeof deriveCredentialGhostOwnerAddress;
  },
): Promise<VerifyAndIssueInstagramResponse> {
  const activeOwner = requireString(input.activeOwner, "activeOwner");
  const rawEmail = decodeBase64Email(input.emlBase64);
  const proveEmail = dependencies?.proveEmail ?? proveInstagramEmail;
  const deriveGhostOwner = dependencies?.deriveGhostOwner ?? deriveCredentialGhostOwnerAddress;
  const proof = await proveEmail(rawEmail, input.claimedHandle);
  assertInstagramProofMatchesMetadata(proof);

  const ghostDerivationVersion = input.ghostDerivationVersion ?? "v2_scoped";
  const ghostOwner = await deriveGhostOwner(
    proof.outputs.emailNullifier,
    CredentialType.Instagram,
    ghostDerivationVersion,
  );
  const expiryTs = parseOptionalExpiryTs(input.expiryTs);
  const handleHash = computeInstagramHandleHash(proof.metadata.normalizedHandle);
  const claims: InstagramCanonicalClaims = {
    schemaVersion: 1,
    credentialType: CredentialType.Instagram,
    handleHash,
    expiryTs,
  };
  const claimsHash = computeInstagramClaimsHash(claims, poseidon2FieldHasher);
  const context = await contextLoader();
  const receipt = await context.issuer.methods
    .register_credential(
      AztecAddress.fromString(activeOwner),
      AztecAddress.fromString(ghostOwner),
      new Fr(claimsHash),
      claims.credentialType,
      claims.expiryTs,
    )
    .send({ from: context.orchestratorAddress });

  return {
    issuanceTxHash: readTxHash(receipt),
    ghostOwner,
    claimsHash: claimsHash.toString(),
    ghostDerivationVersion,
    issuerAddress: config.issuerAddress,
    orchestratorAddress: context.orchestratorAddress.toString(),
    verificationSummary: {
      verified: true,
      dkimPubkeyHash: proof.outputs.dkimPubkeyHash,
      emailNullifier: proof.outputs.emailNullifier,
    },
    normalizedClaims: {
      instagramHandle: proof.metadata.normalizedHandle,
      handleHash: handleHash.toString(),
      handleLen: proof.outputs.handleLen,
      handlePacked: proof.outputs.handlePacked,
      expiryTs: expiryTs.toString(),
    },
  };
}

export async function verifyAndRefreshRootAuthority(
  config: VerificationApiConfig,
  input: VerifyAndRefreshRootAuthorityRequest,
  contextLoader: () => Promise<IssuanceContext>,
): Promise<VerifyAndRefreshRootAuthorityResponse> {
  const ghostOwner = requireString(input.ghostOwner, "ghostOwner");
  if (!input.hintedRootStatusNote || typeof input.hintedRootStatusNote !== "object") {
    throw new Error("hintedRootStatusNote is required.");
  }
  if (!input.hintedRootAuthorityNote || typeof input.hintedRootAuthorityNote !== "object") {
    throw new Error("hintedRootAuthorityNote is required.");
  }

  const { normalized } = await verifyZkPassportPassportClaims(config, input);
  const context = await contextLoader();
  const claimsHash = computePassportClaimsHash(normalized.claims, poseidon2FieldHasher);
  const rootCommitment = requireFieldLikeString(
    readPath(input.hintedRootStatusNote, ["note", "root_commitment"]),
    "hintedRootStatusNote.note.root_commitment",
  );
  const receipt = await context.issuer.methods
    .refresh_root_authority(
      AztecAddress.fromString(ghostOwner),
      input.hintedRootStatusNote as never,
      input.hintedRootAuthorityNote as never,
      new Fr(claimsHash),
      normalized.claims.expiryTs,
    )
    .send({ from: context.orchestratorAddress });

  return {
    renewalTxHash: readTxHash(receipt),
    ghostOwner,
    rootCommitment,
    claimsHash: claimsHash.toString(),
    issuerAddress: config.issuerAddress,
    orchestratorAddress: context.orchestratorAddress.toString(),
    verificationSummary: {
      verified: true,
      uniqueIdentifierPresent: true,
    },
    normalizedClaims: {
      nationalityAlpha3: normalized.nationalityAlpha3,
      minAgeProven: normalized.claims.minAgeProven,
      passportExpiryDate: normalized.passportExpiryDate,
      expiryTs: normalized.claims.expiryTs.toString(),
    },
  };
}

export async function verifyRootRecoveryPreflight(
  config: VerificationApiConfig,
  input: VerifyRootRecoveryPreflightRequest,
  dependencies?: {
    verifyPassportClaims?: typeof verifyZkPassportPassportClaims;
    deriveGhostOwner?: typeof deriveGhostOwnerAddress;
    deriveRoot?: typeof deriveRootCommitment;
  },
): Promise<VerifyRootRecoveryPreflightResponse> {
  const expectedGhostOwner = requireString(input.expectedGhostOwner, "expectedGhostOwner");
  const expectedRootCommitment = requireString(input.expectedRootCommitment, "expectedRootCommitment");
  const ghostDerivationVersion = resolveRootRecoveryGhostDerivationVersion(input.ghostDerivationVersion);
  const verifyPassportClaims = dependencies?.verifyPassportClaims ?? verifyZkPassportPassportClaims;
  const deriveGhostOwner = dependencies?.deriveGhostOwner ?? deriveGhostOwnerAddress;
  const deriveRoot = dependencies?.deriveRoot ?? deriveRootCommitment;
  const { verification, normalized } = await verifyPassportClaims(config, input);
  const derivedGhostOwner = await deriveGhostOwner(verification.uniqueIdentifier, ghostDerivationVersion);
  const derivedRootCommitment = deriveRoot({ uniqueIdentifier: verification.uniqueIdentifier }).toString();
  if (derivedGhostOwner !== expectedGhostOwner) {
    throw new Error(
      `Fresh zkPassport proof does not match the configured ghost owner. expected=${expectedGhostOwner} derived=${derivedGhostOwner}`,
    );
  }
  if (derivedRootCommitment !== expectedRootCommitment) {
    throw new Error(
      `Fresh zkPassport proof does not match the rooted passport lineage. expectedRootCommitment=${expectedRootCommitment} derivedRootCommitment=${derivedRootCommitment}`,
    );
  }

  return {
    expectedGhostOwner,
    derivedGhostOwner,
    expectedRootCommitment,
    derivedRootCommitment,
    ghostDerivationVersion,
    matchesExpectedGhostOwner: true,
    matchesExpectedRootCommitment: true,
    verificationSummary: {
      verified: true,
      uniqueIdentifierPresent: true,
    },
    normalizedClaims: {
      nationalityAlpha3: normalized.nationalityAlpha3,
      minAgeProven: normalized.claims.minAgeProven,
      passportExpiryDate: normalized.passportExpiryDate,
      expiryTs: normalized.claims.expiryTs.toString(),
    },
  };
}

export function createIssuanceContextLoader(config: VerificationApiConfig): () => Promise<IssuanceContext> {
  let contextPromise: Promise<IssuanceContext> | null = null;
  return () => {
    if (!contextPromise) {
      contextPromise = createIssuanceContext(config);
    }
    return contextPromise;
  };
}
