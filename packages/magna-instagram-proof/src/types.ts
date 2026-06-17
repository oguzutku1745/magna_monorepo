export const MAX_INSTAGRAM_HANDLE_LENGTH = 30;

export const INSTAGRAM_TEMPLATE = {
  english: 1,
  turkish: 2,
} as const;

export type InstagramTemplateName = keyof typeof INSTAGRAM_TEMPLATE;

export type InstagramProofPublicOutputs = {
  dkimPubkeyHash: string;
  emailNullifier: string;
  handleLen: number;
  handlePacked: string;
};

export type InstagramProofInputMetadata = {
  normalizedHandle: string;
  template: InstagramTemplateName;
  prefixIndex: number;
  handleLen: number;
  handlePacked: bigint;
};

export type InstagramCircuitInputs = InputMap;

export type GenerateInstagramInputsResult = {
  inputs: InstagramCircuitInputs;
  metadata: InstagramProofInputMetadata;
};
import type { InputMap } from "@noir-lang/types";
