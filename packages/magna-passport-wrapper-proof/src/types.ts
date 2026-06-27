import type { ProofData } from "@aztec/bb.js";
import type { InputMap } from "@noir-lang/types";
import type {
  MinimalZkPassportWitness,
  ZkPassportParameterCommitmentManifest,
} from "@magna/wallet";

export const PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT = 10;

export type BigintLike = bigint | number | string;

export type ZkPassportOuterProofArtifact = {
  proof: unknown;
  verificationKey?: unknown;
  metadata?: Record<string, unknown>;
};

export type PassportWrapperAgePredicate = {
  minAge: number;
  maxAge: number;
};

export type PassportWrapperBindData = {
  customData: string;
};

export type PassportWrapperLocalWitness = {
  zkPassportOuterProof: ZkPassportOuterProofArtifact;
  zkPassportOuterPublicInputs: readonly BigintLike[];
  minimalZkPassportWitness: MinimalZkPassportWitness;
  nationalityAlpha3: string;
  expiryTs: BigintLike;
  minAgeProven: number;
  credentialValidUntil: BigintLike;
  agePredicate: PassportWrapperAgePredicate;
  bind: PassportWrapperBindData;
  nationalityBlind: BigintLike;
  expiryBlind: BigintLike;
  scopedNullifier?: BigintLike | null;
  expectedParameterCommitmentManifest?: ZkPassportParameterCommitmentManifest;
};

export type PassportWrapperDeclaredPublicOutputs = {
  claimsHash: BigintLike;
  nationalityCommitment: BigintLike;
  expiryCommitment: BigintLike;
  minAgeProven: BigintLike;
  credentialValidUntil: BigintLike;
  scopedNullifier?: BigintLike | null;
  nationalityDisclosureCommitment: BigintLike;
  expiryDisclosureCommitment: BigintLike;
  agePredicateCommitment: BigintLike;
  bindCommitment: BigintLike;
};

export type PassportWrapperPublicOutputs = {
  claimsHash: string;
  nationalityCommitment: string;
  expiryCommitment: string;
  minAgeProven: number;
  credentialValidUntil: string;
  scopedNullifier: string;
  nationalityDisclosureCommitment: string;
  expiryDisclosureCommitment: string;
  agePredicateCommitment: string;
  bindCommitment: string;
};

export type PassportWrapperInputMetadata = {
  nationalityAlpha3Packed: bigint;
  nationalityCommitment: bigint;
  expiryCommitment: bigint;
  claimsHash: bigint;
  minAgeProven: number;
  credentialValidUntil: bigint;
  scopedNullifier: bigint;
  agePredicate: PassportWrapperAgePredicate;
  parameterCommitmentManifest: ZkPassportParameterCommitmentManifest;
  zkPassportOuterPublicInputsCount: number;
  outerProofVerification: "not_implemented_task_3";
};

export type PassportWrapperCircuitInputs = InputMap;

export type BuildPassportWrapperInputsOptions = {
  declaredPublicOutputs?: PassportWrapperDeclaredPublicOutputs;
};

export type BuildPassportWrapperInputsResult = {
  inputs: PassportWrapperCircuitInputs;
  publicInputs: string[];
  outputs: PassportWrapperPublicOutputs;
  metadata: PassportWrapperInputMetadata;
};

export type PassportWrapperProofArtifact = {
  proof: ProofData;
  publicInputs: string[];
  outputs: PassportWrapperPublicOutputs;
  metadata: PassportWrapperInputMetadata;
};
