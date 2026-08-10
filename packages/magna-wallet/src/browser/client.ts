import { ContractInitializationStatus, type Wallet } from "@aztec/aztec.js/wallet";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization";
import { NoteStatus, type NoteDao } from "@aztec/stdlib/note";
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";
import { computeSecretHash } from "@aztec/stdlib/hash";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import {
  MagnaCompanyRightsRegistryContract,
  MagnaCompanySponsorContract,
  MagnaIssuerContract,
  MagnaRightsPurchaseL2Contract,
  MagnaWebAuthnAccountContract,
} from "@magna/contracts-bindings";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { buildCompanySponsorFeeConfig } from "../engine/sponsorship.js";
import {
  deriveGhostKeyMaterial,
  LEGACY_GHOST_DERIVATION_VERSION,
  SCOPED_GHOST_DERIVATION_VERSION,
} from "../engine/ghost.js";
import type {
  GhostDerivationVersion,
  GhostKeyMaterial,
  PassportCanonicalClaims,
  PassportCommittedClaimsWitness,
} from "../engine/types.js";
import { deriveRootCommitment } from "../engine/root.js";
import {
  computePassportCommittedClaimsHashFromWitness,
  poseidon2FieldHasher,
} from "../engine/encoding.js";
import type { Policy } from "@magna/core";
import {
  ClaimId,
  ConstraintOp,
  CredentialType,
} from "@magna/core";
import { normalizePolicy } from "@magna/core";
import {
  bindCompanySponsorContract,
  bindIssuerContract,
  getAztecNode,
  readTxHash,
  registerContractArtifactAtAddress,
  toAddress,
} from "./aztec.js";
import type { MagnaBrowserEnv as MagnaAppEnv } from "./env.js";
import { createEmbeddedWallet, ensureImportedLocalTestAccountAddress } from "../embedded/lifecycle.js";
import { createPublicClient, createWalletClient, http, pad, parseAbiItem, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MAGNA_CLAIMS_DS = 0x4d414743n;
const MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS = 0x4d414e43n;
const MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS = 0x4d414558n;
const HINT_SYNC_ATTEMPTS = 12;
const HINT_SYNC_DELAY_MS = 1_000;
const RIGHTS_SNAPSHOT_SYNC_ATTEMPTS = 20;
const RIGHTS_SNAPSHOT_SYNC_DELAY_MS = 500;
const L1_CLAIM_RETRY_ATTEMPTS = 24;
const L1_CLAIM_RETRY_DELAY_MS = 3_000;
const ERC20_APPROVE_ABI = [parseAbiItem("function approve(address spender, uint256 amount) external returns (bool)")];
const RIGHTS_PURCHASED_EVENT_ABI = parseAbiItem(
  "event RightsPurchased(uint256 indexed purchaseId, bytes32 indexed sponsorAddressOnAztec, uint128 rightsAmount, bytes32 packageId, bytes32 creditNonce, bytes32 contentHash, bytes32 secretHash, bytes32 messageKey, uint256 messageLeafIndex, uint256 paymentAmount, address payer)",
);

export type PassportClaimsForm = {
  nationalityAlpha3: string;
  ageThreshold: string;
  passportExpiryDate: string;
};

export type PolicyForm = {
  minimumAge: string;
  nationalityMode: "any" | "must_be" | "must_not_be";
  nationalityAlpha3: string;
  sponsorSlot: string;
};

export type PassportHints = {
  claimsHash: string;
  hintedCredentialNote: unknown;
  hintedStatusNote: unknown;
};

export type RootedPassportHints = PassportHints & {
  rootCommitment: string;
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
  hintedRootRecoveryNote?: unknown;
  hintedLinkedRecoveryNote?: unknown;
};

export type DiscoveredMagnaCredentialRef = {
  ownerAddress: string;
  kind: "passport" | "instagram";
  mode: "passport" | "rooted";
  claimsHash: string;
  rootCommitment?: string;
  expiryTs?: string;
  issuanceTxHash?: string;
};

export type TxOutcome = {
  txHash?: string;
  receipt: unknown;
};

export type SponsorRightsSnapshot = {
  sponsorAddress: string;
  remainingVerifies: bigint;
  consumedVerifies: bigint;
  lastCreditNonce: bigint;
  latestPackageId: bigint;
  nextPurchaseId: bigint;
  l2PricePerVerify: bigint;
  rightsRegistryAddress: string;
  rightsPurchaseAddress: string;
  paymentTokenAddress: string;
  purchaseTreasuryAddress: string;
};

export type L2TopUpRequest = {
  sponsorAddress: string;
  rightsAmount: string;
  packageId?: string;
};

export type L2TopUpOutcome = TxOutcome & {
  authwitNonce: string;
  paymentAmount: bigint;
  rightsAmount: bigint;
  packageId: bigint;
  purchaseId: bigint;
};

export type L1TopUpRequest = {
  sponsorAddress: string;
  rightsAmount: string;
  packageId?: string;
  extraPolicyHash?: string;
};

export type L1TopUpOutcome = TxOutcome & {
  approveTxHash: string;
  purchaseTxHash: string;
  claimTxHash: string;
  paymentAmount: bigint;
  rightsAmount: bigint;
  packageId: bigint;
  purchaseId: bigint;
  creditNonce: string;
  messageLeafIndex: bigint;
};

export type GhostDerivationInputForm = {
  uniqueIdentifier: string;
  credentialType: CredentialType;
  derivationVersion?: GhostDerivationVersion;
};

export type GhostAccountPreview = {
  uniqueIdentifier: string;
  address: string;
  material: GhostKeyMaterial;
  rootCommitment: bigint;
};

export type ContractCompatibilityMatrix = {
  issuer: Record<string, boolean>;
  defaultSponsorAddress?: string;
  sponsor: Record<string, boolean>;
  sponsorByAddress: Record<string, Record<string, boolean>>;
  rightsRegistry: Record<string, boolean>;
  rightsPurchase: Record<string, boolean>;
};

export type SponsorRuntimeStatus = {
  sponsorAddress: string;
  isActiveDefault: boolean;
  isIssuerAuthorized: boolean | null;
  compatibility: Record<string, boolean>;
};

export { CredentialType };

export const CONTRACT_COMPATIBILITY_REQUIREMENTS = {
  issuer: [
    "register_credential",
    "register_rooted_passport",
    "verify",
    "verify_v2",
    "verify_linked",
    "verify_linked_v2",
    "add_company_sponsor_gateway",
    "remove_company_sponsor_gateway",
    "is_company_sponsor_gateway",
    "refresh_root_authority",
    "recover",
    "recover_root",
    "get_credential_hinted",
    "get_status_hinted",
    "get_root_status_hinted",
    "get_root_authority_hinted",
    "get_root_recovery_hinted",
    "get_linked_credential_hinted",
    "get_linked_status_hinted",
    "get_linked_recovery_hinted",
  ],
  sponsor: [
    "sponsored_verify",
    "sponsored_verify_linked",
    "sponsored_verify_instagram",
    "get_sponsored_verify_count",
  ],
  rightsRegistry: [
    "get_company_rights",
    "get_remaining_verifies",
    "get_consumed_verifies",
    "credit_from_l2_payment",
    "claim_l1_credit",
    "consume_right",
  ],
  rightsPurchase: [
    "purchase_rights_public",
    "get_next_purchase_id",
    "get_price_per_verify",
    "get_payment_token",
    "get_rights_registry",
    "get_treasury",
  ],
} as const;

export type IssuePassportRequest = {
  activeOwner: string;
  ghostOwner?: string;
  ghostUniqueIdentifier?: string;
  claimsForm: PassportClaimsForm;
};

export type IssuePassportDevOrchestratorOptions = {
  wallet?: Wallet;
};

function parseIntField(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid integer.`);
  }
  return parsed;
}

function parseBigIntField(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return BigInt(trimmed);
}

function toField(value: bigint): Fr {
  return new Fr(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

type WalletWithOptionalPxeDebugSync = Wallet & {
  pxe?: {
    debug?: {
      sync?: () => Promise<void>;
      getNotes?: (...args: unknown[]) => Promise<NoteDao[]>;
    };
  };
};

function fieldFromHexString(value: string, label: string): Fr {
  try {
    return Fr.fromHexString(value.startsWith("0x") ? value : `0x${value}`);
  } catch {
    throw new Error(`${label} must be a valid field-compatible hex string.`);
  }
}

function unwrapSimulationResult<T>(value: T | { result: T }): T {
  if (value && typeof value === "object" && "result" in value) {
    return value.result as T;
  }
  return value as T;
}

async function simulateHintedNote(
  methodName: string,
  call: { simulate: (opts: { from: AztecAddress }) => Promise<unknown> },
  from: AztecAddress,
): Promise<unknown> {
  try {
    return unwrapSimulationResult(await call.simulate({ from }));
  } catch (error) {
    throw new Error(`${methodName} failed: ${errorDetails(error)}`);
  }
}

function toBigIntValue(value: unknown): bigint {
  const unwrapped = unwrapSimulationResult(value);
  if (typeof unwrapped === "bigint") {
    return unwrapped;
  }
  if (typeof unwrapped === "number") {
    return BigInt(unwrapped);
  }
  if (typeof unwrapped === "string") {
    return BigInt(unwrapped);
  }
  if (unwrapped && typeof unwrapped === "object" && "inner" in unwrapped) {
    return toBigIntValue((unwrapped as { inner: unknown }).inner);
  }
  if (unwrapped && typeof unwrapped === "object" && "value" in unwrapped) {
    return toBigIntValue((unwrapped as { value: unknown }).value);
  }
  if (unwrapped && typeof (unwrapped as { toBigInt?: () => bigint }).toBigInt === "function") {
    return (unwrapped as { toBigInt: () => bigint }).toBigInt();
  }
  if (unwrapped && typeof (unwrapped as { toString?: () => string }).toString === "function") {
    const asString = (unwrapped as { toString: () => string }).toString();
    if (asString && asString !== "[object Object]") {
      return BigInt(asString);
    }
  }
  throw new Error(`Cannot convert value to bigint: ${String(unwrapped)}`);
}

function toAztecAddressValue(value: unknown): AztecAddress {
  const unwrapped = unwrapSimulationResult(value);
  if (unwrapped instanceof AztecAddress) {
    return unwrapped;
  }
  if (typeof unwrapped === "string") {
    return AztecAddress.fromString(unwrapped);
  }
  if (unwrapped && typeof unwrapped === "object" && "inner" in unwrapped) {
    return toAztecAddressValue((unwrapped as { inner: unknown }).inner);
  }
  if (unwrapped && typeof (unwrapped as { toString?: () => string }).toString === "function") {
    const asString = (unwrapped as { toString: () => string }).toString();
    if (asString && asString !== "[object Object]") {
      return AztecAddress.fromString(asString);
    }
  }
  throw new Error(`Cannot convert value to AztecAddress: ${String(unwrapped)}`);
}

function noteItems(note: NoteDao): unknown[] {
  const maybeItems = (note.note as unknown as { items?: unknown[] }).items;
  if (Array.isArray(maybeItems)) return maybeItems;
  return [];
}

function txHashString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof (value as { toString?: () => string }).toString === "function") {
    const asString = (value as { toString: () => string }).toString();
    return asString && asString !== "[object Object]" ? asString : undefined;
  }
  return undefined;
}

function credentialKindFromType(credentialType: bigint): "passport" | "instagram" | undefined {
  if (credentialType === BigInt(CredentialType.Passport)) return "passport";
  if (credentialType === BigInt(CredentialType.Instagram)) return "instagram";
  return undefined;
}

function toHex32(value: string | bigint, label: string): Hex {
  if (typeof value === "bigint") {
    const hex = `0x${value.toString(16)}` as Hex;
    return pad(hex, { size: 32 });
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("0x")) {
    throw new Error(`${label} must be a 0x-prefixed hex value.`);
  }
  return pad(trimmed as Hex, { size: 32 });
}

function requireL1FundingConfig(env: MagnaAppEnv): {
  l1RpcUrl: string;
  l1RightsPortalAddress: Hex;
  l1PaymentTokenAddress: Hex;
  l1BuyerPrivateKey: Hex;
} {
  if (!env.l1RpcUrl) {
    throw new Error("VITE_MAGNA_L1_RPC_URL is required for L1 top-up.");
  }
  if (!env.l1RightsPortalAddress) {
    throw new Error("VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS is required for L1 top-up.");
  }
  if (!env.l1PaymentTokenAddress) {
    throw new Error("VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS is required for L1 top-up.");
  }
  if (!env.l1BuyerPrivateKey) {
    throw new Error("VITE_MAGNA_L1_BUYER_PRIVATE_KEY is required for L1 top-up in local-dev mode.");
  }
  if (!env.l1BuyerPrivateKey.startsWith("0x")) {
    throw new Error("VITE_MAGNA_L1_BUYER_PRIVATE_KEY must be 0x-prefixed.");
  }
  return {
    l1RpcUrl: env.l1RpcUrl,
    l1RightsPortalAddress: env.l1RightsPortalAddress as Hex,
    l1PaymentTokenAddress: env.l1PaymentTokenAddress as Hex,
    l1BuyerPrivateKey: env.l1BuyerPrivateKey as Hex,
  };
}

async function resolveOrchestratorSenderAddress(
  wallet: Wallet,
  env: MagnaAppEnv,
): Promise<AztecAddress | undefined> {
  const accounts = await wallet.getAccounts();
  if (env.orchestratorAddress) {
    const matchingConfigured = accounts.find(account => account.item.toString() === env.orchestratorAddress);
    if (matchingConfigured) {
      return matchingConfigured.item;
    }
  }

  const expectedAlias = `local-test-${env.localTestAccountIndex}`;
  const matchingAlias = accounts.find(account => account.alias === expectedAlias);
  if (matchingAlias) {
    return matchingAlias.item;
  }

  return undefined;
}

function formatDateInput(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parsePassportExpiryDate(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Passport expiry date must use YYYY-MM-DD format.");
  }
  // Treat passport expiry as end-of-day UTC so the credential does not expire too early.
  const parsed = Date.parse(`${trimmed}T23:59:59Z`);
  if (Number.isNaN(parsed)) {
    throw new Error("Passport expiry date must be a valid calendar date.");
  }
  return BigInt(Math.floor(parsed / 1000));
}

export function createDefaultPassportClaimsForm(): PassportClaimsForm {
  const oneYearAhead = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  return {
    nationalityAlpha3: "TUR",
    ageThreshold: "18",
    passportExpiryDate: formatDateInput(oneYearAhead),
  };
}

export function createDefaultPolicyForm(): PolicyForm {
  return {
    minimumAge: "18",
    nationalityMode: "must_not_be",
    nationalityAlpha3: "USA",
    sponsorSlot: "0",
  };
}

export function packAlpha3(alpha3: string): bigint {
  const normalized = alpha3.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`invalid alpha3 country code: ${alpha3}`);
  }
  const [a, b, c] = normalized.split("").map(character => character.charCodeAt(0));
  return (BigInt(a) << 16n) | (BigInt(b) << 8n) | BigInt(c);
}

async function computePassportClaimsHashAsync(claims: PassportCanonicalClaims): Promise<bigint> {
  const result = await poseidon2HashWithSeparator(
    [
      BigInt(claims.schemaVersion),
      BigInt(claims.credentialType),
      claims.nationalityAlpha3Packed,
      BigInt(claims.minAgeProven),
      claims.expiryTs,
    ],
    Number(MAGNA_CLAIMS_DS),
  );
  return result.toBigInt();
}

async function computePassportCommittedClaimsHashAsync(witness: PassportCommittedClaimsWitness): Promise<bigint> {
  const nationalityCommitment = await poseidon2HashWithSeparator(
    [witness.nationalityAlpha3Packed, witness.nationalityBlind],
    Number(MAGNA_PASSPORT_NATIONALITY_COMMITMENT_DS),
  );
  const expiryCommitment = await poseidon2HashWithSeparator(
    [witness.expiryTs, witness.expiryBlind],
    Number(MAGNA_PASSPORT_EXPIRY_COMMITMENT_DS),
  );
  const result = await poseidon2HashWithSeparator(
    [
      2n,
      BigInt(CredentialType.Passport),
      nationalityCommitment.toBigInt(),
      BigInt(witness.minAgeProven),
      expiryCommitment.toBigInt(),
    ],
    Number(MAGNA_CLAIMS_DS),
  );
  return result.toBigInt();
}

export function passportClaimsFromForm(form: PassportClaimsForm): PassportCanonicalClaims {
  return {
    schemaVersion: 1,
    credentialType: CredentialType.Passport,
    nationalityAlpha3Packed: packAlpha3(form.nationalityAlpha3.trim().toUpperCase()),
    minAgeProven: parseIntField(form.ageThreshold, "zkPassport age threshold"),
    expiryTs: parsePassportExpiryDate(form.passportExpiryDate),
  };
}

export function buildPassportPolicy(form: PolicyForm): Policy {
  const constraints = [
    {
      claimId: ClaimId.AgeMinProven,
      op: ConstraintOp.Gte,
      value: BigInt(parseIntField(form.minimumAge, "Policy minimum age")),
    },
  ];

  const nationalityAlpha3 = form.nationalityAlpha3.trim().toUpperCase();
  if (nationalityAlpha3 && form.nationalityMode !== "any") {
    constraints.push({
      claimId: ClaimId.NationalityAlpha3,
      op: form.nationalityMode === "must_be" ? ConstraintOp.Eq : ConstraintOp.Neq,
      value: packAlpha3(nationalityAlpha3),
    });
  }

  return {
    credentialType: CredentialType.Passport,
    constraints,
  };
}

export function buildPassportClaimsWitness(claims: PassportCanonicalClaims) {
  return {
    minAgeProven: claims.minAgeProven,
    nationalityAlpha3Packed: claims.nationalityAlpha3Packed,
  };
}

export function buildPassportCommittedClaimsWitness(
  claims: PassportCanonicalClaims,
  input: { nationalityBlind: bigint | string; expiryBlind: bigint | string },
): PassportCommittedClaimsWitness {
  return {
    minAgeProven: claims.minAgeProven,
    nationalityAlpha3Packed: claims.nationalityAlpha3Packed,
    nationalityBlind: typeof input.nationalityBlind === "bigint" ? input.nationalityBlind : BigInt(input.nationalityBlind),
    expiryTs: claims.expiryTs,
    expiryBlind: typeof input.expiryBlind === "bigint" ? input.expiryBlind : BigInt(input.expiryBlind),
  };
}

function toContractPassportCommittedClaimsWitness(witness: PassportCommittedClaimsWitness) {
  return {
    min_age_proven: witness.minAgeProven,
    nationality_alpha3_packed: toField(witness.nationalityAlpha3Packed),
    nationality_blind: toField(witness.nationalityBlind),
    expiry_ts: witness.expiryTs,
    expiry_blind: toField(witness.expiryBlind),
  };
}

export function readSponsorSlot(form: PolicyForm): number {
  return parseIntField(form.sponsorSlot, "Sponsor slot");
}

export async function deriveGhostAccountPreview(input: GhostDerivationInputForm): Promise<GhostAccountPreview> {
  const uniqueIdentifier = input.uniqueIdentifier.trim();
  if (!uniqueIdentifier) {
    throw new Error("Scoped unique identifier is required to derive ghost wallet address.");
  }
  const derivationVersion = input.derivationVersion ?? SCOPED_GHOST_DERIVATION_VERSION;
  const material = deriveGhostKeyMaterial({
    uniqueIdentifier,
    credentialType: input.credentialType,
    derivationVersion,
  });
  const address = await getSchnorrAccountContractAddress(
    fieldFromHexString(material.secretHex, "Ghost secret"),
    fieldFromHexString(material.saltHex, "Ghost salt"),
  );
  return {
    uniqueIdentifier,
    address: address.toString(),
    material,
    rootCommitment: deriveRootCommitment({ uniqueIdentifier }),
  };
}

export function isRootedPassportHints(hints: PassportHints | RootedPassportHints): hints is RootedPassportHints {
  return "rootCommitment" in hints;
}

export class MagnaBrowserClient {
  private readonly issuer: MagnaIssuerContract;
  private readonly sponsorsByAddress: Map<string, MagnaCompanySponsorContract>;
  private readonly defaultSponsorAddress?: string;
  private readonly defaultSponsor?: MagnaCompanySponsorContract;
  private readonly rightsRegistry?: MagnaCompanyRightsRegistryContract;
  private readonly rightsPurchase?: MagnaRightsPurchaseL2Contract;
  private readonly l2PaymentToken?: TokenContract;
  private readonly compatibilityMatrix: ContractCompatibilityMatrix;
  private contractRegistrationPromise?: Promise<void>;

  constructor(
    private readonly wallet: Wallet,
    private readonly env: MagnaAppEnv,
    private readonly userAddress: string,
  ) {
    if (!env.issuerAddress) {
      throw new Error("VITE_MAGNA_ISSUER_ADDRESS is required to use Magna flows.");
    }

    this.issuer = bindIssuerContract(wallet, env.issuerAddress);
    this.sponsorsByAddress = new Map();
    for (const sponsorAddress of env.companySponsorAddresses) {
      this.sponsorsByAddress.set(sponsorAddress, bindCompanySponsorContract(wallet, sponsorAddress));
    }
    this.defaultSponsorAddress = env.activeCompanySponsorAddress;
    this.defaultSponsor = this.defaultSponsorAddress ? this.sponsorsByAddress.get(this.defaultSponsorAddress) : undefined;
    this.rightsRegistry = env.rightsRegistryAddress
      ? MagnaCompanyRightsRegistryContract.at(toAddress(env.rightsRegistryAddress), wallet)
      : undefined;
    this.rightsPurchase = env.rightsPurchaseL2Address
      ? MagnaRightsPurchaseL2Contract.at(toAddress(env.rightsPurchaseL2Address), wallet)
      : undefined;
    this.l2PaymentToken = env.l2PaymentTokenAddress
      ? TokenContract.at(toAddress(env.l2PaymentTokenAddress), wallet)
      : undefined;
    this.compatibilityMatrix = this.buildCompatibilityMatrix();
  }

  private assertRealTransactionMode(action: string): void {
    if (!this.env.requireRealSends) {
      throw new Error(
        `${action} requires VITE_MAGNA_REQUIRE_REAL_SENDS=true. ` +
          "This app forbids fake/simulate-only success paths for readiness flows.",
      );
    }
  }

  private ensureL2TopUpContracts(): {
    rightsRegistry: MagnaCompanyRightsRegistryContract;
    rightsPurchase: MagnaRightsPurchaseL2Contract;
    l2PaymentToken: TokenContract;
  } {
    if (!this.rightsRegistry || !this.rightsPurchase || !this.l2PaymentToken) {
      throw new Error(
        "L2 top-up requires VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS, " +
          "VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS, and VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS.",
      );
    }
    return {
      rightsRegistry: this.rightsRegistry,
      rightsPurchase: this.rightsPurchase,
      l2PaymentToken: this.l2PaymentToken,
    };
  }

  private async ensureContractsRegistered(): Promise<void> {
    if (!this.contractRegistrationPromise) {
      this.contractRegistrationPromise = this.registerKnownContracts().catch(error => {
        this.contractRegistrationPromise = undefined;
        throw error;
      });
    }
    await this.contractRegistrationPromise;
  }

  private async registerKnownContracts(): Promise<void> {
    const registrations: Array<{ address: string; artifact: typeof MagnaIssuerContract.artifact }> = [
      {
        address: this.env.issuerAddress!,
        artifact: MagnaIssuerContract.artifact,
      },
      ...Array.from(this.sponsorsByAddress.keys(), sponsorAddress => ({
        address: sponsorAddress,
        artifact: MagnaCompanySponsorContract.artifact,
      })),
    ];

    if (this.env.rightsRegistryAddress) {
      registrations.push({
        address: this.env.rightsRegistryAddress,
        artifact: MagnaCompanyRightsRegistryContract.artifact,
      });
    }

    if (this.env.rightsPurchaseL2Address) {
      registrations.push({
        address: this.env.rightsPurchaseL2Address,
        artifact: MagnaRightsPurchaseL2Contract.artifact,
      });
    }

    if (this.env.l2PaymentTokenAddress) {
      registrations.push({
        address: this.env.l2PaymentTokenAddress,
        artifact: TokenContract.artifact,
      });
    }

    for (const registration of registrations) {
      await registerContractArtifactAtAddress(
        this.wallet,
        this.env.aztecNodeUrl,
        registration.address,
        registration.artifact,
      );
    }
  }

  private buildCompatibilityMatrix(): ContractCompatibilityMatrix {
    const hasMethod = (contract: { methods: Record<string, unknown> } | undefined, method: string): boolean =>
      Boolean(contract && typeof contract.methods?.[method] === "function");
    const sponsorByAddress = Object.fromEntries(
      Array.from(this.sponsorsByAddress.entries()).map(([address, sponsor]) => [
        address,
        Object.fromEntries(
          CONTRACT_COMPATIBILITY_REQUIREMENTS.sponsor.map(method => [method, hasMethod(sponsor, method)]),
        ) as Record<string, boolean>,
      ]),
    ) as Record<string, Record<string, boolean>>;

    return {
      issuer: Object.fromEntries(
        CONTRACT_COMPATIBILITY_REQUIREMENTS.issuer.map(method => [method, hasMethod(this.issuer, method)]),
      ) as Record<string, boolean>,
      defaultSponsorAddress: this.defaultSponsorAddress,
      sponsor: Object.fromEntries(
        CONTRACT_COMPATIBILITY_REQUIREMENTS.sponsor.map(method => [method, hasMethod(this.defaultSponsor, method)]),
      ) as Record<string, boolean>,
      sponsorByAddress,
      rightsRegistry: Object.fromEntries(
        CONTRACT_COMPATIBILITY_REQUIREMENTS.rightsRegistry.map(method => [method, hasMethod(this.rightsRegistry, method)]),
      ) as Record<string, boolean>,
      rightsPurchase: Object.fromEntries(
        CONTRACT_COMPATIBILITY_REQUIREMENTS.rightsPurchase.map(method => [method, hasMethod(this.rightsPurchase, method)]),
      ) as Record<string, boolean>,
    };
  }

  private resolveSponsorContract(sponsorAddress?: string): { sponsorAddress: string; sponsor: MagnaCompanySponsorContract } {
    const requestedAddress = sponsorAddress?.trim() || this.defaultSponsorAddress;
    if (!requestedAddress) {
      throw new Error(
        "Sponsored verification requires a sponsor address. " +
          "Set VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS or pass a sponsor address explicitly.",
      );
    }
    const sponsor = this.sponsorsByAddress.get(requestedAddress);
    if (!sponsor) {
      const known = Array.from(this.sponsorsByAddress.keys());
      throw new Error(
        `Sponsor ${requestedAddress} is not configured. ` +
          (known.length > 0 ? `Known sponsors: ${known.join(", ")}` : "No sponsor addresses configured."),
      );
    }
    return { sponsorAddress: requestedAddress, sponsor };
  }

  private async readIssuerSponsorAuthorization(sponsorAddress: string): Promise<boolean | null> {
    await this.ensureContractsRegistered();
    if (!this.compatibilityMatrix.issuer.is_company_sponsor_gateway) {
      return null;
    }
    const result = await this.issuer.methods
      .is_company_sponsor_gateway(toAddress(sponsorAddress))
      .simulate({ from: toAddress(this.userAddress) });
    return Boolean(unwrapSimulationResult(result));
  }

  async syncOrchestratorSender(): Promise<void> {
    let senderAddress = this.env.orchestratorAddress ? toAddress(this.env.orchestratorAddress) : undefined;
    if (
      !senderAddress &&
      "getAccounts" in this.wallet &&
      typeof (this.wallet as { getAccounts?: unknown }).getAccounts === "function"
    ) {
      senderAddress = await resolveOrchestratorSenderAddress(this.wallet, this.env);
    }
    if (
      !senderAddress &&
      this.env.enableLocalTestBootstrap &&
      "createSchnorrAccount" in this.wallet &&
      typeof (this.wallet as { createSchnorrAccount?: unknown }).createSchnorrAccount === "function"
    ) {
      senderAddress = await ensureImportedLocalTestAccountAddress(this.wallet as any, this.env.localTestAccountIndex);
    }
    if (!senderAddress) {
      return;
    }
    await this.wallet.registerSender(senderAddress, "magna-orchestrator");
  }

  private async syncWalletPxeIfAvailable(): Promise<void> {
    const pxeDebug = (this.wallet as WalletWithOptionalPxeDebugSync).pxe?.debug;
    if (!pxeDebug?.sync) {
      return;
    }
    await pxeDebug.sync();
  }

  private async ensureUserAccountIsDeployed(): Promise<void> {
    await this.syncWalletPxeIfAvailable();
    const metadata = await this.wallet.getContractMetadata(toAddress(this.userAddress));
    if (metadata.initializationStatus === ContractInitializationStatus.INITIALIZED) {
      return;
    }
    throw new Error(
      `Active account ${this.userAddress} is not deployed and initialized on the current Aztec network yet. ` +
        "This wallet is still counterfactual, so private note reads and verify flows cannot run until the account contract is deployed.",
    );
  }

  private async getActiveNotesForStorageSlot(ownerAddress: string, storageSlot: Fr): Promise<NoteDao[]> {
    const debug = (this.wallet as WalletWithOptionalPxeDebugSync).pxe?.debug;
    if (!debug?.getNotes) {
      throw new Error("Wallet PXE does not expose note enumeration.");
    }
    const issuerAddress = toAddress(this.env.issuerAddress!);
    const owner = toAddress(ownerAddress);
    return await debug.getNotes({
      contractAddress: issuerAddress,
      owner,
      storageSlot,
      status: NoteStatus.ACTIVE,
      scopes: [owner],
    });
  }

  private async readAccountAuthNotes(accountAddress: string): Promise<NoteDao[]> {
    const debug = (this.wallet as WalletWithOptionalPxeDebugSync).pxe?.debug;
    if (!debug?.getNotes) {
      throw new Error("Wallet PXE does not expose note enumeration.");
    }
    const account = toAddress(accountAddress);
    return await debug.getNotes({
      contractAddress: account,
      owner: account,
      // The passkey account's signing-key note lives in MagnaWebAuthnAccount's sole
      // SinglePrivateImmutable storage field.
      storageSlot: MagnaWebAuthnAccountContract.storage.signing_public_key.slot,
      status: NoteStatus.ACTIVE,
      scopes: [account],
    });
  }

  /**
   * Ensures the active account's own auth note (MagnaWebAuthnAccount.signing_public_key, a
   * SinglePrivateImmutable) is discovered into this PXE's note store before a transaction the
   * account must authorize. The embedded wallet's pre-flight kernelless simulation replaces the
   * account with a built-in stub (it has no notion of the custom WebAuthn account contract); that
   * stub's note layout differs, so the account's real note is skipped during the simulation's note
   * discovery and never reaches the store. Proactively discovering it here against the real,
   * registered account artifact guarantees `is_valid_impl` can read it during proving. Best-effort:
   * any failure is left for the verify send to surface (with its own clearer error).
   */
  async ensureAccountAuthNoteDiscovered(accountAddress: string): Promise<number> {
    try {
      const notes = await this.readAccountAuthNotes(accountAddress);
      return notes.length;
    } catch (error) {
      console.warn(
        "[magna] account auth-note pre-discovery skipped (verify will surface details if it matters):",
        errorDetails(error),
      );
      return -1;
    }
  }

  /**
   * Diagnostic only: reports whether the passkey account's own `signing_public_key` note is
   * present in this session's PXE, plus the PXE-registered senders/accounts, so a missing account
   * auth-note can be told apart from a missing issuer credential note. Reading notes triggers a
   * just-in-time sync of the account contract.
   */
  async diagnoseAccountAuthNote(
    accountAddress: string,
  ): Promise<{ noteCount: number; senders: string[]; accounts: string[]; error?: string }> {
    let senders: string[] = [];
    let accounts: string[] = [];
    try {
      const pxe = (this.wallet as unknown as { pxe?: { getSenders?: () => Promise<unknown[]> } }).pxe;
      senders = ((await pxe?.getSenders?.()) ?? []).map(value => String(value));
    } catch {
      // best-effort diagnostic
    }
    try {
      accounts = (await this.wallet.getAccounts()).map(account_ => String(account_.item ?? account_));
    } catch {
      // best-effort diagnostic
    }
    try {
      const notes = await this.readAccountAuthNotes(accountAddress);
      return { noteCount: notes.length, senders, accounts };
    } catch (error) {
      return {
        noteCount: -1,
        senders,
        accounts,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private credentialRefFromNote(ownerAddress: string, note: NoteDao): DiscoveredMagnaCredentialRef | undefined {
    const fields = noteItems(note);
    if (fields.length < 3) return undefined;
    const claimsHash = toBigIntValue(fields[0]);
    const credentialType = toBigIntValue(fields[1]);
    const kind = credentialKindFromType(credentialType);
    if (!kind) return undefined;
    return {
      ownerAddress,
      kind,
      mode: "passport",
      claimsHash: claimsHash.toString(),
      expiryTs: toBigIntValue(fields[2]).toString(),
      issuanceTxHash: txHashString(note.txHash),
    };
  }

  private linkedCredentialRefFromNote(ownerAddress: string, note: NoteDao): DiscoveredMagnaCredentialRef | undefined {
    const fields = noteItems(note);
    if (fields.length < 4) return undefined;
    const rootCommitment = toBigIntValue(fields[0]);
    const claimsHash = toBigIntValue(fields[1]);
    const credentialType = toBigIntValue(fields[2]);
    const kind = credentialKindFromType(credentialType);
    if (!kind) return undefined;
    return {
      ownerAddress,
      kind,
      mode: "rooted",
      rootCommitment: rootCommitment.toString(),
      claimsHash: claimsHash.toString(),
      expiryTs: toBigIntValue(fields[3]).toString(),
      issuanceTxHash: txHashString(note.txHash),
    };
  }

  async discoverCredentialRefs(ownerAddress = this.userAddress): Promise<DiscoveredMagnaCredentialRef[]> {
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    await this.syncOrchestratorSender();
    await this.syncWalletPxeIfAvailable();

    const simpleNotes = await this.getActiveNotesForStorageSlot(
      ownerAddress,
      MagnaIssuerContract.storage.credential_notes.slot,
    );
    const linkedNotes = await this.getActiveNotesForStorageSlot(
      ownerAddress,
      MagnaIssuerContract.storage.linked_credential_notes.slot,
    );
    const discovered = [
      ...simpleNotes.map(note => this.credentialRefFromNote(ownerAddress, note)),
      ...linkedNotes.map(note => this.linkedCredentialRefFromNote(ownerAddress, note)),
    ].filter((ref): ref is DiscoveredMagnaCredentialRef => Boolean(ref));
    const byId = new Map<string, DiscoveredMagnaCredentialRef>();
    for (const ref of discovered) {
      byId.set(`${ref.ownerAddress}:${ref.kind}:${ref.claimsHash}:${ref.rootCommitment ?? ""}`, ref);
    }
    return Array.from(byId.values());
  }

  private isHintedNoteLookupPendingError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("credential note not found") ||
      message.includes("status note not found") ||
      message.includes("linked credential note not found") ||
      message.includes("linked status note not found") ||
      message.includes("root status note not found") ||
      message.includes("root authority note not found") ||
      message.includes("root recovery note not found") ||
      message.includes("linked recovery note not found")
    );
  }

  private async readPassportHintsOnce(ownerAddress: string, claimsHash: bigint): Promise<PassportHints> {
    const owner = toAddress(ownerAddress);
    const claims = toField(claimsHash);
    const hintedCredentialNote = await simulateHintedNote(
      "get_credential_hinted",
      this.issuer.methods.get_credential_hinted(owner, claims),
      owner,
    );
    const hintedStatusNote = await simulateHintedNote(
      "get_status_hinted",
      this.issuer.methods.get_status_hinted(owner, claims),
      owner,
    );

    return {
      claimsHash: claimsHash.toString(),
      hintedCredentialNote,
      hintedStatusNote,
    };
  }

  private async readRootedPassportHintsOnce(
    ownerAddress: string,
    rootCommitment: bigint,
    claimsHash: bigint,
  ): Promise<RootedPassportHints> {
    const owner = toAddress(ownerAddress);
    const root = toField(rootCommitment);
    const claims = toField(claimsHash);
    const hintedCredentialNote = await simulateHintedNote(
      "get_linked_credential_hinted",
      this.issuer.methods.get_linked_credential_hinted(owner, root, claims),
      owner,
    );
    const hintedStatusNote = await simulateHintedNote(
      "get_linked_status_hinted",
      this.issuer.methods.get_linked_status_hinted(owner, root, claims),
      owner,
    );
    const hintedRootStatusNote = await simulateHintedNote(
      "get_root_status_hinted",
      this.issuer.methods.get_root_status_hinted(owner, root),
      owner,
    );
    const hintedRootAuthorityNote = await simulateHintedNote(
      "get_root_authority_hinted",
      this.issuer.methods.get_root_authority_hinted(owner, root, claims),
      owner,
    );

    return {
      claimsHash: claimsHash.toString(),
      rootCommitment: rootCommitment.toString(),
      hintedCredentialNote,
      hintedStatusNote,
      hintedRootStatusNote,
      hintedRootAuthorityNote,
    };
  }

  async fetchPassportHintsByClaimsHash(ownerAddress: string, claimsHash: bigint | string): Promise<PassportHints> {
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const normalizedClaimsHash = typeof claimsHash === "bigint" ? claimsHash : BigInt(claimsHash);
    for (let attempt = 0; attempt < HINT_SYNC_ATTEMPTS; attempt += 1) {
      try {
        await this.syncWalletPxeIfAvailable();
        return await this.readPassportHintsOnce(ownerAddress, normalizedClaimsHash);
      } catch (error) {
        if (!this.isHintedNoteLookupPendingError(error) || attempt === HINT_SYNC_ATTEMPTS - 1) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Fetch hinted notes failed for claims hash ${normalizedClaimsHash.toString()} on owner ${ownerAddress}: ${message}`,
          );
        }
        await sleep(HINT_SYNC_DELAY_MS);
      }
    }

    throw new Error(
      `Fetch hinted notes timed out for claims hash ${normalizedClaimsHash.toString()} on owner ${ownerAddress}.`,
    );
  }

  async fetchPassportHints(ownerAddress: string, claimsForm: PassportClaimsForm): Promise<PassportHints> {
    const claims = passportClaimsFromForm(claimsForm);
    const claimsHash = await computePassportClaimsHashAsync(claims);
    return await this.fetchPassportHintsByClaimsHash(ownerAddress, claimsHash);
  }

  async fetchPassportV2Hints(ownerAddress: string, claimsWitness: PassportCommittedClaimsWitness): Promise<PassportHints> {
    const claimsHash = await computePassportCommittedClaimsHashAsync(claimsWitness);
    return await this.fetchPassportHintsByClaimsHash(ownerAddress, claimsHash);
  }

  async fetchRootedPassportHintsByClaimsHash(
    ownerAddress: string,
    rootCommitment: bigint | string,
    claimsHash: bigint | string,
  ): Promise<RootedPassportHints> {
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const normalizedClaimsHash = typeof claimsHash === "bigint" ? claimsHash : BigInt(claimsHash);
    const normalizedRootCommitment = typeof rootCommitment === "bigint" ? rootCommitment : BigInt(rootCommitment);
    for (let attempt = 0; attempt < HINT_SYNC_ATTEMPTS; attempt += 1) {
      try {
        await this.syncWalletPxeIfAvailable();
        return await this.readRootedPassportHintsOnce(ownerAddress, normalizedRootCommitment, normalizedClaimsHash);
      } catch (error) {
        if (!this.isHintedNoteLookupPendingError(error) || attempt === HINT_SYNC_ATTEMPTS - 1) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Fetch rooted hinted notes failed for root ${normalizedRootCommitment.toString()} ` +
              `claims hash ${normalizedClaimsHash.toString()} on owner ${ownerAddress}: ${message}`,
          );
        }
        await sleep(HINT_SYNC_DELAY_MS);
      }
    }
    throw new Error(
      `Fetch rooted hinted notes timed out for root ${normalizedRootCommitment.toString()} ` +
        `claims hash ${normalizedClaimsHash.toString()} on owner ${ownerAddress}.`,
    );
  }

  async fetchRootedPassportHints(
    ownerAddress: string,
    rootCommitment: bigint | string,
    claimsForm: PassportClaimsForm,
  ): Promise<RootedPassportHints> {
    const claims = passportClaimsFromForm(claimsForm);
    const claimsHash = await computePassportClaimsHashAsync(claims);
    return await this.fetchRootedPassportHintsByClaimsHash(ownerAddress, rootCommitment, claimsHash);
  }

  async fetchRootedPassportV2Hints(
    ownerAddress: string,
    rootCommitment: bigint | string,
    claimsWitness: PassportCommittedClaimsWitness,
  ): Promise<RootedPassportHints> {
    const claimsHash = await computePassportCommittedClaimsHashAsync(claimsWitness);
    return await this.fetchRootedPassportHintsByClaimsHash(ownerAddress, rootCommitment, claimsHash);
  }

  async verifyPassport(claimsForm: PassportClaimsForm, policyForm: PolicyForm, hints: PassportHints): Promise<TxOutcome> {
    this.assertRealTransactionMode("verifyPassport");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const claims = passportClaimsFromForm(claimsForm);
    const witness = buildPassportClaimsWitness(claims);
    const policy = buildPassportPolicy(policyForm);
    const normalizedPolicy = normalizePolicy(policy);
    const receipt = await this.issuer.methods
      .verify(
        {
          credential_type: normalizedPolicy.credentialType,
          constraints: normalizedPolicy.constraints.map(constraint => ({
            claim_id: constraint.claimId,
            op: constraint.op,
            value: constraint.value,
          })),
        },
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        witness.minAgeProven,
        toField(witness.nationalityAlpha3Packed),
        readSponsorSlot(policyForm),
      )
      .send({ from: toAddress(this.userAddress) });

    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async verifyPassportV2(
    claimsWitness: PassportCommittedClaimsWitness,
    policyForm: PolicyForm,
    hints: PassportHints,
  ): Promise<TxOutcome> {
    this.assertRealTransactionMode("verifyPassportV2");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const policy = buildPassportPolicy(policyForm);
    const normalizedPolicy = normalizePolicy(policy);
    const receipt = await this.issuer.methods
      .verify_v2(
        {
          credential_type: normalizedPolicy.credentialType,
          constraints: normalizedPolicy.constraints.map(constraint => ({
            claim_id: constraint.claimId,
            op: constraint.op,
            value: constraint.value,
          })),
        },
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        toContractPassportCommittedClaimsWitness(claimsWitness),
        readSponsorSlot(policyForm),
      )
      .send({ from: toAddress(this.userAddress) });

    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async verifyPassportWithCompanySponsor(
    claimsForm: PassportClaimsForm,
    policyForm: PolicyForm,
    hints: PassportHints,
    sponsorAddress?: string,
  ): Promise<TxOutcome> {
    this.assertRealTransactionMode("verifyPassportWithCompanySponsor");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const selectedSponsor = this.resolveSponsorContract(sponsorAddress);
    const isIssuerAuthorized = await this.readIssuerSponsorAuthorization(selectedSponsor.sponsorAddress);
    if (isIssuerAuthorized === false) {
      throw new Error(
        `Selected sponsor ${selectedSponsor.sponsorAddress} is not currently authorized by issuer ${this.issuer.address.toString()}.`,
      );
    }

    const claims = passportClaimsFromForm(claimsForm);
    const witness = buildPassportClaimsWitness(claims);
    const policy = buildPassportPolicy(policyForm);
    const normalizedPolicy = normalizePolicy(policy);
    const fee = buildCompanySponsorFeeConfig(toAddress(selectedSponsor.sponsorAddress)) as any;
    const sponsorScope = toAddress(selectedSponsor.sponsorAddress);
    const receipt = await selectedSponsor.sponsor.methods
      .sponsored_verify(
        {
          credential_type: normalizedPolicy.credentialType,
          constraints: normalizedPolicy.constraints.map(constraint => ({
            claim_id: constraint.claimId,
            op: constraint.op,
            value: constraint.value,
          })),
        },
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        witness.minAgeProven,
        toField(witness.nationalityAlpha3Packed),
        readSponsorSlot(policyForm),
      )
      .send({
        from: toAddress(this.userAddress),
        fee,
        // Sponsored private calls enter through the sponsor but prove issuer-owned notes.
        additionalScopes: [sponsorScope, toAddress(this.env.issuerAddress!)],
      });

    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async verifyRootedPassport(
    claimsForm: PassportClaimsForm,
    policyForm: PolicyForm,
    hints: RootedPassportHints,
  ): Promise<TxOutcome> {
    this.assertRealTransactionMode("verifyRootedPassport");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const claims = passportClaimsFromForm(claimsForm);
    const witness = buildPassportClaimsWitness(claims);
    const policy = buildPassportPolicy(policyForm);
    const normalizedPolicy = normalizePolicy(policy);
    const receipt = await this.issuer.methods
      .verify_linked(
        {
          credential_type: normalizedPolicy.credentialType,
          constraints: normalizedPolicy.constraints.map(constraint => ({
            claim_id: constraint.claimId,
            op: constraint.op,
            value: constraint.value,
          })),
        },
        hints.hintedRootStatusNote as never,
        hints.hintedRootAuthorityNote as never,
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        witness.minAgeProven,
        toField(witness.nationalityAlpha3Packed),
        readSponsorSlot(policyForm),
      )
      .send({ from: toAddress(this.userAddress) });

    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async verifyRootedPassportV2(
    claimsWitness: PassportCommittedClaimsWitness,
    policyForm: PolicyForm,
    hints: RootedPassportHints,
  ): Promise<TxOutcome> {
    this.assertRealTransactionMode("verifyRootedPassportV2");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const policy = buildPassportPolicy(policyForm);
    const normalizedPolicy = normalizePolicy(policy);
    const receipt = await this.issuer.methods
      .verify_linked_v2(
        {
          credential_type: normalizedPolicy.credentialType,
          constraints: normalizedPolicy.constraints.map(constraint => ({
            claim_id: constraint.claimId,
            op: constraint.op,
            value: constraint.value,
          })),
        },
        hints.hintedRootStatusNote as never,
        hints.hintedRootAuthorityNote as never,
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        toContractPassportCommittedClaimsWitness(claimsWitness),
        readSponsorSlot(policyForm),
      )
      .send({ from: toAddress(this.userAddress) });

    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async verifyRootedPassportWithCompanySponsor(
    claimsForm: PassportClaimsForm,
    policyForm: PolicyForm,
    hints: RootedPassportHints,
    sponsorAddress?: string,
  ): Promise<TxOutcome> {
    this.assertRealTransactionMode("verifyRootedPassportWithCompanySponsor");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const selectedSponsor = this.resolveSponsorContract(sponsorAddress);
    const isIssuerAuthorized = await this.readIssuerSponsorAuthorization(selectedSponsor.sponsorAddress);
    if (isIssuerAuthorized === false) {
      throw new Error(
        `Selected sponsor ${selectedSponsor.sponsorAddress} is not currently authorized by issuer ${this.issuer.address.toString()}.`,
      );
    }

    const claims = passportClaimsFromForm(claimsForm);
    const witness = buildPassportClaimsWitness(claims);
    const policy = buildPassportPolicy(policyForm);
    const normalizedPolicy = normalizePolicy(policy);
    const fee = buildCompanySponsorFeeConfig(toAddress(selectedSponsor.sponsorAddress)) as any;
    const sponsorScope = toAddress(selectedSponsor.sponsorAddress);
    const receipt = await selectedSponsor.sponsor.methods
      .sponsored_verify_linked(
        {
          credential_type: normalizedPolicy.credentialType,
          constraints: normalizedPolicy.constraints.map(constraint => ({
            claim_id: constraint.claimId,
            op: constraint.op,
            value: constraint.value,
          })),
        },
        hints.hintedRootStatusNote as never,
        hints.hintedRootAuthorityNote as never,
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        witness.minAgeProven,
        toField(witness.nationalityAlpha3Packed),
        readSponsorSlot(policyForm),
      )
      .send({
        from: toAddress(this.userAddress),
        fee,
        additionalScopes: [sponsorScope, toAddress(this.env.issuerAddress!)],
      });

    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async fetchRootRecoveryHint(ownerAddress: string, rootCommitment: bigint | string): Promise<unknown> {
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    await this.syncOrchestratorSender();
    const normalizedRootCommitment = typeof rootCommitment === "bigint" ? rootCommitment : BigInt(rootCommitment);
    for (let attempt = 0; attempt < HINT_SYNC_ATTEMPTS; attempt += 1) {
      try {
        await this.syncWalletPxeIfAvailable();
        return await this.issuer.methods
          .get_root_recovery_hinted(toAddress(ownerAddress), toField(normalizedRootCommitment))
          .simulate({ from: toAddress(ownerAddress) })
          .then((simulation: unknown) => unwrapSimulationResult(simulation));
      } catch (error) {
        if (!this.isHintedNoteLookupPendingError(error) || attempt === HINT_SYNC_ATTEMPTS - 1) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Fetch root recovery hint failed for root ${normalizedRootCommitment.toString()} on owner ${ownerAddress}: ${message}`,
          );
        }
        await sleep(HINT_SYNC_DELAY_MS);
      }
    }

    throw new Error(
      `Fetch root recovery hint timed out for root ${normalizedRootCommitment.toString()} on owner ${ownerAddress}.`,
    );
  }

  async recoverRoot(hintedRootRecoveryNote: unknown, newActiveOwner: string): Promise<TxOutcome> {
    this.assertRealTransactionMode("recoverRoot");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const receipt = await this.issuer.methods
      .recover_root(hintedRootRecoveryNote as never, toAddress(newActiveOwner))
      .send({ from: toAddress(this.userAddress) });
    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async refreshRootAuthority(
    ghostOwner: string,
    claimsForm: PassportClaimsForm,
    hints: RootedPassportHints,
  ): Promise<TxOutcome> {
    this.assertRealTransactionMode("refreshRootAuthority");
    await this.ensureContractsRegistered();
    const authoritySender = this.env.orchestratorAddress ?? this.userAddress;
    if (this.env.orchestratorAddress) {
      await this.syncOrchestratorSender();
    } else {
      await this.ensureUserAccountIsDeployed();
    }
    const claims = passportClaimsFromForm(claimsForm);
    const claimsHash = await computePassportClaimsHashAsync(claims);
    const receipt = await this.issuer.methods
      .refresh_root_authority(
        toAddress(ghostOwner),
        hints.hintedRootStatusNote as never,
        hints.hintedRootAuthorityNote as never,
        toField(claimsHash),
        claims.expiryTs,
      )
      .send({ from: toAddress(authoritySender) });
    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async refreshRootAuthorityAuthorized(
    ghostOwner: string,
    claimsWitness: PassportCommittedClaimsWitness,
    credentialValidUntil: bigint,
    hints: RootedPassportHints,
  ): Promise<TxOutcome> {
    this.assertRealTransactionMode("refreshRootAuthorityAuthorized");
    await this.ensureContractsRegistered();
    await this.ensureUserAccountIsDeployed();
    const claimsHash = computePassportCommittedClaimsHashFromWitness(claimsWitness, poseidon2FieldHasher);
    const receipt = await this.issuer.methods
      .refresh_root_authority_authorized(
        toAddress(ghostOwner),
        hints.hintedRootStatusNote as never,
        hints.hintedRootAuthorityNote as never,
        toField(claimsHash),
        credentialValidUntil,
      )
      .send({ from: toAddress(this.userAddress) });
    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }

  async readSponsorRightsSnapshot(sponsorAddress: string): Promise<SponsorRightsSnapshot> {
    await this.ensureContractsRegistered();
    const { rightsRegistry, rightsPurchase } = this.ensureL2TopUpContracts();
    const sponsor = toAddress(sponsorAddress);

    const remainingVerifies = await rightsRegistry.methods
      .get_remaining_verifies(sponsor)
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const consumedVerifies = await rightsRegistry.methods
      .get_consumed_verifies(sponsor)
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const lastCreditNonce = await rightsRegistry.methods
      .get_last_credit_nonce(sponsor)
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const latestPackageId = await rightsRegistry.methods
      .get_package_id(sponsor)
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const nextPurchaseId = await rightsPurchase.methods
      .get_next_purchase_id()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const l2PricePerVerify = await rightsPurchase.methods
      .get_price_per_verify()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const paymentTokenAddress = await rightsPurchase.methods
      .get_payment_token()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toAztecAddressValue(simulation).toString());
    const purchaseTreasuryAddress = await rightsPurchase.methods
      .get_treasury()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toAztecAddressValue(simulation).toString());

    return {
      sponsorAddress,
      remainingVerifies,
      consumedVerifies,
      lastCreditNonce,
      latestPackageId,
      nextPurchaseId,
      l2PricePerVerify,
      rightsRegistryAddress: rightsRegistry.address.toString(),
      rightsPurchaseAddress: rightsPurchase.address.toString(),
      paymentTokenAddress,
      purchaseTreasuryAddress,
    };
  }

  async waitForSponsorRightsSnapshotPurchaseSync(
    sponsorAddress: string,
    purchaseId: bigint,
  ): Promise<SponsorRightsSnapshot> {
    let lastSnapshot: SponsorRightsSnapshot | null = null;
    for (let attempt = 0; attempt < RIGHTS_SNAPSHOT_SYNC_ATTEMPTS; attempt += 1) {
      const snapshot = await this.readSponsorRightsSnapshot(sponsorAddress);
      lastSnapshot = snapshot;
      if (snapshot.nextPurchaseId > purchaseId) {
        return snapshot;
      }
      await sleep(RIGHTS_SNAPSHOT_SYNC_DELAY_MS);
    }
    if (lastSnapshot) {
      return lastSnapshot;
    }
    throw new Error("Timed out while waiting for sponsor rights snapshot to reflect the top-up.");
  }

  async topUpSponsorRightsFromL2Payment(request: L2TopUpRequest): Promise<L2TopUpOutcome> {
    this.assertRealTransactionMode("topUpSponsorRightsFromL2Payment");
    await this.ensureContractsRegistered();
    const { rightsPurchase, l2PaymentToken } = this.ensureL2TopUpContracts();
    const sponsor = toAddress(request.sponsorAddress);
    const rightsAmount = parseBigIntField(request.rightsAmount, "Top-up rights amount");
    if (rightsAmount <= 0n) {
      throw new Error("Top-up rights amount must be greater than zero.");
    }

    const authwitNonce = Fr.random();
    const pricePerVerify = await rightsPurchase.methods
      .get_price_per_verify()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const paymentAmount = rightsAmount * pricePerVerify;
    const packageId = request.packageId ? parseBigIntField(request.packageId, "Top-up package id") : Fr.random().toBigInt();
    const treasury = await rightsPurchase.methods
      .get_treasury()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toAztecAddressValue(simulation));

    const transferCall = l2PaymentToken.methods.transfer_in_public(
      toAddress(this.userAddress),
      treasury,
      paymentAmount,
      authwitNonce,
    );
    const authwitTx = await SetPublicAuthwitContractInteraction.create(
      this.wallet,
      toAddress(this.userAddress),
      {
        caller: rightsPurchase.address,
        action: transferCall,
      },
      true,
    );
    await authwitTx.send();

    const purchaseReceipt = await rightsPurchase.methods
      .purchase_rights_public(sponsor, rightsAmount, packageId, authwitNonce)
      .send({ from: toAddress(this.userAddress) });
    const purchaseId = await rightsPurchase.methods
      .get_next_purchase_id()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation) - 1n);

    return {
      txHash: readTxHash(purchaseReceipt),
      receipt: purchaseReceipt,
      authwitNonce: authwitNonce.toString(),
      paymentAmount,
      rightsAmount,
      packageId,
      purchaseId,
    };
  }

  async topUpSponsorRightsFromL1Purchase(request: L1TopUpRequest): Promise<L1TopUpOutcome> {
    this.assertRealTransactionMode("topUpSponsorRightsFromL1Purchase");
    await this.ensureContractsRegistered();
    const { rightsRegistry, rightsPurchase } = this.ensureL2TopUpContracts();
    const sponsor = toAddress(request.sponsorAddress);
    const rightsAmount = parseBigIntField(request.rightsAmount, "Top-up rights amount");
    if (rightsAmount <= 0n) {
      throw new Error("Top-up rights amount must be greater than zero.");
    }

    const packageId = request.packageId ? parseBigIntField(request.packageId, "Top-up package id") : Fr.random().toBigInt();
    const packageIdField = toField(packageId);
    const pricePerVerify = await rightsPurchase.methods
      .get_price_per_verify()
      .simulate({ from: toAddress(this.userAddress) })
      .then((simulation: unknown) => toBigIntValue(simulation));
    const paymentAmount = rightsAmount * pricePerVerify;

    const l1Config = requireL1FundingConfig(this.env);
    const l1Account = privateKeyToAccount(l1Config.l1BuyerPrivateKey);
    const l1PublicClient = createPublicClient({
      transport: http(l1Config.l1RpcUrl),
    });
    const l1WalletClient = createWalletClient({
      account: l1Account,
      transport: http(l1Config.l1RpcUrl),
    });

    const approveTxHash = await l1WalletClient.writeContract({
      chain: undefined,
      address: l1Config.l1PaymentTokenAddress,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [l1Config.l1RightsPortalAddress, paymentAmount],
    });
    await l1PublicClient.waitForTransactionReceipt({ hash: approveTxHash });

    const secret = Fr.random();
    const secretHash = await computeSecretHash(secret);
    const sponsorAsHex32 = toHex32(sponsor.toString(), "sponsor address");
    const extraPolicyHash = request.extraPolicyHash?.trim()
      ? toHex32(request.extraPolicyHash.trim(), "Top-up extra policy hash")
      : toHex32(Fr.random().toString(), "Top-up extra policy hash");
    const purchaseTxHash = await l1WalletClient.writeContract({
      chain: undefined,
      address: l1Config.l1RightsPortalAddress,
      abi: [RIGHTS_PURCHASED_EVENT_ABI, parseAbiItem("function purchaseRights(bytes32 sponsorAddressOnAztec, uint128 rightsAmount, bytes32 secretHash, bytes32 packageId, bytes32 extraPolicyHash) external returns (uint256 purchaseId, bytes32 creditNonce, bytes32 messageKey, uint256 messageLeafIndex)")],
      functionName: "purchaseRights",
      args: [
        sponsorAsHex32,
        rightsAmount,
        toHex32(secretHash.toString(), "secret hash"),
        toHex32(packageId, "package id"),
        extraPolicyHash,
      ],
    });
    const purchaseReceipt = await l1PublicClient.waitForTransactionReceipt({ hash: purchaseTxHash });

    const purchasedLogs = await l1PublicClient.getLogs({
      address: l1Config.l1RightsPortalAddress,
      event: RIGHTS_PURCHASED_EVENT_ABI,
      fromBlock: purchaseReceipt.blockNumber,
      toBlock: purchaseReceipt.blockNumber,
    });
    const purchased = purchasedLogs[0];
    if (!purchased) {
      throw new Error("L1 RightsPurchased event not found for top-up transaction.");
    }
    const purchasedArgs = (purchased.args ?? {}) as Record<string, unknown>;
    const purchaseId = toBigIntValue(purchasedArgs.purchaseId);
    const messageLeafIndex = toBigIntValue(purchasedArgs.messageLeafIndex);
    const creditNonce = purchasedArgs.creditNonce;
    if (typeof creditNonce !== "string" || !creditNonce.startsWith("0x")) {
      throw new Error("L1 RightsPurchased event is missing a valid creditNonce.");
    }
    const creditNonceField = Fr.fromHexString(creditNonce);

    let claimReceipt: unknown;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < L1_CLAIM_RETRY_ATTEMPTS; attempt += 1) {
      try {
        claimReceipt = await rightsRegistry.methods
          .claim_l1_credit(sponsor, rightsAmount, packageIdField, creditNonceField, secret, messageLeafIndex)
          .send({ from: toAddress(this.userAddress) });
        break;
      } catch (error) {
        lastError = error;
        await sleep(L1_CLAIM_RETRY_DELAY_MS);
      }
    }
    if (!claimReceipt) {
      const detail = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Timed out waiting to claim L1 top-up message on L2: ${detail}`);
    }

    const claimTxHash = readTxHash(claimReceipt);
    return {
      txHash: claimTxHash,
      receipt: claimReceipt,
      claimTxHash: claimTxHash ?? "unknown",
      approveTxHash,
      purchaseTxHash,
      paymentAmount,
      rightsAmount,
      packageId,
      purchaseId,
      creditNonce,
      messageLeafIndex,
    };
  }

  deriveGhostMaterial(input: GhostDerivationInputForm): GhostKeyMaterial {
    return deriveGhostKeyMaterial({
      uniqueIdentifier: input.uniqueIdentifier,
      credentialType: input.credentialType,
      derivationVersion: input.derivationVersion ?? SCOPED_GHOST_DERIVATION_VERSION,
    });
  }

  deriveRootCommitment(uniqueIdentifier: string): bigint {
    return deriveRootCommitment({ uniqueIdentifier });
  }

  getContractCompatibilityMatrix(): ContractCompatibilityMatrix {
    return this.compatibilityMatrix;
  }

  async getSponsorRuntimeStatuses(): Promise<SponsorRuntimeStatus[]> {
    await this.ensureContractsRegistered();
    const statuses: SponsorRuntimeStatus[] = [];
    for (const [sponsorAddress] of this.sponsorsByAddress.entries()) {
      const compatibility = this.compatibilityMatrix.sponsorByAddress[sponsorAddress] ?? {};
      const isIssuerAuthorized = await this.readIssuerSponsorAuthorization(sponsorAddress);
      statuses.push({
        sponsorAddress,
        isActiveDefault: sponsorAddress === this.defaultSponsorAddress,
        isIssuerAuthorized,
        compatibility,
      });
    }
    return statuses;
  }

  async addCompanySponsorGateway(sponsorAddress: string): Promise<TxOutcome> {
    this.assertRealTransactionMode("addCompanySponsorGateway");
    await this.ensureContractsRegistered();
    const receipt = await this.issuer.methods
      .add_company_sponsor_gateway(toAddress(sponsorAddress))
      .send({ from: toAddress(this.userAddress) });
    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }
}

export async function issuePassportWithDevOrchestrator(
  env: MagnaAppEnv,
  request: IssuePassportRequest,
  options: IssuePassportDevOrchestratorOptions = {},
): Promise<TxOutcome & { claimsHash: string }> {
  if (!env.enableDevOrchestrator) {
    throw new Error("Dev orchestrator mode is disabled.");
  }
  if (env.requireRealSends !== true) {
    throw new Error("Dev issuance requires VITE_MAGNA_REQUIRE_REAL_SENDS=true.");
  }
  if (!env.issuerAddress) {
    throw new Error("VITE_MAGNA_ISSUER_ADDRESS is required to issue credentials.");
  }

  let wallet = options.wallet;
  let senderAddress = wallet ? await resolveOrchestratorSenderAddress(wallet, env) : undefined;

  if (!wallet || !senderAddress) {
    const embeddedWallet = await createEmbeddedWallet(env.aztecNodeUrl, true);
    const localOrchestrator = await ensureImportedLocalTestAccountAddress(embeddedWallet, env.localTestAccountIndex);
    wallet = embeddedWallet;
    senderAddress = localOrchestrator;
  }

  if (env.orchestratorAddress && env.orchestratorAddress !== senderAddress.toString()) {
    throw new Error(
      `Configured orchestrator ${env.orchestratorAddress} does not match imported local test account ${senderAddress.toString()}.`,
    );
  }

  const claims = passportClaimsFromForm(request.claimsForm);
  const claimsHash = await computePassportClaimsHashAsync(claims);
  const derivedGhostOwner = request.ghostUniqueIdentifier?.trim()
    ? (
        await deriveGhostAccountPreview({
          uniqueIdentifier: request.ghostUniqueIdentifier,
          credentialType: CredentialType.Passport,
          derivationVersion: LEGACY_GHOST_DERIVATION_VERSION,
        })
      ).address
    : undefined;
  const ghostOwner = derivedGhostOwner ?? request.ghostOwner?.trim();
  if (!ghostOwner) {
    throw new Error("Scoped unique identifier is required to derive ghost wallet address.");
  }
  try {
    await registerContractArtifactAtAddress(wallet, env.aztecNodeUrl, env.issuerAddress, MagnaIssuerContract.artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Issuer registration step failed: ${message}`);
  }

  const issuer = bindIssuerContract(wallet, env.issuerAddress);

  let interaction;
  try {
    interaction = issuer.methods.register_credential(
      toAddress(request.activeOwner),
      toAddress(ghostOwner),
      toField(claimsHash),
      claims.credentialType,
      claims.expiryTs,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Construct register_credential interaction failed: ${message}`);
  }

  let receipt;
  try {
    receipt = await interaction.send({ from: senderAddress });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Send register_credential transaction failed: ${message}`);
  }

  return {
    txHash: readTxHash(receipt),
    receipt,
    claimsHash: claimsHash.toString(),
  };
}
