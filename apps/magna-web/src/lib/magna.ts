import type { Wallet } from "@aztec/aztec.js/wallet";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { FeePaymentMethod } from "@aztec/aztec.js/fee";
import { ExecutionPayload } from "@aztec/aztec.js/tx";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/poseidon";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import type { PassportCanonicalClaims, Policy } from "../../../../packages/magna-client/src/types.js";
import { ClaimId, ConstraintOp, CredentialType } from "../../../../packages/magna-client/src/types.js";
import { normalizePolicy } from "../../../../packages/magna-client/src/policy.js";
import { bindCompanySponsorContract, bindIssuerContract, readTxHash, toAddress } from "./aztec";
import type { MagnaAppEnv } from "./env";
import { ensureImportedLocalTestAccount } from "./wallet";

const MAGNA_CLAIMS_DS = 0x4d414743n;

export type PassportClaimsForm = {
  nationalityAlpha3: string;
  ageThreshold: string;
  passportExpiryDate: string;
};

export type PolicyForm = {
  minimumAge: string;
  blockedNationalityAlpha3: string;
  sponsorSlot: string;
};

export type PassportHints = {
  claimsHash: string;
  hintedCredentialNote: unknown;
  hintedStatusNote: unknown;
};

export type TxOutcome = {
  txHash?: string;
  receipt: unknown;
};

export type IssuePassportRequest = {
  activeOwner: string;
  ghostOwner?: string;
  claimsForm: PassportClaimsForm;
};

class CompanySponsorFeePaymentMethod implements FeePaymentMethod {
  constructor(private readonly sponsorGateway: AztecAddress) {}

  getAsset(): Promise<AztecAddress> {
    throw new Error("Asset is not required for sponsor gateway fee payment");
  }

  async getExecutionPayload(): Promise<ExecutionPayload> {
    return new ExecutionPayload([], [], [], [], this.sponsorGateway);
  }

  getFeePayer() {
    return Promise.resolve(this.sponsorGateway);
  }

  getGasSettings(): ReturnType<FeePaymentMethod["getGasSettings"]> {
    return undefined;
  }
}

function buildCompanySponsorFeeConfig(companySponsorAddress: AztecAddress) {
  return {
    paymentMethod: new CompanySponsorFeePaymentMethod(companySponsorAddress),
    estimateGas: true,
    estimatedGasPadding: 0.2,
  };
}

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
    blockedNationalityAlpha3: "USA",
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

  const blockedCountry = form.blockedNationalityAlpha3.trim().toUpperCase();
  if (blockedCountry) {
    constraints.push({
      claimId: ClaimId.NationalityAlpha3,
      op: ConstraintOp.Neq,
      value: packAlpha3(blockedCountry),
    });
  }

  return {
    credentialType: CredentialType.Passport,
    constraints,
  };
}

function toBindingPolicy(policy: Policy) {
  const normalized = normalizePolicy(policy);
  return {
    credential_type: normalized.credentialType,
    constraints: normalized.constraints.map(constraint => ({
      claim_id: constraint.claimId,
      op: constraint.op,
      value: constraint.value,
    })),
  };
}

export function buildPassportClaimsWitness(claims: PassportCanonicalClaims) {
  return {
    minAgeProven: claims.minAgeProven,
    nationalityAlpha3Packed: claims.nationalityAlpha3Packed,
  };
}

export function readSponsorSlot(form: PolicyForm): number {
  return parseIntField(form.sponsorSlot, "Sponsor slot");
}

export class MagnaBrowserClient {
  private readonly issuer;
  private readonly sponsor;

  constructor(
    private readonly wallet: Wallet,
    private readonly env: MagnaAppEnv,
    private readonly userAddress: string,
  ) {
    if (!env.issuerAddress) {
      throw new Error("VITE_MAGNA_ISSUER_ADDRESS is required to use Magna flows.");
    }

    this.issuer = bindIssuerContract(wallet, env.issuerAddress);
    this.sponsor = env.companySponsorAddress
      ? bindCompanySponsorContract(wallet, env.companySponsorAddress)
      : undefined;
  }

  async syncOrchestratorSender(): Promise<void> {
    if (!this.env.orchestratorAddress) {
      return;
    }
    await this.wallet.registerSender(toAddress(this.env.orchestratorAddress), "magna-orchestrator");
  }

  async fetchPassportHints(ownerAddress: string, claimsForm: PassportClaimsForm): Promise<PassportHints> {
    const claims = passportClaimsFromForm(claimsForm);
    const claimsHash = await computePassportClaimsHashAsync(claims);
    const hintedCredentialNote = await this.issuer.methods
      .get_credential_hinted(toAddress(ownerAddress), claimsHash)
      .simulate({ from: toAddress(ownerAddress) })
      .then(simulation => simulation.result);
    const hintedStatusNote = await this.issuer.methods
      .get_status_hinted(toAddress(ownerAddress), claimsHash)
      .simulate({ from: toAddress(ownerAddress) })
      .then(simulation => simulation.result);

    return {
      claimsHash: claimsHash.toString(),
      hintedCredentialNote,
      hintedStatusNote,
    };
  }

  async verifyPassport(claimsForm: PassportClaimsForm, policyForm: PolicyForm, hints: PassportHints): Promise<TxOutcome> {
    const claims = passportClaimsFromForm(claimsForm);
    const witness = buildPassportClaimsWitness(claims);
    const receipt = await this.issuer.methods
      .verify(
        toBindingPolicy(buildPassportPolicy(policyForm)),
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        witness.minAgeProven,
        witness.nationalityAlpha3Packed,
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
  ): Promise<TxOutcome> {
    if (!this.sponsor) {
      throw new Error("VITE_MAGNA_COMPANY_SPONSOR_ADDRESS is required for sponsored verification.");
    }

    const claims = passportClaimsFromForm(claimsForm);
    const witness = buildPassportClaimsWitness(claims);
    const fee = buildCompanySponsorFeeConfig(toAddress(this.env.companySponsorAddress!));
    const receipt = await this.sponsor.methods
      .sponsored_verify(
        toBindingPolicy(buildPassportPolicy(policyForm)),
        hints.hintedCredentialNote as never,
        hints.hintedStatusNote as never,
        witness.minAgeProven,
        witness.nationalityAlpha3Packed,
        readSponsorSlot(policyForm),
      )
      .send({ from: toAddress(this.userAddress), fee });

    return {
      txHash: readTxHash(receipt),
      receipt,
    };
  }
}

export async function issuePassportWithDevOrchestrator(
  env: MagnaAppEnv,
  request: IssuePassportRequest,
): Promise<TxOutcome & { claimsHash: string }> {
  if (!env.enableDevOrchestrator) {
    throw new Error("Dev orchestrator mode is disabled.");
  }
  if (!env.issuerAddress) {
    throw new Error("VITE_MAGNA_ISSUER_ADDRESS is required to issue credentials.");
  }

  const wallet = await EmbeddedWallet.create(env.aztecNodeUrl, { ephemeral: false });
  const localOrchestrator = await ensureImportedLocalTestAccount(wallet, env.localTestAccountIndex);

  if (env.orchestratorAddress && env.orchestratorAddress !== localOrchestrator.address) {
    throw new Error(
      `Configured orchestrator ${env.orchestratorAddress} does not match imported local test account ${localOrchestrator.address}.`,
    );
  }

  const issuer = bindIssuerContract(wallet, env.issuerAddress);
  const sponsor = env.companySponsorAddress
    ? bindCompanySponsorContract(wallet, env.companySponsorAddress)
    : undefined;
  const claims = passportClaimsFromForm(request.claimsForm);
  const claimsHash = await computePassportClaimsHashAsync(claims);
  const receipt = await issuer.methods
    .register_credential(
      toAddress(request.activeOwner),
      toAddress(request.ghostOwner?.trim() || request.activeOwner),
      claimsHash,
      claims.credentialType,
      claims.expiryTs,
    )
    .send({ from: toAddress(localOrchestrator.address) });

  return {
    txHash: readTxHash(receipt),
    receipt,
    claimsHash: claimsHash.toString(),
  };
}
