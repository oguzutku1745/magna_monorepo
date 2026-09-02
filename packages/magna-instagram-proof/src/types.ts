export const MAX_INSTAGRAM_HANDLE_LENGTH = 30;

export const INSTAGRAM_V2_SCHEMA = "instagram-v2" as const;
export const INSTAGRAM_V2_VALIDITY_SECONDS = 365 * 24 * 60 * 60;

// Semantic ACIR hash emitted by scripts/compile-instagram-circuit.mjs using the
// exact zkemail.nr compiler pin (nargo 1.0.0-beta.5).
export const INSTAGRAM_V2_ACIR_SHA256 =
  "abbedc80f0d3338ac2ea8b1ae5991417ff5a7ffbc84b752e4a35eb10466ba295";

export const INSTAGRAM_TEMPLATE = {
  english: 1,
} as const;

export type InstagramTemplateName = keyof typeof INSTAGRAM_TEMPLATE;

export type InstagramProofPublicOutputs = {
  dkimPubkeyHash: string;
  emailNullifier: string;
  claimsHash: string;
  expiryTs: string;
  activeOwner: string;
  issuerAddress: string;
  chainId: string;
};

export type InstagramIssuanceContext = {
  handleBlind: bigint;
  expiryTs: bigint;
  activeOwner: bigint;
  issuerAddress: bigint;
  chainId: bigint;
};

export type InstagramProofInputMetadata = {
  normalizedHandle: string;
  template: InstagramTemplateName;
  prefixIndex: number;
  handleLen: number;
  handlePacked: bigint;
  handleBlind: bigint;
  expiryTs: bigint;
  activeOwner: bigint;
  issuerAddress: bigint;
  chainId: bigint;
};

export type InstagramCircuitInputs = InputMap;

export type GenerateInstagramInputsResult = {
  inputs: InstagramCircuitInputs;
  metadata: InstagramProofInputMetadata;
};
import type { InputMap } from "@noir-lang/types";
