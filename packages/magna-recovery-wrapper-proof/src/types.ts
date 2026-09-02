import type { ProofData } from "@aztec/bb.js";
import type { InputMap } from "@noir-lang/types";
import type { BigintLike, RegistryClientLike, ZkPassportCompressedProof } from "@magna/passport-wrapper-proof/recursive";

export const RECOVERY_WRAPPER_VERSION = 1n;
export const RECOVERY_WRAPPER_ARTIFACT_SHA256 =
  "7f068e040fd1d0bce2602d6c86567b590f9d58120c143e6061a9c58134c2e06b" as const;
export const RECOVERY_WRAPPER_PUBLIC_INPUT_COUNT = 7;
export const RECOVERY_WRAPPER_SRS_SIZE = 2 ** 20;

export type RecoveryWrapperLocalWitness = {
  zkPassportOuterProof: ZkPassportCompressedProof;
  nationalityAlpha3: string;
  expiryTs: BigintLike;
  minAgeProven: number;
  agePredicate: { minAge: number; maxAge: number };
  facematch: {
    rootKeyLeaf: BigintLike;
    environment: "production";
    appIdHash: BigintLike;
    integrityPublicKeyHash: BigintLike;
    mode: "regular";
  };
  recovery: {
    ethereumChainId: BigintLike;
    recoveryPortalL1Address: BigintLike;
    aztecProtocolVersion: BigintLike;
    aztecChainId: BigintLike;
    issuerL2Address: BigintLike;
    destination: BigintLike;
    recoveryNonce: BigintLike;
    messageSecretHash: BigintLike;
  };
};

export type RecoveryWrapperPublicOutputs = {
  schema: string;
  authorization: string;
  messageSecretHash: string;
  proofCurrentDate: string;
  certificateRegistryRoot: string;
  circuitRegistryRoot: string;
  trustContext: string;
};

export type RecoveryWrapperMetadata = {
  recoveryIntent: bigint;
  bindCustomData: string;
  identityValue: bigint;
  rootCommitment: bigint;
  nationalityBlind: bigint;
  expiryBlind: bigint;
  nationalityCommitment: bigint;
  expiryCommitment: bigint;
  claimsHash: bigint;
  credentialValidUntil: bigint;
  authorization: bigint;
  trustContext: bigint;
  mrzLayout: "passport" | "id_card";
};

export type RecoveryWrapperCircuitInputs = InputMap;
export type BuildRecoveryWrapperInputsOptions = { registryClient?: RegistryClientLike };
export type BuildRecoveryWrapperInputsResult = {
  inputs: RecoveryWrapperCircuitInputs;
  publicInputs: string[];
  outputs: RecoveryWrapperPublicOutputs;
  metadata: RecoveryWrapperMetadata;
};
export type RecoveryWrapperProofArtifact = {
  proof: ProofData;
  publicInputs: string[];
  outputs: RecoveryWrapperPublicOutputs;
  metadata: RecoveryWrapperMetadata;
};
