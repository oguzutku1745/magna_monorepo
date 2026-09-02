import type { FeeConfig } from "./fees.js";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { FeePaymentMethod } from "@aztec/aztec.js/fee";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { GasFees, ManaUsageEstimate } from "@aztec/stdlib/gas";
import { ExecutionPayload } from "@aztec/aztec.js/tx";

const COMPANY_SPONSOR_MAX_FEE_PADDING = 0.5;

type GasLimitsLike = { daGas: number; l2Gas: number };
type GasFeesLike = { feePerDaGas: bigint; feePerL2Gas: bigint };

export type CompanySponsorFeeConfigOptions = {
  gasLimits?: GasLimitsLike;
  maxFeesPerGas?: GasFeesLike;
  congestionEstimate?: ManaUsageEstimate;
};

export type CompanySponsorNetworkFeeConfigOptions = {
  aztecNodeUrl: string;
  maxFeeCap?: bigint;
};

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
  options: CompanySponsorFeeConfigOptions = {},
): FeeConfig {
  const gasSettings: FeeConfig["gasSettings"] = {};
  if (options.gasLimits) {
    gasSettings.gasLimits = options.gasLimits;
  }
  if (options.maxFeesPerGas) {
    gasSettings.maxFeesPerGas = options.maxFeesPerGas;
  }
  return {
    paymentMethod: new CompanySponsorFeePaymentMethod(companySponsorAddress),
    ...(Object.keys(gasSettings).length > 0 ? { gasSettings } : {}),
    congestionEstimate: options.congestionEstimate ?? ManaUsageEstimate.None,
    estimateGas: true,
    estimatedGasPadding: 0.2,
  };
}

function maxFeeUpperBound(gasLimits: GasLimitsLike, fees: GasFeesLike): bigint {
  return BigInt(gasLimits.daGas) * fees.feePerDaGas + BigInt(gasLimits.l2Gas) * fees.feePerL2Gas;
}

function toGasFeesLike(fees: GasFees): GasFeesLike {
  return {
    feePerDaGas: fees.feePerDaGas,
    feePerL2Gas: fees.feePerL2Gas,
  };
}

export async function buildCompanySponsorNetworkFeeConfig(
  companySponsorAddress: AztecAddress,
  options: CompanySponsorNetworkFeeConfigOptions,
): Promise<FeeConfig> {
  const node = createAztecNodeClient(options.aztecNodeUrl);
  const [nodeInfo, currentMinFees] = await Promise.all([
    node.getNodeInfo(),
    node.getCurrentMinFees(),
  ]);
  const gasLimits = {
    daGas: nodeInfo.txsLimits.gas.daGas,
    l2Gas: nodeInfo.txsLimits.gas.l2Gas,
  };
  const currentFees = toGasFeesLike(currentMinFees);
  let maxFeesPerGas = toGasFeesLike(currentMinFees.mul(1 + COMPANY_SPONSOR_MAX_FEE_PADDING));

  if (options.maxFeeCap !== undefined && maxFeeUpperBound(gasLimits, maxFeesPerGas) > options.maxFeeCap) {
    if (maxFeeUpperBound(gasLimits, currentFees) > options.maxFeeCap) {
      throw new Error(
        `Configured company sponsor fee cap ${options.maxFeeCap.toString()} is below this network's current ` +
          `minimum sponsored transaction fee bound ${maxFeeUpperBound(gasLimits, currentFees).toString()}. ` +
          "Redeploy the company sponsor with a higher max fee cap.",
      );
    }
    maxFeesPerGas = currentFees;
  }

  return buildCompanySponsorFeeConfig(companySponsorAddress, {
    gasLimits,
    maxFeesPerGas,
    congestionEstimate: ManaUsageEstimate.None,
  });
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
    paymentMethod: new SponsoredFeePaymentMethod(AztecAddress.fromStringUnsafe(sponsoredFpcAddress)),
    estimateGas: true,
    estimatedGasPadding: 0.2,
  };
}
