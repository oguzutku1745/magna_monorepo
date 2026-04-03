import type { ContractFunctionInteraction } from "@aztec/aztec.js/contracts";
export { MagnaIssuerContract, MagnaIssuerContractArtifact } from "./MagnaIssuer.js";
export {
  MagnaCompanySponsorContract,
  MagnaCompanySponsorContractArtifact,
} from "./MagnaCompanySponsor.js";
export {
  MagnaVerifyMeterHookContract,
  MagnaVerifyMeterHookContractArtifact,
} from "./MagnaVerifyMeterHook.js";
export { MagnaConsumerContract, MagnaConsumerContractArtifact } from "./MagnaConsumer.js";
export {
  MagnaVerifyMeterHookInstantContract,
  MagnaVerifyMeterHookInstantContractArtifact,
} from "./MagnaVerifyMeterHookInstant.js";
export {
  MagnaCompanyRightsRegistryContract,
  MagnaCompanyRightsRegistryContractArtifact,
} from "./MagnaCompanyRightsRegistry.js";
export {
  MagnaRightsPurchaseL2Contract,
  MagnaRightsPurchaseL2ContractArtifact,
} from "./MagnaRightsPurchaseL2.js";

export type ContractMethod = (...args: unknown[]) => ContractFunctionInteraction;
export type ContractLike = {
  address?: unknown;
  methods: Record<string, ContractMethod>;
};
