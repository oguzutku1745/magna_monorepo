import type { ProofData } from "@aztec/bb.js";
import type { InputMap } from "@noir-lang/types";
import type { BigintLike, RegistryClientLike, ZkPassportCompressedProof } from "@magna/passport-wrapper-proof/recursive";

export const RECOVERY_WRAPPER_VERSION = 1n;
export const RECOVERY_WRAPPER_ARTIFACT_SHA256 =
  "c899b606d056fa2734356f6013bb776f354cbd33e23508bd4c302f1b1c216413" as const;
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
