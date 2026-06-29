export type FeeConfig = {
  paymentMethod?: unknown;
  gasSettings?: {
    gasLimits?: { daGas: number; l2Gas: number };
    teardownGasLimits?: { daGas: number; l2Gas: number };
    maxFeesPerGas?: { feePerDaGas: bigint; feePerL2Gas: bigint };
    maxPriorityFeesPerGas?: { feePerDaGas: bigint; feePerL2Gas: bigint };
  };
  congestionEstimate?: unknown;
  estimateGas?: boolean;
  estimatedGasPadding?: number;
};

export type SponsorshipPolicy = {
  allowCredentialTypes: number[];
  maxVerificationsPerEpoch?: number;
};

/**
 * Local representation of sponsorship rules.
 * Production onchain enforcement is implemented by the issuer-sponsored path,
 * the dedicated `MagnaCompanySponsor` gateway contract, and an external fee
 * config that marks the gateway as the tx fee payer before the account entrypoint runs.
 */
export function isVerificationSponsored(
  credentialType: number,
  policy: SponsorshipPolicy,
): boolean {
  return policy.allowCredentialTypes.includes(credentialType);
}
