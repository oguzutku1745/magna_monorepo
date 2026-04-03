import {
  computeInstagramClaimsHash,
  computePassportClaimsHash,
  poseidon2FieldHasher,
} from "./encoding.js";
import { deriveGhostKeyMaterial } from "./ghost.js";
import { deriveRootCommitment } from "./root.js";
import { normalizePolicy } from "./policy.js";
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
  VerifyPassportInput,
} from "./types.js";

type AztecContract = {
  address?: unknown;
  methods: Record<string, (...args: unknown[]) => { send: (opts: { from: string; fee?: unknown }) => Promise<unknown> }>;
};
type BoundContract = ContractLike;
type SendableContract = AztecContract | BoundContract;

export type MagnaClientConfig = {
  orchestratorAddress: string;
  issuerContract: SendableContract;
  companySponsorContract?: SendableContract;
  hasher?: Hasher;
};

/**
 * High-level SDK wrapper for Magna register/login/recover lifecycle.
 * This class assumes the caller already owns wallet/session wiring.
 */
export class MagnaClient {
  private readonly orchestratorAddress: string;
  private readonly issuerContract: AztecContract;
  private readonly companySponsorContract?: AztecContract;
  private readonly hasher: Hasher;

  constructor(config: MagnaClientConfig) {
    this.orchestratorAddress = config.orchestratorAddress;
    this.issuerContract = config.issuerContract;
    this.companySponsorContract = config.companySponsorContract;
    this.hasher = config.hasher ?? poseidon2FieldHasher;
  }

  deriveGhost(input: GhostDerivationInput) {
    return deriveGhostKeyMaterial(input);
  }

  deriveRootCommitment(input: RootCommitmentInput) {
    return deriveRootCommitment(input);
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
    const policy = normalizePolicy(input.policy);
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
    const policy = normalizePolicy(input.policy);
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
    const policy = normalizePolicy(input.policy);
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

  async loginWithLinkedInstagram(input: VerifyLinkedInstagramInput, from: string) {
    const policy = normalizePolicy(input.policy);
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

  async loginWithCompanySponsor(input: VerifyPassportInput, from: string) {
    if (!this.companySponsorContract) {
      throw new Error("companySponsorContract is required for sponsored Magna login");
    }
    if (!this.companySponsorContract.address) {
      throw new Error("companySponsorContract.address is required for sponsored Magna login");
    }

    const policy = normalizePolicy(input.policy);
    const fee = buildCompanySponsorFeeConfig(this.companySponsorContract.address as never);
    return this.companySponsorContract.methods
      .sponsored_verify(
        policy,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.minAgeProven,
        input.claimsWitness.nationalityAlpha3Packed,
        input.sponsorSlot ?? 0,
      )
      .send({ from, fee });
  }

  async loginWithInstagramCompanySponsor(input: VerifyInstagramInput, from: string) {
    if (!this.companySponsorContract) {
      throw new Error("companySponsorContract is required for sponsored Magna login");
    }
    if (!this.companySponsorContract.address) {
      throw new Error("companySponsorContract.address is required for sponsored Magna login");
    }

    const policy = normalizePolicy(input.policy);
    const fee = buildCompanySponsorFeeConfig(this.companySponsorContract.address as never);
    return this.companySponsorContract.methods
      .sponsored_verify_instagram(
        policy,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.handleHash,
        input.sponsorSlot ?? 0,
      )
      .send({ from, fee });
  }

  async loginWithLinkedCompanySponsor(input: VerifyLinkedPassportInput, from: string) {
    if (!this.companySponsorContract) {
      throw new Error("companySponsorContract is required for sponsored Magna login");
    }
    if (!this.companySponsorContract.address) {
      throw new Error("companySponsorContract.address is required for sponsored Magna login");
    }

    const policy = normalizePolicy(input.policy);
    const fee = buildCompanySponsorFeeConfig(this.companySponsorContract.address as never);
    return this.companySponsorContract.methods
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
      .send({ from, fee });
  }

  async loginWithLinkedInstagramCompanySponsor(input: VerifyLinkedInstagramInput, from: string) {
    if (!this.companySponsorContract) {
      throw new Error("companySponsorContract is required for sponsored Magna login");
    }
    if (!this.companySponsorContract.address) {
      throw new Error("companySponsorContract.address is required for sponsored Magna login");
    }

    const policy = normalizePolicy(input.policy);
    const fee = buildCompanySponsorFeeConfig(this.companySponsorContract.address as never);
    return this.companySponsorContract.methods
      .sponsored_verify_linked_instagram(
        policy,
        input.hintedRootStatusNote,
        input.hintedRootAuthorityNote,
        input.hintedCredentialNote,
        input.hintedStatusNote,
        input.claimsWitness.handleHash,
        input.sponsorSlot ?? 0,
      )
      .send({ from, fee });
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
