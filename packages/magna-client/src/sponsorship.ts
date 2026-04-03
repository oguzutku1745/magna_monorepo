import type { FeeConfig } from "./fees.js";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { FeePaymentMethod } from "@aztec/aztec.js/fee";
import { ExecutionPayload } from "@aztec/aztec.js/tx";

export class CompanySponsorFeePaymentMethod implements FeePaymentMethod {
  constructor(private readonly sponsorGateway: AztecAddress) {}

  getAsset(): Promise<AztecAddress> {
    throw new Error("Asset is not required for sponsor gateway fee payment");
  }

  async getExecutionPayload(): Promise<ExecutionPayload> {
    return new ExecutionPayload([], [], [], [], this.sponsorGateway);
  }

  getFeePayer() {
    return Promise.resolve(this.sponsorGateway);
  }

  getGasSettings(): ReturnType<FeePaymentMethod["getGasSettings"]> {
    return undefined;
  }
}

/**
 * Company-sponsored Magna verifies still need an external fee-payment method at send-time.
 * The fee payload is intentionally empty: the app call itself goes to the sponsor gateway,
 * while the embedded fee payer address makes the account entrypoint use `EXTERNAL`.
 */
export function buildCompanySponsorFeeConfig(
  companySponsorAddress: AztecAddress,
): FeeConfig {
  return {
    paymentMethod: new CompanySponsorFeePaymentMethod(companySponsorAddress),
    estimateGas: true,
    estimatedGasPadding: 0.2,
  };
}

/**
 * Legacy helper for the testing-only SponsoredFPC payment method.
 * Production Magna company sponsorship uses `buildCompanySponsorFeeConfig(...)`.
 */
export async function buildSponsoredFeeConfig(
  sponsoredFpcAddress: string,
): Promise<FeeConfig> {
  const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee/testing");
  return {
    paymentMethod: new SponsoredFeePaymentMethod(AztecAddress.fromString(sponsoredFpcAddress)),
    estimateGas: true,
    estimatedGasPadding: 0.2,
  };
}
