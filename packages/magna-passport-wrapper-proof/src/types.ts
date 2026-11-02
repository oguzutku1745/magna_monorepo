import type { ProofData } from "@aztec/bb.js";
import type { InputMap } from "@noir-lang/types";

export const PASSPORT_A2_SCHEMA = "passport-a2-v1" as const;
export const PASSPORT_A2_INNER_NAME = "outer_count_7" as const;
// Reviewed release; acceptance is bound to its verification key, not this label.
export const PASSPORT_A2_INNER_VERSION = "0.21.1" as const;
export const PASSPORT_A2_INNER_VKEY_HASH =
  "0x29678c37af3bf4df3517cf7104286665eee0a9b6f189405c159eaa84f820f372" as const;
export const PASSPORT_A2_OPRF_KEY_ID = "1" as const;
export const PASSPORT_A2_OPRF_PUBLIC_KEY_HASH =
  "1178201404428554206520802247552222388413553631367032661928167491793274360628" as const;
export const PASSPORT_A2_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH = "0" as const;
export const PASSPORT_A2_PRODUCTION_NULLIFIER_TYPE = 1 as const;
export const PASSPORT_A2_DEVELOPMENT_NULLIFIER_TYPE = 2 as const;
export const PASSPORT_A2_WRAPPER_ARTIFACT_SHA256 =
  "f52714558d3c215f6481034a17fdc7e641f0279831977f5508a97070f7957039" as const;
export const PASSPORT_A2_DEVELOPMENT_WRAPPER_ARTIFACT_SHA256 =
  "03ff4bb57297ae75858433a97ddea12998af517a81bda9f7f4a7f34ed005483b" as const;
export const PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT = 12;
export const PASSPORT_A2_INNER_PROOF_FIELD_COUNT = 458;
export const PASSPORT_A2_INNER_VKEY_FIELD_COUNT = 115;
export const PASSPORT_WRAPPER_PUBLIC_INPUT_COUNT = 8;
// The pinned wrappers have a 2^20 Barretenberg proving domain; bb.js defaults
// to only 2^19 CRS points in non-iOS browsers.
export const PASSPORT_A2_WRAPPER_SRS_SIZE = 2 ** 20;

export type BigintLike = bigint | number | string;
export type PassportA2Action = "issue" | "renew" | "recover";
export type PassportA2ProofProfile = "development" | "production";
export type PassportA2CredentialMode = "passport" | "rooted";
export type ZkPassportMrzLayout = "passport" | "id_card";
export type PassportA2NullifierType = 0 | 1 | 2 | 3;

export type PassportA2RegistryContext = {
  certificateRegistryRoot: string;
  circuitRegistryRoot: string;
  nullifierType: PassportA2NullifierType;
  oprfPublicKeyHash: string;
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
  profile: PassportA2ProofProfile;
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
  facematch: {
    rootKeyLeaf: BigintLike;
    environment: "production";
    appIdHash: BigintLike;
    integrityPublicKeyHash: BigintLike;
    mode: "regular" | "strict";
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
  innerProofVersion: string;
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
