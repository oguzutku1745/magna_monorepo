import type { ProofData } from "@aztec/bb.js";
import type { InputMap } from "@noir-lang/types";

export const PASSPORT_A2_SCHEMA = "passport-a2-v1" as const;
export const PASSPORT_A2_INNER_NAME = "outer_count_6" as const;
export const PASSPORT_A2_INNER_VERSION = "0.20.0" as const;
export const PASSPORT_A2_INNER_VKEY_HASH =
  "0x1235fce6de6e5d5f86af3509d1c043bf531b5b01ca97a97eec45ac48ab0cec2c" as const;
export const PASSPORT_A2_WRAPPER_ARTIFACT_SHA256 =
  "562cc3ad7b512e6b0ad966313c43e2c497bb80747a0df822f07b87520ae7e91f" as const;
export const PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT = 11;
export const PASSPORT_A2_INNER_PROOF_FIELD_COUNT = 458;
export const PASSPORT_A2_INNER_VKEY_FIELD_COUNT = 115;
export const PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT = 8;

export type BigintLike = bigint | number | string;
export type PassportA2Action = "issue" | "renew" | "recover";
export type PassportA2CredentialMode = "passport" | "rooted";
export type ZkPassportMrzLayout = "passport" | "id_card";
export type PassportA2NullifierType = 0 | 1 | 2 | 3;

export type PassportA2RegistryContext = {
  certificateRegistryRoot: string;
  circuitRegistryRoot: string;
  nullifierType: PassportA2NullifierType;
};

export type ZkPassportCompressedProof = {
  proof: string;
  name: string;
  version: string;
  vkeyHash: string;
  index?: number;
  total?: number;
};

export type PassportA2RequestContext = {
  action: PassportA2Action;
  issuer: BigintLike;
  owner: BigintLike;
  ghostOwner: BigintLike;
  credentialMode: PassportA2CredentialMode;
};

export type PassportWrapperLocalWitness = {
  zkPassportOuterProof: ZkPassportCompressedProof;
  nationalityAlpha3: string;
  expiryTs: BigintLike;
  minAgeProven: number;
  agePredicate: {
    minAge: number;
    maxAge: number;
  };
  bind: {
    customData: string;
  };
  credentialValidUntil: BigintLike;
  nationalityBlind: BigintLike;
  expiryBlind: BigintLike;
  requestContext: PassportA2RequestContext;
};

export type PassportWrapperDeclaredPublicOutputs = {
  claimsHash: BigintLike;
  nationalityCommitment: BigintLike;
  expiryCommitment: BigintLike;
  minAgeProven: BigintLike;
  credentialValidUntil: BigintLike;
  rootCommitment: BigintLike;
  requestContextHash: BigintLike;
  proofCurrentDate: BigintLike;
};

export type PassportWrapperPublicOutputs = {
  claimsHash: string;
  nationalityCommitment: string;
  expiryCommitment: string;
  minAgeProven: number;
  credentialValidUntil: string;
  rootCommitment: string;
  requestContextHash: string;
  proofCurrentDate: string;
};

export type PassportWrapperInputMetadata = {
  innerProofName: typeof PASSPORT_A2_INNER_NAME;
  innerProofVersion: typeof PASSPORT_A2_INNER_VERSION;
  innerVkeyHash: typeof PASSPORT_A2_INNER_VKEY_HASH;
  mrzLayout: ZkPassportMrzLayout;
  nationalityAlpha3Packed: bigint;
  nationalityCommitment: bigint;
  expiryCommitment: bigint;
  claimsHash: bigint;
  rootCommitment: bigint;
  requestContextHash: bigint;
  minAgeProven: number;
  credentialValidUntil: bigint;
  proofCurrentDate: bigint;
  registryContext: PassportA2RegistryContext;
};

export type PassportWrapperCircuitInputs = InputMap;

export type RegistryClientLike = {
  getCircuitManifest(
    root?: string,
    options?: { validate?: boolean; ipfs?: boolean; version?: string },
  ): Promise<Record<string, unknown>>;
  getPackagedCircuit(
    circuit: string,
    manifest: Record<string, unknown>,
    options?: { validate?: boolean; ipfs?: boolean },
  ): Promise<{ vkey: string; vkey_hash?: string; vkeyHash?: string }>;
};

export type BuildPassportWrapperInputsOptions = {
  declaredPublicOutputs?: PassportWrapperDeclaredPublicOutputs;
  registryClient?: RegistryClientLike;
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
