import type { InstagramProofPublicOutputs } from "./types.js";

export function parseInstagramPublicInputs(publicInputs: string[]): InstagramProofPublicOutputs {
  if (publicInputs.length !== 7) {
    throw new Error(`Instagram V2 proof must expose exactly seven public inputs; received ${publicInputs.length}.`);
  }
  const [dkimPubkeyHash, emailNullifier, claimsHash, expiryTs, activeOwner, issuerAddress, chainId] =
    publicInputs.map(String);
  return {
    dkimPubkeyHash,
    emailNullifier,
    claimsHash,
    expiryTs,
    activeOwner,
    issuerAddress,
    chainId,
  };
}
