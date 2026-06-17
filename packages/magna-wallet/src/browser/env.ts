export type MagnaBrowserEnv = {
  aztecNodeUrl: string;
  l1RpcUrl?: string;
  l1RightsPortalAddress?: string;
  l1PaymentTokenAddress?: string;
  l1BuyerPrivateKey?: string;
  issuerAddress?: string;
  companySponsorAddresses: string[];
  activeCompanySponsorAddress?: string;
  rightsRegistryAddress?: string;
  rightsPurchaseL2Address?: string;
  l2PaymentTokenAddress?: string;
  orchestratorAddress?: string;
  requireRealSends: boolean;
  enableDevOrchestrator: boolean;
  enableLocalTestBootstrap: boolean;
  localTestAccountIndex: number;
};
