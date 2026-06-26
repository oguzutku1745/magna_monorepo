import {
  computeInstagramClaimsHash,
  computePassportClaimsHash,
  poseidon2FieldHasher,
} from "./encoding.js";
import { deriveGhostKeyMaterial } from "./ghost.js";
import { deriveRootCommitment } from "./root.js";
import { CredentialType, normalizePolicy } from "@magna/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { prepareGhostAccountOnWallet, type GhostAccountLifecycleOptions, type GhostAccountLifecycleResult } from "../embedded/lifecycle.js";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import { buildCompanySponsorFeeConfig } from "./sponsorship.js";
import type { ContractLike } from "@magna/contracts-bindings";
import type {
  GhostDerivationInput,
  Hasher,
  RefreshRootAuthorityInput,
  RecoverRootInput,
  RecoverInput,
  RegisterInstagramInput,
  RegisterLinkedInstagramInput,
  RegisterLinkedPassportInput,
  RegisterPassportInput,
  RegisterRootAuthorityInput,
  RegisterRootInput,
  RegisterRootedPassportInput,
  RevokeLinkedCredentialInput,
  RootCommitmentInput,
  VerifyInstagramInput,
  VerifyLinkedInstagramInput,
  VerifyLinkedPassportInput,
  VerifyLinkedPassportV2Input,
  VerifyPassportInput,
  VerifyPassportV2Input,
} from "./types.js";

type ContractCall = {
  send: (opts: any) => Promise<unknown>;
  simulate?: (opts: any) => Promise<unknown>;
};

type AztecContract = {
  address?: unknown;
  methods: Record<string, (...args: any[]) => ContractCall>;
};
type BoundContract = ContractLike;
type SendableContract = AztecContract | BoundContract;

export type CredentialHints = {
  claimsHash: string;
  hintedCredentialNote: unknown;
  hintedStatusNote: unknown;
};

export type LinkedCredentialHints = CredentialHints & {
  rootCommitment: string;
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
};

export type VerificationSponsorContext = {
  sponsored?: boolean;
  sponsorContract?: SendableContract;
};

export type RecoverOntoNewDeviceInput = {
  wallet: EmbeddedWallet;
  ghost: GhostAccountLifecycleOptions;
  recovery: RecoverInput;
};

export type RecoverOntoNewDeviceResult = {
  ghost: GhostAccountLifecycleResult;
  receipt: unknown;
};

function unwrapSimulationResult<T>(value: T | { result: T }): T {
  if (value && typeof value === "object" && "result" in value) {
    return value.result as T;
  }
  return value as T;
}

function toAztecAddress(value: string): AztecAddress {
  return AztecAddress.fromString(value);
}

function toField(value: bigint | string): Fr {
  return new Fr(typeof value === "bigint" ? value : BigInt(value));
}

function toContractPolicy(policy: VerifyPassportInput["policy"]) {
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

function toContractPassportCommittedClaimsWitness(witness: VerifyPassportV2Input["claimsWitness"]) {
  return {
    min_age_proven: witness.minAgeProven,
    nationality_alpha3_packed: witness.nationalityAlpha3Packed,
    nationality_blind: witness.nationalityBlind,
    expiry_ts: witness.expiryTs,
    expiry_blind: witness.expiryBlind,
  };
}

function requireSimulate(methodName: string, call: ContractCall): (opts: any) => Promise<unknown> {
  if (!call.simulate) {
    throw new Error(`${methodName} does not support simulate`);
  }
  return (opts: any) => call.simulate!(opts);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS = [
  "Invalid tx: Invalid expiration timestamp",
  "Invalid tx: Block header not found",
  "Tx dropped by P2P node",
];

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTransientLocalNetworkTxError(error: unknown): boolean {
  const details = errorDetails(error);
  return TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS.some(marker => details.includes(marker));
}

async function sendWithTransientLocalNetworkRetry<T>(buildAndSend: () => Promise<T>): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await buildAndSend();
    } catch (error) {
      if (!isTransientLocalNetworkTxError(error) || attempt >= 3) {
        throw error;
      }
      await sleep(250);
      attempt += 1;
    }
  }
}

function isPendingHintLookupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("credential note not found") ||
    message.includes("status note not found") ||
    message.includes("linked credential note not found") ||
    message.includes("linked status note not found") ||
    message.includes("root status note not found") ||
    message.includes("root authority note not found")
  );
}

export type MagnaVerificationEngineConfig = {
  orchestratorAddress: string;
  issuerContract: SendableContract;
  companySponsorContract?: SendableContract;
  companySponsorContracts?: SendableContract[];
  consumerContractFactory?: (address: string) => SendableContract;
  syncBeforeHintLookup?: () => Promise<void>;
  hintLookupAttempts?: number;
  hintLookupRetryDelayMs?: number;
  hasher?: Hasher;
};

/**
 * High-level SDK wrapper for Magna register/login/recover lifecycle.
 * This class assumes the caller already owns wallet/session wiring.
 */
export class MagnaVerificationEngine {
  private readonly orchestratorAddress: string;
  private readonly issuerContract: AztecContract;
  private readonly companySponsorContract?: AztecContract;
  private readonly companySponsorContracts: AztecContract[];
  private readonly companySponsorContractsByAddress: Map<string, AztecContract>;
  private readonly consumerContractFactory?: (address: string) => SendableContract;
  private readonly syncBeforeHintLookup?: () => Promise<void>;
  private readonly hintLookupAttempts: number;
  private readonly hintLookupRetryDelayMs: number;
  private readonly hasher: Hasher;

  constructor(config: MagnaVerificationEngineConfig) {
    this.orchestratorAddress = config.orchestratorAddress;
    this.issuerContract = config.issuerContract;
    this.companySponsorContract = config.companySponsorContract;
    this.companySponsorContracts = config.companySponsorContracts ?? [];
    this.consumerContractFactory = config.consumerContractFactory;
    this.syncBeforeHintLookup = config.syncBeforeHintLookup;
    this.hintLookupAttempts = config.hintLookupAttempts ?? 12;
    this.hintLookupRetryDelayMs = config.hintLookupRetryDelayMs ?? 1_000;
    this.companySponsorContractsByAddress = new Map();
    if (this.companySponsorContract?.address) {
      this.companySponsorContractsByAddress.set(String(this.companySponsorContract.address), this.companySponsorContract);
    }
    for (const sponsor of this.companySponsorContracts) {
      if (sponsor?.address) {
        this.companySponsorContractsByAddress.set(String(sponsor.address), sponsor);
      }
    }
    this.hasher = config.hasher ?? poseidon2FieldHasher;
  }

  private async withHintLookupRetry<T>(lookup: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < this.hintLookupAttempts; attempt += 1) {
      try {
        await this.syncBeforeHintLookup?.();
        return await lookup();
      } catch (error) {
        if (!isPendingHintLookupError(error) || attempt === this.hintLookupAttempts - 1) {
          throw error;
        }
        await sleep(this.hintLookupRetryDelayMs);
      }
    }
    throw new Error("hint lookup retry exhausted");
  }

  private resolveCompanySponsorContract(
    sponsorContractOverride?: SendableContract,
  ): AztecContract {
    const sponsorContract =
      sponsorContractOverride ??
      this.companySponsorContract ??
      this.companySponsorContracts[0];
    if (!sponsorContract) {
      const knownSponsors = Array.from(this.companySponsorContractsByAddress.keys());
      throw new Error(
        `companySponsorContract is required for sponsored Magna login` +
          (knownSponsors.length > 0 ? ` (known configured sponsors: ${knownSponsors.join(", ")})` : ""),
      );
    }
    if (!sponsorContract.address) {
      throw new Error(
        "companySponsorContract.address is required for sponsored Magna login",
      );
    }
    return sponsorContract;
  }

  private buildCompanySponsorSendOptions(from: string, sponsorContract: AztecContract) {
    const sponsorAddress = sponsorContract.address as never;
    return {
      from,
      fee: buildCompanySponsorFeeConfig(sponsorAddress),
      // External fee payers still need sponsor-scoped note visibility during proving.
      additionalScopes: [sponsorAddress],
    };
  }

  deriveGhost(input: GhostDerivationInput) {
    return deriveGhostKeyMaterial(input);
  }

  deriveRootCommitment(input: RootCommitmentInput) {
    return deriveRootCommitment(input);
  }

  async findCredentialHints(ownerAddress: string, claimsHash: bigint | string): Promise<CredentialHints> {
    return await this.withHintLookupRetry(async () => {
      const owner = toAztecAddress(ownerAddress);
      const claimField = toField(claimsHash);
      const credentialCall = this.issuerContract.methods.get_credential_hinted(owner, claimField);
      const statusCall = this.issuerContract.methods.get_status_hinted(owner, claimField);
      const [hintedCredentialNote, hintedStatusNote] = await Promise.all([
        requireSimulate("get_credential_hinted", credentialCall)({ from: owner }).then(value => unwrapSimulationResult(value)),
        requireSimulate("get_status_hinted", statusCall)({ from: owner }).then(value => unwrapSimulationResult(value)),
      ]);
      return {
        claimsHash: claimsHash.toString(),
        hintedCredentialNote,
        hintedStatusNote,
      };
    });
  }

  async findLinkedCredentialHints(
    ownerAddress: string,
    rootCommitment: bigint | string,
    claimsHash: bigint | string,
  ): Promise<LinkedCredentialHints> {
    return await this.withHintLookupRetry(async () => {
      const owner = toAztecAddress(ownerAddress);
      const rootField = toField(rootCommitment);
      const claimField = toField(claimsHash);
      const linkedCredentialCall = this.issuerContract.methods.get_linked_credential_hinted(owner, rootField, claimField);
      const linkedStatusCall = this.issuerContract.methods.get_linked_status_hinted(owner, rootField, claimField);
      const rootStatusCall = this.issuerContract.methods.get_root_status_hinted(owner, rootField);
      const rootAuthorityCall = this.issuerContract.methods.get_root_authority_hinted(owner, rootField, claimField);
      const [
        hintedCredentialNote,
        hintedStatusNote,
        hintedRootStatusNote,
        hintedRootAuthorityNote,
      ] = await Promise.all([
        requireSimulate("get_linked_credential_hinted", linkedCredentialCall)({ from: owner }).then(value => unwrapSimulationResult(value)),
        requireSimulate("get_linked_status_hinted", linkedStatusCall)({ from: owner }).then(value => unwrapSimulationResult(value)),
        requireSimulate("get_root_status_hinted", rootStatusCall)({ from: owner }).then(value => unwrapSimulationResult(value)),
        requireSimulate("get_root_authority_hinted", rootAuthorityCall)({ from: owner }).then(value => unwrapSimulationResult(value)),
      ]);
      return {
        claimsHash: claimsHash.toString(),
        rootCommitment: rootCommitment.toString(),
        hintedCredentialNote,
        hintedStatusNote,
        hintedRootStatusNote,
        hintedRootAuthorityNote,
      };
    });
  }

  async runVerification(
    input: VerifyPassportInput | VerifyInstagramInput,
    from: string,
    sponsorContext: VerificationSponsorContext = {},
  ) {
    const credentialType = normalizePolicy(input.policy).credentialType;
    if (credentialType === CredentialType.Instagram) {
      return sponsorContext.sponsored || sponsorContext.sponsorContract
        ? this.loginWithInstagramCompanySponsor(input as VerifyInstagramInput, from, sponsorContext.sponsorContract)
        : this.loginWithInstagram(input as VerifyInstagramInput, from);
    }
    return sponsorContext.sponsored || sponsorContext.sponsorContract
      ? this.loginWithCompanySponsor(input as VerifyPassportInput, from, sponsorContext.sponsorContract)
      : this.loginWithMagna(input as VerifyPassportInput, from);
  }

  async recoverOntoNewDevice(input: RecoverOntoNewDeviceInput): Promise<RecoverOntoNewDeviceResult> {
    const ghost = await prepareGhostAccountOnWallet(input.wallet, input.ghost);
    const receipt = await this.recover(input.recovery, ghost.address);
    return { ghost, receipt };
  }


  async loginWithMagnaThroughConsumer(input: {
    policy: VerifyPassportInput["policy"];
    consumerGatewayAddress: string;
    claimsHash: bigint | string;
    claimsWitness: VerifyPassportInput["claimsWitness"];
    from: string;
    sponsorSlot?: number;
  }) {
    if (!this.consumerContractFactory) {
      throw new Error("consumerContractFactory is required for consumer-gateway login");
    }
    const hints = await this.findCredentialHints(input.from, input.claimsHash);
    const policy = toContractPolicy(input.policy);
    return sendWithTransientLocalNetworkRetry(() => {
      const consumer = this.consumerContractFactory!(input.consumerGatewayAddress);
      return consumer.methods
        .login_with_magna(
          policy,
          hints.hintedCredentialNote,
          hints.hintedStatusNote,
          input.claimsWitness.minAgeProven,
          input.claimsWitness.nationalityAlpha3Packed,
          input.sponsorSlot ?? 0,
        )
        .send({ from: input.from });
    });
  }

  async loginWithLinkedMagnaThroughConsumer(input: {
    policy: VerifyPassportInput["policy"];
    consumerGatewayAddress: string;
    rootCommitment: bigint | string;
    claimsHash: bigint | string;
    claimsWitness: VerifyPassportInput["claimsWitness"];
    from: string;
    sponsorSlot?: number;
  }) {
    if (!this.consumerContractFactory) {
      throw new Error("consumerContractFactory is required for consumer-gateway login");
    }
    const hints = await this.findLinkedCredentialHints(input.from, input.rootCommitment, input.claimsHash);
    const policy = toContractPolicy(input.policy);
    return sendWithTransientLocalNetworkRetry(() => {
      const consumer = this.consumerContractFactory!(input.consumerGatewayAddress);
      return consumer.methods
        .login_with_linked_magna(
          policy,
          hints.hintedRootStatusNote,
          hints.hintedRootAuthorityNote,
          hints.hintedCredentialNote,
          hints.hintedStatusNote,
          input.claimsWitness.minAgeProven,
          input.claimsWitness.nationalityAlpha3Packed,
          input.sponsorSlot ?? 0,
        )
        .send({ from: input.from });
    });
  }

  async loginWithMagnaV2ThroughConsumer(input: {
    policy: VerifyPassportInput["policy"];
    consumerGatewayAddress: string;
    claimsHash: bigint | string;
    claimsWitness: VerifyPassportV2Input["claimsWitness"];
    from: string;
    sponsorSlot?: number;
  }) {
    if (!this.consumerContractFactory) {
      throw new Error("consumerContractFactory is required for consumer-gateway login");
    }
    const hints = await this.findCredentialHints(input.from, input.claimsHash);
    const policy = toContractPolicy(input.policy);
    return sendWithTransientLocalNetworkRetry(() => {
      const consumer = this.consumerContractFactory!(input.consumerGatewayAddress);
      return consumer.methods
        .login_with_magna_v2(
          policy,
          hints.hintedCredentialNote,
          hints.hintedStatusNote,
          toContractPassportCommittedClaimsWitness(input.claimsWitness),
          input.sponsorSlot ?? 0,
        )
        .send({ from: input.from });
    });
  }

  async loginWithLinkedMagnaV2ThroughConsumer(input: {
    policy: VerifyPassportInput["policy"];
    consumerGatewayAddress: string;
    rootCommitment: bigint | string;
    claimsHash: bigint | string;
    claimsWitness: VerifyPassportV2Input["claimsWitness"];
    from: string;
    sponsorSlot?: number;
  }) {
    if (!this.consumerContractFactory) {
      throw new Error("consumerContractFactory is required for consumer-gateway login");
    }
    const hints = await this.findLinkedCredentialHints(input.from, input.rootCommitment, input.claimsHash);
    const policy = toContractPolicy(input.policy);
    return sendWithTransientLocalNetworkRetry(() => {
      const consumer = this.consumerContractFactory!(input.consumerGatewayAddress);
      return consumer.methods
        .login_with_linked_magna_v2(
          policy,
          hints.hintedRootStatusNote,
          hints.hintedRootAuthorityNote,
          hints.hintedCredentialNote,
          hints.hintedStatusNote,
          toContractPassportCommittedClaimsWitness(input.claimsWitness),
          input.sponsorSlot ?? 0,
        )
        .send({ from: input.from });
    });
  }

  async registerPassport(input: RegisterPassportInput) {
    const claimsHash = computePassportClaimsHash(input.claims, this.hasher);
    return this.issuerContract.methods
      .register_credential(
        input.activeOwner,
        input.ghostOwner,
        claimsHash,
        input.claims.credentialType,
        input.claims.expiryTs,
      )
      .send({ from: this.orchestratorAddress });
  }

  async registerInstagram(input: RegisterInstagramInput) {
    const claimsHash = computeInstagramClaimsHash(input.claims, this.hasher);
    return this.issuerContract.methods
      .register_credential(
        input.activeOwner,
        input.ghostOwner,
        claimsHash,
        input.claims.credentialType,
        input.claims.expiryTs,
      )
      .send({ from: this.orchestratorAddress });
  }

  async registerRoot(input: RegisterRootInput) {
    return this.issuerContract.methods
      .register_root(
        input.activeOwner,
        input.ghostOwner,
        input.rootCommitment,
      )
      .send({ from: this.orchestratorAddress });
  }

  async registerRootAuthority(input: RegisterRootAuthorityInput) {
    const claimsHash = computePassportClaimsHash(input.claims, this.hasher);
    return this.issuerContract.methods
      .register_root_authority(
        input.activeOwner,
        input.rootCommitment,
        claimsHash,
        input.claims.expiryTs,
      )
      .send({ from: this.orchestratorAddress });
  }

  async registerRootedPassport(input: RegisterRootedPassportInput) {
    const claimsHash = computePassportClaimsHash(input.claims, this.hasher);
    return this.issuerContract.methods
      .register_rooted_passport(
        input.activeOwner,
        input.ghostOwner,
        input.rootCommitment,
        claimsHash,
        input.claims.expiryTs,
      )
      .send({ from: this.orchestratorAddress });
  }

  async registerLinkedPassport(input: RegisterLinkedPassportInput) {
    const claimsHash = computePassportClaimsHash(input.claims, this.hasher);
    return this.issuerContract.methods
      .register_linked_credential(
        input.activeOwner,
        input.ghostOwner,
        input.rootCommitment,
        claimsHash,
        input.claims.credentialType,
        input.claims.expiryTs,
      )
      .send({ from: this.orchestratorAddress });
  }

  async registerLinkedInstagram(input: RegisterLinkedInstagramInput) {
    const claimsHash = computeInstagramClaimsHash(input.claims, this.hasher);
    return this.issuerContract.methods
      .register_linked_credential(
        input.activeOwner,
        input.ghostOwner,
        input.rootCommitment,
        claimsHash,
        input.claims.credentialType,
        input.claims.expiryTs,
      )
      .send({ from: this.orchestratorAddress });
  }

  async loginWithMagna(input: VerifyPassportInput, from: string) {
    const policy = toContractPolicy(input.policy);
    return this.issuerContract.methods
      .verify(
        policy,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.minAgeProven,
        input.claimsWitness.nationalityAlpha3Packed,
        input.sponsorSlot ?? 0,
      )
      .send({ from });
  }

  async loginWithInstagram(input: VerifyInstagramInput, from: string) {
    const policy = toContractPolicy(input.policy);
    return this.issuerContract.methods
      .verify_instagram(
        policy,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.handleHash,
        input.sponsorSlot ?? 0,
      )
      .send({ from });
  }

  async loginWithLinkedMagna(input: VerifyLinkedPassportInput, from: string) {
    const policy = toContractPolicy(input.policy);
    return this.issuerContract.methods
      .verify_linked(
        policy,
        input.hintedRootStatusNote,
        input.hintedRootAuthorityNote,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.minAgeProven,
        input.claimsWitness.nationalityAlpha3Packed,
        input.sponsorSlot ?? 0,
      )
      .send({ from });
  }

  async loginWithMagnaV2(input: VerifyPassportV2Input, from: string) {
    const policy = toContractPolicy(input.policy);
    return this.issuerContract.methods
      .verify_v2(
        policy,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        toContractPassportCommittedClaimsWitness(input.claimsWitness),
        input.sponsorSlot ?? 0,
      )
      .send({ from });
  }

  async loginWithLinkedMagnaV2(input: VerifyLinkedPassportV2Input, from: string) {
    const policy = toContractPolicy(input.policy);
    return this.issuerContract.methods
      .verify_linked_v2(
        policy,
        input.hintedRootStatusNote,
        input.hintedRootAuthorityNote,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        toContractPassportCommittedClaimsWitness(input.claimsWitness),
        input.sponsorSlot ?? 0,
      )
      .send({ from });
  }

  async loginWithLinkedInstagram(input: VerifyLinkedInstagramInput, from: string) {
    const policy = toContractPolicy(input.policy);
    return this.issuerContract.methods
      .verify_linked_instagram(
        policy,
        input.hintedRootStatusNote,
        input.hintedRootAuthorityNote,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.handleHash,
        input.sponsorSlot ?? 0,
      )
      .send({ from });
  }

  async loginWithCompanySponsor(input: VerifyPassportInput, from: string, sponsorContractOverride?: SendableContract) {
    const sponsorContract = this.resolveCompanySponsorContract(sponsorContractOverride);
    const policy = toContractPolicy(input.policy);
    return sponsorContract.methods
      .sponsored_verify(
        policy,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.minAgeProven,
        input.claimsWitness.nationalityAlpha3Packed,
        input.sponsorSlot ?? 0,
      )
      .send(this.buildCompanySponsorSendOptions(from, sponsorContract));
  }

  async loginWithInstagramCompanySponsor(input: VerifyInstagramInput, from: string, sponsorContractOverride?: SendableContract) {
    const sponsorContract = this.resolveCompanySponsorContract(sponsorContractOverride);
    const policy = toContractPolicy(input.policy);
    return sponsorContract.methods
      .sponsored_verify_instagram(
        policy,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.handleHash,
        input.sponsorSlot ?? 0,
      )
      .send(this.buildCompanySponsorSendOptions(from, sponsorContract));
  }

  async loginWithLinkedCompanySponsor(input: VerifyLinkedPassportInput, from: string, sponsorContractOverride?: SendableContract) {
    const sponsorContract = this.resolveCompanySponsorContract(sponsorContractOverride);
    const policy = toContractPolicy(input.policy);
    return sponsorContract.methods
      .sponsored_verify_linked(
        policy,
        input.hintedRootStatusNote,
        input.hintedRootAuthorityNote,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.minAgeProven,
        input.claimsWitness.nationalityAlpha3Packed,
        input.sponsorSlot ?? 0,
      )
      .send(this.buildCompanySponsorSendOptions(from, sponsorContract));
  }

  async loginWithLinkedInstagramCompanySponsor(
    input: VerifyLinkedInstagramInput,
    from: string,
    sponsorContractOverride?: SendableContract,
  ) {
    const sponsorContract = this.resolveCompanySponsorContract(sponsorContractOverride);
    const policy = toContractPolicy(input.policy);
    return sponsorContract.methods
      .sponsored_verify_linked_instagram(
        policy,
        input.hintedRootStatusNote,
        input.hintedRootAuthorityNote,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.handleHash,
        input.sponsorSlot ?? 0,
      )
      .send(this.buildCompanySponsorSendOptions(from, sponsorContract));
  }

  async refreshRootAuthority(input: RefreshRootAuthorityInput) {
    const claimsHash = computePassportClaimsHash(input.claims, this.hasher);
    return this.issuerContract.methods
      .refresh_root_authority(
        input.ghostOwner,
        input.hintedRootStatusNote,
        input.hintedRootAuthorityNote,
        claimsHash,
        input.claims.expiryTs,
      )
      .send({ from: this.orchestratorAddress });
  }

  async recover(input: RecoverInput, ghostAddress: string) {
    return this.issuerContract.methods
      .recover(input.hintedRecoveryNote, input.newActiveOwner, input.remintCredential)
      .send({ from: ghostAddress });
  }

  async recoverRoot(input: RecoverRootInput, ghostAddress: string) {
    return this.issuerContract.methods
      .recover_root(input.hintedRootRecoveryNote, input.newActiveOwner)
      .send({ from: ghostAddress });
  }

  async revokeLinkedCredential(input: RevokeLinkedCredentialInput, ghostAddress: string) {
    return this.issuerContract.methods
      .revoke_linked_credential(input.hintedLinkedRecoveryNote)
      .send({ from: ghostAddress });
  }
}
