import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";
import { getInitialTestAccountsData, INITIAL_TEST_SIGNING_KEYS } from "@aztec/accounts/testing";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractArtifact } from "@aztec/aztec.js/abi";
import { Fq, Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient, waitForNode, type AztecNode } from "@aztec/aztec.js/node";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { contractInstanceWithAddressFromPlainObject } from "@aztec/stdlib/contract";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import {
  CredentialType,
  deriveGhostKeyMaterial,
  type GhostDerivationVersion,
} from "@magna/wallet";
import {
  computePassportA2RequestContextHash,
  PASSPORT_A2_DEVELOPMENT_NULLIFIER_TYPE,
  PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH,
  PASSPORT_A2_OPRF_PUBLIC_KEY_HASH,
  PASSPORT_A2_PRODUCTION_NULLIFIER_TYPE,
  parsePassportWrapperPublicInputs,
  verifyPassportWrapperProof,
  type PassportA2RegistryContext,
  type PassportWrapperPublicOutputs,
} from "@magna/passport-wrapper-proof";
import { RegistryClient } from "@zkpassport/registry";
import {
  formatBoundData,
  getBindParameterCommitment,
  getServiceScopeHash,
  getServiceSubscopeHash,
} from "@zkpassport/utils";
import { MagnaIssuerContract } from "@magna/contracts-bindings";
import {
  INSTAGRAM_V2_SCHEMA,
  INSTAGRAM_V2_VALIDITY_SECONDS,
  normalizeInstagramProofData,
  parseInstagramPublicInputs,
  verifyInstagramProof,
  type InstagramProofPublicOutputs,
} from "@magna/instagram-proof";

export type VerificationMode = "passport" | "rooted";

export const PASSPORT_A2_MAX_VALIDITY_SECONDS = 30 * 24 * 60 * 60;
export const PASSPORT_A2_SCHEMA = "passport-a2-v1" as const;
export const ROOT_RECOVERY_AUTHORIZATION_TTL_SECONDS = 10 * 60;

export type VerificationApiConfig = {
  port: number;
  allowedOrigin: string;
  zkPassportDomain: string;
  zkPassportScope: string;
  zkPassportDevMode: boolean;
  zkPassportEvmRpcUrl?: string;
  zkPassportValiditySeconds?: number;
  aztecNodeUrl: string;
  issuerAddress: string;
  localTestAccountIndex: number;
  orchestratorAddress?: string;
  instagramDkimPubkeyHashes: readonly string[];
};

export type VerifyAndIssuePassportA2Request = {
  schema: typeof PASSPORT_A2_SCHEMA;
  activeOwner: string;
  ghostOwner: string;
  credentialValidUntil: string;
  wrapperProof: unknown;
  wrapperPublicInputs: string[];
  registryContext: PassportA2RegistryContext;
  mode?: VerificationMode;
  ghostDerivationVersion?: GhostDerivationVersion;
};

type PassportA2ProofRequest = {
  schema: typeof PASSPORT_A2_SCHEMA;
  credentialValidUntil: string;
  wrapperProof: unknown;
  wrapperPublicInputs: string[];
  registryContext: PassportA2RegistryContext;
};

type PassportA2WrapperVerificationResult =
  | boolean
  | {
      verified: boolean;
      publicInputs?: readonly unknown[];
    };

type VerifyAndIssuePassportA2Dependencies = {
  verifyWrapperProof?: (proof: unknown) => Promise<PassportA2WrapperVerificationResult>;
  parseWrapperPublicInputs?: typeof parsePassportWrapperPublicInputs;
  nowMs?: () => number;
  registryClient?: {
    isCertificateRootValid(root: string, timestamp?: number): Promise<boolean>;
    isCircuitRootValid(root: string, timestamp?: number): Promise<boolean>;
  };
  randomField?: () => Fr;
  networkTimestamp?: () => Promise<bigint>;
};

export type VerifyAndIssueInstagramRequest = {
  schema: typeof INSTAGRAM_V2_SCHEMA;
  proof: unknown;
  activeOwner: string;
};

export type VerifyAndRefreshRootAuthorityA2Request = PassportA2ProofRequest & {
  activeOwner: string;
  ghostOwner: string;
};

type VerifyAndIssuePassportA2Response = {
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
    passportA2: true;
    piiBlind: true;
  };
};

export type VerifyAndIssueResponse = VerifyAndIssuePassportA2Response;

export type VerifyAndIssueInstagramResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  claimsHash: string;
  ghostDerivationVersion: GhostDerivationVersion;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    piiBlind: true;
    dkimPubkeyHash: string;
    emailNullifier: string;
  };
  expiryTs: string;
};

export type VerifyAndRefreshRootAuthorityResponse = {
  renewalAuthorizationTxHash: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    passportA2: true;
    piiBlind: true;
  };
};

type IssuanceContext = {
  wallet: EmbeddedWallet;
  issuer: MagnaIssuerContract;
  orchestratorAddress: AztecAddress;
  // Keep the account manager strongly referenced for the server lifetime.
  // Aztec's native wallet stack can trap if this is collected while the wallet remains active.
  orchestratorAccount: unknown;
};


function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalPositiveInteger(value: string | undefined, label: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

const NOIR_FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function normalizeInstagramDkimPubkeyHash(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) {
    throw new Error("Instagram DKIM public-key hashes must be hexadecimal or decimal Noir fields.");
  }
  const field = BigInt(trimmed);
  if (field < 0n || field >= NOIR_FIELD_MODULUS) {
    throw new Error("Instagram DKIM public-key hashes must be inside the Noir field modulus.");
  }
  return `0x${field.toString(16).padStart(64, "0")}`;
}

export function parseInstagramDkimPubkeyHashes(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(/[\s,]+/).filter(Boolean).map(normalizeInstagramDkimPubkeyHash))];
}

export function assertTrustedInstagramDkimPubkeyHash(
  trustedHashes: readonly string[],
  proofHash: string,
): void {
  if (trustedHashes.length === 0) {
    throw new Error(
      "Instagram issuance is disabled because MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES has no trusted keys.",
    );
  }
  const normalizedProofHash = normalizeInstagramDkimPubkeyHash(proofHash);
  if (!trustedHashes.includes(normalizedProofHash)) {
    throw new Error(`Instagram proof used an untrusted DKIM public key (${normalizedProofHash}).`);
  }
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
    "Run `npm run bootstrap:local -- --skip-rights-deploy`, then restart `npm run verification-api:dev` and the frontend dev server.",
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
    resolve(repoRoot, "apps/magna-management/.env"),
    resolve(repoRoot, "apps/magna-management/.env.local"),
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
    zkPassportDevMode: parseBoolean(readFirstEnv(["MAGNA_ZKPASSPORT_DEV_MODE"]), false),
    zkPassportEvmRpcUrl: parseOptionalString(readFirstEnv(["MAGNA_ZKPASSPORT_EVM_RPC_URL"])),
    zkPassportValiditySeconds: parseOptionalPositiveInteger(
      readFirstEnv(["MAGNA_ZKPASSPORT_VALIDITY_SECONDS"]),
      "MAGNA_ZKPASSPORT_VALIDITY_SECONDS",
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
    instagramDkimPubkeyHashes: parseInstagramDkimPubkeyHashes(
      readFirstEnv(["MAGNA_INSTAGRAM_DKIM_PUBKEY_HASHES"]),
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

function toFieldFromHex(value: string, label: string): Fr {
  try {
    return Fr.fromHexString(value.startsWith("0x") ? value : `0x${value}`);
  } catch {
    throw new Error(`${label} must be a field-compatible hex string.`);
  }
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
    Fq.fromHexString(`0x${material.signingKeyHex}`),
    toFieldFromHex(material.saltHex, "Ghost salt"),
  );
  return address.toString();
}

export function resolveVerificationMode(inputMode: VerificationMode | undefined): VerificationMode {
  return inputMode === "passport" ? "passport" : "rooted";
}

export function resolveGhostDerivationVersion(
  inputVersion: GhostDerivationVersion | undefined,
  _mode: VerificationMode,
): GhostDerivationVersion {
  if (inputVersion && inputVersion !== "v2_scoped") {
    throw new Error("Passport A2 requires v2_scoped ghost derivation.");
  }
  return "v2_scoped";
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
): Promise<{ address: AztecAddress; account: unknown }> {
  const initialAccounts = await getInitialTestAccountsData();
  const accountData = initialAccounts[index];
  if (!accountData) {
    throw new Error(`Local test account index ${index} is not available.`);
  }

  const alias = `local-test-${index}`;
  const importedAccount = await wallet.createSchnorrInitializerlessAccount(
    accountData.secret,
    accountData.salt,
    INITIAL_TEST_SIGNING_KEYS[index] ?? accountData.signingKey,
    alias,
  );
  const updatedAccounts = await wallet.getAccounts();
  const importedMatch = updatedAccounts.find(account => account.item.equals(importedAccount.address));
  return {
    address: importedMatch?.item ?? importedAccount.address,
    account: importedAccount,
  };
}

async function registerContractArtifactAtAddress(
  wallet: Wallet,
  nodeUrl: string,
  contractAddress: string,
  artifact: ContractArtifact,
): Promise<void> {
  const address = AztecAddress.fromStringUnsafe(contractAddress);
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
  const orchestratorAddress = localOrchestrator.address;
  if (config.orchestratorAddress && config.orchestratorAddress !== orchestratorAddress.toString()) {
    throw new Error(
      `Configured orchestrator ${config.orchestratorAddress} does not match local test account ${orchestratorAddress.toString()}.`,
    );
  }

  await registerContractArtifactAtAddress(wallet, config.aztecNodeUrl, config.issuerAddress, MagnaIssuerContract.artifact);
  const issuer = await MagnaIssuerContract.at(AztecAddress.fromStringUnsafe(config.issuerAddress), wallet);

  return {
    wallet,
    issuer,
    orchestratorAddress,
    orchestratorAccount: localOrchestrator.account,
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

function requireOptionalMode(value: unknown): VerificationMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "passport" || value === "rooted") {
    return value;
  }
  throw new Error("mode must be passport or rooted.");
}

function requireOptionalGhostDerivationVersion(value: unknown): GhostDerivationVersion | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "v2_scoped") {
    return value;
  }
  throw new Error("ghostDerivationVersion must be v2_scoped.");
}

export function isPassportA2Request(input: unknown): input is VerifyAndIssuePassportA2Request {
  return Boolean(input && typeof input === "object" && Reflect.get(input, "schema") === PASSPORT_A2_SCHEMA);
}

export function isPassportA2ProofRequest(input: unknown): input is PassportA2ProofRequest {
  return Boolean(input && typeof input === "object" && Reflect.get(input, "schema") === PASSPORT_A2_SCHEMA);
}

const PASSPORT_A2_FORBIDDEN_KEYS = new Set([
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
  "revocationSecret",
  "revocation_secret",
]);

function assertNoPassportA2PrivateArtifacts(input: unknown): void {
  const stack = [input];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (PASSPORT_A2_FORBIDDEN_KEYS.has(key)) {
        throw new Error(`Private passport artifact is forbidden in the A2 request: ${key}`);
      }
      stack.push(value);
    }
  }
}

function assertExactRequestKeys(input: object, allowed: readonly string[], requestName = "Passport A2"): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(input).filter(key => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected ${requestName} request field: ${unexpected[0]}`);
  }
}

function requireWrapperProof(value: unknown): unknown {
  if (value === undefined || value === null) {
    throw new Error("wrapperProof is required.");
  }
  return value;
}

function requireWrapperPublicInputs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("wrapperPublicInputs must be an array.");
  }
  return value.map((entry, index) => requireString(entry, `wrapperPublicInputs[${index}]`));
}

function requirePassportA2RegistryContext(value: unknown): PassportA2RegistryContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("registryContext must be an object.");
  }
  assertExactRequestKeys(value, [
    "certificateRegistryRoot",
    "circuitRegistryRoot",
    "nullifierType",
    "oprfPublicKeyHash",
  ]);
  const nullifierType = Reflect.get(value, "nullifierType");
  if (nullifierType !== 0 && nullifierType !== 1 && nullifierType !== 2 && nullifierType !== 3) {
    throw new Error("registryContext.nullifierType must be 0, 1, 2, or 3.");
  }
  return {
    certificateRegistryRoot: requireDecimalString(
      Reflect.get(value, "certificateRegistryRoot"),
      "registryContext.certificateRegistryRoot",
    ),
    circuitRegistryRoot: requireDecimalString(
      Reflect.get(value, "circuitRegistryRoot"),
      "registryContext.circuitRegistryRoot",
    ),
    nullifierType,
    oprfPublicKeyHash: requireDecimalString(
      Reflect.get(value, "oprfPublicKeyHash"),
      "registryContext.oprfPublicKeyHash",
    ),
  };
}

function normalizeBoundWrapperPublicInputs(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((entry, index) => {
    const raw = requireFieldLikeString(entry, `${fieldName}[${index}]`);
    try {
      return BigInt(raw).toString();
    } catch {
      throw new Error(`${fieldName}[${index}] must be a decimal or 0x-prefixed field string.`);
    }
  });
}

function readProofBoundWrapperPublicInputs(proof: unknown): string[] | undefined {
  if (!proof || typeof proof !== "object") {
    return undefined;
  }
  const publicInputs = Reflect.get(proof, "publicInputs");
  return publicInputs === undefined
    ? undefined
    : normalizeBoundWrapperPublicInputs(publicInputs, "wrapperProof.publicInputs");
}

function normalizeWrapperVerificationResult(
  result: PassportA2WrapperVerificationResult,
): {
  verified: boolean;
  publicInputs?: string[];
} {
  if (typeof result === "boolean") {
    return { verified: result };
  }
  if (!result || typeof result !== "object") {
    throw new Error("Unexpected Passport A2 wrapper verifier result.");
  }
  return {
    verified: result.verified === true,
    publicInputs:
      result.publicInputs === undefined
        ? undefined
        : normalizeBoundWrapperPublicInputs(result.publicInputs, "wrapper verifier publicInputs"),
  };
}

function assertSameWrapperPublicInputs(actual: readonly string[], expected: readonly string[], message: string): void {
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error(message);
  }
}

function validatePassportA2WrapperOutputs(outputs: PassportWrapperPublicOutputs): PassportWrapperPublicOutputs {
  return {
    claimsHash: requireDecimalString(outputs.claimsHash, "wrapperPublicInputs.claimsHash"),
    nationalityCommitment: requireDecimalString(
      outputs.nationalityCommitment,
      "wrapperPublicInputs.nationalityCommitment",
    ),
    expiryCommitment: requireDecimalString(outputs.expiryCommitment, "wrapperPublicInputs.expiryCommitment"),
    minAgeProven: outputs.minAgeProven,
    credentialValidUntil: requirePositiveUnixTimestampString(
      outputs.credentialValidUntil,
      "wrapperPublicInputs.credentialValidUntil",
    ),
    rootCommitment: requireDecimalString(outputs.rootCommitment, "wrapperPublicInputs.rootCommitment"),
    requestContextHash: requireDecimalString(outputs.requestContextHash, "wrapperPublicInputs.requestContextHash"),
    proofCurrentDate: requirePositiveUnixTimestampString(outputs.proofCurrentDate, "wrapperPublicInputs.proofCurrentDate"),
  };
}

function assertPassportA2PayloadMatchesWrapperOutputs(
  input: PassportA2ProofRequest,
  outputs: PassportWrapperPublicOutputs,
): void {
  if (input.credentialValidUntil !== outputs.credentialValidUntil) {
    throw new Error("credentialValidUntil must match wrapper public outputs.");
  }
}

export function validatePassportA2ProofRequest<T extends PassportA2ProofRequest>(
  input: T,
  allowedExtraKeys: readonly string[] = [],
): T {
  assertNoPassportA2PrivateArtifacts(input);
  assertExactRequestKeys(input, [
    "schema",
    "credentialValidUntil",
    "wrapperProof",
    "wrapperPublicInputs",
    "registryContext",
    ...allowedExtraKeys,
  ]);
  if (input.schema !== PASSPORT_A2_SCHEMA) {
    throw new Error("schema must be passport-a2-v1.");
  }
  requirePositiveUnixTimestampString(input.credentialValidUntil, "credentialValidUntil");
  requireWrapperProof(input.wrapperProof);
  input.wrapperPublicInputs = requireWrapperPublicInputs(input.wrapperPublicInputs);
  input.registryContext = requirePassportA2RegistryContext(input.registryContext);
  return input;
}

export function validatePassportA2Request(input: VerifyAndIssuePassportA2Request): VerifyAndIssuePassportA2Request {
  validatePassportA2ProofRequest(input, ["activeOwner", "ghostOwner", "mode", "ghostDerivationVersion"]);
  requireString(input.activeOwner, "activeOwner");
  requireString(input.ghostOwner, "ghostOwner");
  const mode = resolveVerificationMode(requireOptionalMode(input.mode));
  resolveGhostDerivationVersion(requireOptionalGhostDerivationVersion(input.ghostDerivationVersion), mode);
  return input;
}

function validateInstagramV2Request(input: VerifyAndIssueInstagramRequest): void {
  assertExactRequestKeys(input, ["schema", "proof", "activeOwner"], "Instagram V2");
  if (input.schema !== INSTAGRAM_V2_SCHEMA) {
    throw new Error(`schema must be ${INSTAGRAM_V2_SCHEMA}.`);
  }
  requireString(input.activeOwner, "activeOwner");
  if (input.proof === undefined || input.proof === null) {
    throw new Error("proof is required.");
  }
}

function requireInstagramField(value: string, fieldName: string): bigint {
  let field: bigint;
  try {
    field = BigInt(value);
  } catch {
    throw new Error(`${fieldName} must be a decimal or 0x-prefixed field string.`);
  }
  if (field < 0n || field >= NOIR_FIELD_MODULUS) {
    throw new Error(`${fieldName} must be inside the Noir field modulus.`);
  }
  return field;
}

function assertInstagramV2Context(
  config: VerificationApiConfig,
  outputs: InstagramProofPublicOutputs,
  activeOwner: string,
  chainId: bigint,
  nowMs: () => number,
): { claimsHash: bigint; expiryTs: bigint } {
  const claimsHash = requireInstagramField(outputs.claimsHash, "Instagram claims hash");
  if (claimsHash === 0n) throw new Error("Instagram claims hash must be non-zero.");
  const expiryTs = requireInstagramField(outputs.expiryTs, "Instagram expiry");
  const proofOwner = requireInstagramField(outputs.activeOwner, "Instagram active owner");
  const proofIssuer = requireInstagramField(outputs.issuerAddress, "Instagram issuer address");
  const proofChainId = requireInstagramField(outputs.chainId, "Instagram chain id");
  if (proofOwner !== BigInt(activeOwner)) {
    throw new Error("Instagram proof is bound to a different active owner.");
  }
  if (proofIssuer !== BigInt(config.issuerAddress)) {
    throw new Error("Instagram proof is bound to a different issuer deployment.");
  }
  if (proofChainId !== chainId) {
    throw new Error("Instagram proof is bound to a different L1 chain id.");
  }
  const nowSeconds = BigInt(Math.floor(nowMs() / 1000));
  if (expiryTs <= nowSeconds) {
    throw new Error("Instagram proof expiry is not in the future.");
  }
  const maximum = nowSeconds + BigInt(INSTAGRAM_V2_VALIDITY_SECONDS) + 5n * 60n;
  if (expiryTs > maximum) {
    throw new Error("Instagram proof expiry exceeds the one-year issuance policy.");
  }
  return { claimsHash, expiryTs };
}

async function defaultVerifyPassportWrapperProof(
  proof: unknown,
  profile: "development" | "production",
): Promise<PassportA2WrapperVerificationResult> {
  return verifyPassportWrapperProof(proof as never, { profile });
}

function passportA2BindCustomData(input: {
  action: "issue" | "renew" | "recover";
  owner: string;
  scope: string;
}): string {
  return `magna-passport-a2:${input.action}:${input.scope.trim()}:${input.owner.trim().toLowerCase()}`;
}

function validatePassportA2TimeBounds(
  config: VerificationApiConfig,
  outputs: PassportWrapperPublicOutputs,
  nowMs: () => number,
): void {
  const nowSeconds = BigInt(Math.floor(nowMs() / 1000));
  const proofCurrentDate = BigInt(outputs.proofCurrentDate);
  const validitySeconds = BigInt(config.zkPassportValiditySeconds ?? 60 * 60);
  if (proofCurrentDate > nowSeconds + 5n * 60n) {
    throw new Error("Passport A2 proof date is in the future.");
  }
  if (proofCurrentDate + validitySeconds < nowSeconds) {
    throw new Error("Passport A2 proof is stale.");
  }
  const credentialValidUntil = BigInt(outputs.credentialValidUntil);
  if (credentialValidUntil <= nowSeconds) {
    throw new Error("Passport A2 credential validity must be in the future.");
  }
  if (credentialValidUntil > nowSeconds + BigInt(PASSPORT_A2_MAX_VALIDITY_SECONDS)) {
    throw new Error("credentialValidUntil cannot exceed 30 days from server time.");
  }
}

async function assertPassportA2RequestContext(input: {
  config: VerificationApiConfig;
  outputs: PassportWrapperPublicOutputs;
  action: "issue" | "renew" | "recover";
  owner: string;
  ghostOwner: string;
  mode: VerificationMode;
  registryContext: PassportA2RegistryContext;
}): Promise<void> {
  const bindCommitment = await getBindParameterCommitment(
    formatBoundData({
      custom_data: passportA2BindCustomData({
        action: input.action,
        owner: input.owner,
        scope: input.config.zkPassportScope,
      }),
    }),
  );
  const expected = computePassportA2RequestContextHash({
    action: input.action,
    issuer: input.config.issuerAddress,
    owner: input.owner,
    ghostOwner: input.ghostOwner,
    credentialMode: input.mode,
    rootCommitment: input.outputs.rootCommitment,
    credentialValidUntil: input.outputs.credentialValidUntil,
    serviceScope: getServiceScopeHash(input.config.zkPassportDomain),
    serviceSubscope: getServiceSubscopeHash(input.config.zkPassportScope),
    bindCommitment,
    certificateRegistryRoot: input.registryContext.certificateRegistryRoot,
    circuitRegistryRoot: input.registryContext.circuitRegistryRoot,
    nullifierType: input.registryContext.nullifierType,
    oprfPublicKeyHash: input.registryContext.oprfPublicKeyHash,
  }).toString();
  if (expected !== input.outputs.requestContextHash) {
    throw new Error("Passport A2 request context does not match the proof-bound operation.");
  }
}

async function assertPassportA2RegistryTrust(input: {
  config: VerificationApiConfig;
  registryContext: PassportA2RegistryContext;
  registryClient?: VerifyAndIssuePassportA2Dependencies["registryClient"];
  nowMs: () => number;
}): Promise<void> {
  const expectedNullifierType = input.config.zkPassportDevMode
    ? PASSPORT_A2_DEVELOPMENT_NULLIFIER_TYPE
    : PASSPORT_A2_PRODUCTION_NULLIFIER_TYPE;
  const expectedOprfPublicKeyHash = input.config.zkPassportDevMode
    ? PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH
    : PASSPORT_A2_OPRF_PUBLIC_KEY_HASH;
  if (input.registryContext.nullifierType !== expectedNullifierType) {
    throw new Error(
      input.config.zkPassportDevMode
        ? "Passport A2 development requires the official non-salted-mock zkPassport nullifier."
        : "Passport A2 production requires a production salted zkPassport nullifier.",
    );
  }
  if (input.registryContext.oprfPublicKeyHash !== expectedOprfPublicKeyHash) {
    throw new Error(
      input.config.zkPassportDevMode
        ? "Passport A2 development requires a zero OPRF public-key hash."
        : "Passport A2 OPRF public key hash is not pinned to key ID 1.",
    );
  }
  const registryClient = input.registryClient ?? new RegistryClient({
    chainId: input.config.zkPassportDevMode ? 11155111 : 1,
    rpcUrl: input.config.zkPassportEvmRpcUrl,
  });
  const timestamp = Math.floor(input.nowMs() / 1000);
  const [certificateRootValid, circuitRootValid] = await Promise.all([
    registryClient.isCertificateRootValid(
      BigInt(input.registryContext.certificateRegistryRoot).toString(16),
      timestamp,
    ),
    registryClient.isCircuitRootValid(
      BigInt(input.registryContext.circuitRegistryRoot).toString(16),
      timestamp,
    ),
  ]);
  if (!certificateRootValid) {
    throw new Error("Passport A2 certificate registry root is not trusted.");
  }
  if (!circuitRootValid) {
    throw new Error("Passport A2 circuit registry root is not trusted.");
  }
}

export async function verifyAndIssuePassportA2(
  config: VerificationApiConfig,
  input: VerifyAndIssuePassportA2Request,
  contextLoader: () => Promise<IssuanceContext>,
  dependencies: VerifyAndIssuePassportA2Dependencies = {},
): Promise<VerifyAndIssueResponse> {
  const validated = validatePassportA2Request(input);
  const mode = resolveVerificationMode(validated.mode);
  const wrapperOutputs = await verifyPassportA2Proof(config, validated, {
    ...dependencies,
    action: "issue",
    owner: validated.activeOwner,
    ghostOwner: validated.ghostOwner,
    mode,
    allowedExtraKeys: ["activeOwner", "ghostOwner", "mode", "ghostDerivationVersion"],
  });
  const ghostDerivationVersion = resolveGhostDerivationVersion(validated.ghostDerivationVersion, mode);
  const context = await contextLoader();
  const activeOwnerAddress = AztecAddress.fromStringUnsafe(validated.activeOwner);
  const ghostOwnerAddress = AztecAddress.fromStringUnsafe(validated.ghostOwner);
  const claimsHash = new Fr(BigInt(wrapperOutputs.claimsHash));
  const credentialValidUntil = BigInt(wrapperOutputs.credentialValidUntil);

  const interaction =
    mode === "rooted"
      ? context.issuer.methods.register_rooted_passport_v2(
          activeOwnerAddress,
          ghostOwnerAddress,
          new Fr(BigInt(wrapperOutputs.rootCommitment)),
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
    rootCommitment: wrapperOutputs.rootCommitment,
    claimsHash: wrapperOutputs.claimsHash,
    mode,
    ghostDerivationVersion,
    issuerAddress: config.issuerAddress,
    orchestratorAddress: context.orchestratorAddress.toString(),
    verificationSummary: {
      verified: true,
      passportA2: true,
      piiBlind: true,
    },
  };
}

async function verifyPassportA2Proof(
  config: VerificationApiConfig,
  input: PassportA2ProofRequest,
  dependencies: VerifyAndIssuePassportA2Dependencies & {
    action: "issue" | "renew" | "recover";
    owner: string;
    ghostOwner: string;
    mode: VerificationMode;
    allowedExtraKeys?: readonly string[];
  },
): Promise<PassportWrapperPublicOutputs> {
  const validated = validatePassportA2ProofRequest(input, dependencies.allowedExtraKeys);
  const parseWrapperPublicInputs = dependencies.parseWrapperPublicInputs ?? parsePassportWrapperPublicInputs;
  const proofBoundPublicInputs = readProofBoundWrapperPublicInputs(validated.wrapperProof);
  if (proofBoundPublicInputs) {
    assertSameWrapperPublicInputs(
      proofBoundPublicInputs,
      validated.wrapperPublicInputs,
      "wrapperProof.publicInputs must match wrapperPublicInputs.",
    );
  }
  let wrapperOutputs = proofBoundPublicInputs
    ? validatePassportA2WrapperOutputs(parseWrapperPublicInputs(proofBoundPublicInputs))
    : undefined;
  if (wrapperOutputs) {
    assertPassportA2PayloadMatchesWrapperOutputs(validated, wrapperOutputs);
  }

  const verifyWrapperProof =
    dependencies.verifyWrapperProof ??
    ((proof: unknown) =>
      defaultVerifyPassportWrapperProof(
        proof,
        config.zkPassportDevMode ? "development" : "production",
      ));
  const verification = normalizeWrapperVerificationResult(await verifyWrapperProof(validated.wrapperProof));
  if (!verification.verified) {
    throw new Error("Passport A2 recursive wrapper proof verification failed.");
  }

  let boundPublicInputs = proofBoundPublicInputs;
  if (verification.publicInputs) {
    if (boundPublicInputs) {
      assertSameWrapperPublicInputs(
        verification.publicInputs,
        boundPublicInputs,
        "Verifier-attested public inputs must match wrapperProof.publicInputs.",
      );
    } else {
      assertSameWrapperPublicInputs(
        verification.publicInputs,
        validated.wrapperPublicInputs,
        "Verifier-attested public inputs must match wrapperPublicInputs.",
      );
      boundPublicInputs = verification.publicInputs;
    }
  }
  if (!boundPublicInputs) {
    throw new Error("Passport A2 wrapper proof public inputs must be proof-bound or verifier-attested.");
  }

  if (!wrapperOutputs) {
    wrapperOutputs = validatePassportA2WrapperOutputs(parseWrapperPublicInputs(boundPublicInputs));
    assertPassportA2PayloadMatchesWrapperOutputs(validated, wrapperOutputs);
  }
  validatePassportA2TimeBounds(config, wrapperOutputs, dependencies.nowMs ?? Date.now);
  await assertPassportA2RegistryTrust({
    config,
    registryContext: validated.registryContext,
    registryClient: dependencies.registryClient,
    nowMs: dependencies.nowMs ?? Date.now,
  });
  await assertPassportA2RequestContext({
    config,
    outputs: wrapperOutputs,
    action: dependencies.action,
    owner: dependencies.owner,
    ghostOwner: dependencies.ghostOwner,
    mode: dependencies.mode,
    registryContext: validated.registryContext,
  });

  return wrapperOutputs;
}

export type VerifyAndIssuePassportHandlerKind = "passport-a2";

export function selectVerifyAndIssuePassportHandler(input: unknown): VerifyAndIssuePassportHandlerKind {
  if (isPassportA2Request(input)) {
    return "passport-a2";
  }
  throw new Error("Passport requests must use schema passport-a2-v1.");
}

export async function dispatchVerifyAndIssuePassportRequest(
  config: VerificationApiConfig,
  input: VerifyAndIssuePassportA2Request,
  contextLoader: () => Promise<IssuanceContext>,
): Promise<VerifyAndIssueResponse> {
  switch (selectVerifyAndIssuePassportHandler(input)) {
    case "passport-a2":
      return verifyAndIssuePassportA2(config, input, contextLoader);
  }
}

export async function verifyAndIssueInstagram(
  config: VerificationApiConfig,
  input: VerifyAndIssueInstagramRequest,
  contextLoader: () => Promise<IssuanceContext>,
  dependencies?: {
    verifyProof?: typeof verifyInstagramProof;
    deriveGhostOwner?: typeof deriveCredentialGhostOwnerAddress;
    networkChainId?: () => Promise<bigint>;
    nowMs?: () => number;
  },
): Promise<VerifyAndIssueInstagramResponse> {
  validateInstagramV2Request(input);
  const activeOwner = requireString(input.activeOwner, "activeOwner");
  // Parsing the proof object once makes these the exact public inputs sent to
  // UltraHonk verification; there is no detached metadata for the API to trust.
  const proof = normalizeInstagramProofData(input.proof);
  const outputs = parseInstagramPublicInputs(proof.publicInputs);
  assertTrustedInstagramDkimPubkeyHash(config.instagramDkimPubkeyHashes, outputs.dkimPubkeyHash);
  const verified = await (dependencies?.verifyProof ?? verifyInstagramProof)(proof);
  if (!verified) {
    throw new Error("Instagram V2 proof verification failed.");
  }
  const networkChainId = dependencies?.networkChainId ?? (async () => {
    const nodeInfo = await createAztecNodeClient(config.aztecNodeUrl).getNodeInfo();
    return BigInt(nodeInfo.l1ChainId);
  });
  const { claimsHash, expiryTs } = assertInstagramV2Context(
    config,
    outputs,
    activeOwner,
    await networkChainId(),
    dependencies?.nowMs ?? Date.now,
  );
  const deriveGhostOwner = dependencies?.deriveGhostOwner ?? deriveCredentialGhostOwnerAddress;
  const ghostDerivationVersion = "v2_scoped" as const;
  const ghostOwner = await deriveGhostOwner(
    outputs.emailNullifier,
    CredentialType.Instagram,
    ghostDerivationVersion,
  );
  const context = await contextLoader();
  const receipt = await context.issuer.methods
    .register_credential(
      AztecAddress.fromStringUnsafe(activeOwner),
      AztecAddress.fromStringUnsafe(ghostOwner),
      new Fr(claimsHash),
      CredentialType.Instagram,
      expiryTs,
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
      piiBlind: true,
      dkimPubkeyHash: normalizeInstagramDkimPubkeyHash(outputs.dkimPubkeyHash),
      emailNullifier: outputs.emailNullifier,
    },
    expiryTs: expiryTs.toString(),
  };
}

export async function verifyAndRefreshRootAuthorityA2(
  config: VerificationApiConfig,
  input: VerifyAndRefreshRootAuthorityA2Request,
  contextLoader: () => Promise<IssuanceContext>,
  dependencies: VerifyAndIssuePassportA2Dependencies = {},
): Promise<VerifyAndRefreshRootAuthorityResponse> {
  validatePassportA2ProofRequest(input, ["activeOwner", "ghostOwner"]);
  const activeOwner = requireString(input.activeOwner, "activeOwner");
  const ghostOwner = requireString(input.ghostOwner, "ghostOwner");
  const wrapperOutputs = await verifyPassportA2Proof(config, input, {
    ...dependencies,
    action: "renew",
    owner: activeOwner,
    ghostOwner,
    mode: "rooted",
    allowedExtraKeys: ["activeOwner", "ghostOwner"],
  });
  const context = await contextLoader();
  const authorizationReceipt = await context.issuer.methods
    .authorize_root_authority_refresh(
      AztecAddress.fromStringUnsafe(activeOwner),
      AztecAddress.fromStringUnsafe(ghostOwner),
      new Fr(BigInt(wrapperOutputs.rootCommitment)),
      new Fr(BigInt(wrapperOutputs.claimsHash)),
      BigInt(wrapperOutputs.credentialValidUntil),
    )
    .send({ from: context.orchestratorAddress });
  const renewalAuthorizationTxHash = readTxHash(authorizationReceipt);
  if (!renewalAuthorizationTxHash) {
    throw new Error("Root authority renewal authorization transaction hash is missing.");
  }

  return {
    renewalAuthorizationTxHash,
    ghostOwner,
    rootCommitment: wrapperOutputs.rootCommitment,
    claimsHash: wrapperOutputs.claimsHash,
    issuerAddress: config.issuerAddress,
    orchestratorAddress: context.orchestratorAddress.toString(),
    verificationSummary: {
      verified: true,
      passportA2: true,
      piiBlind: true,
    },
  };
}

export async function verifyAndRefreshRootAuthority(
  config: VerificationApiConfig,
  input: VerifyAndRefreshRootAuthorityA2Request,
  contextLoader: () => Promise<IssuanceContext>,
): Promise<VerifyAndRefreshRootAuthorityResponse> {
  if (!isPassportA2ProofRequest(input)) {
    throw new Error("Passport renewal requires schema passport-a2-v1.");
  }
  return verifyAndRefreshRootAuthorityA2(config, input, contextLoader);
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
