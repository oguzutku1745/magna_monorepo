export * from "./webauthn/der.js";
export * from "./webauthn/cbor.js";
export * from "./webauthn/public-key.js";
export * from "./webauthn/witness.js";
export * from "./webauthn/ceremony.js";
export * from "./webauthn/account-contract.js";
export * from "./engine/verification-engine.js";
export * from "./engine/encoding.js";
export * from "./engine/zkpassport-safe-witness.js";
export * from "./engine/fees.js";
export * from "./engine/ghost.js";
export * from "./engine/root.js";
export * from "./engine/sponsorship.js";
export * from "./engine/types.js";
export * from "./browser/aztec.js";
export * from "./browser/pxe-cache.js";
export type { MagnaConsumerLoginCredential, MagnaConsumerLoginOutcome } from "./browser/consumer-login.js";
export { runMagnaConsumerLogin } from "./browser/consumer-login.js";
export type {
  ContractCompatibilityMatrix,
  DiscoveredMagnaCredentialRef,
  GhostAccountPreview,
  GhostDerivationInputForm,
  IssuePassportDevOrchestratorOptions,
  IssuePassportRequest,
  L1TopUpOutcome,
  L1TopUpRequest,
  L2TopUpOutcome,
  L2TopUpRequest,
  PassportClaimsForm,
  PassportHints,
  PolicyForm,
  RootedPassportHints,
  SponsorRightsSnapshot,
  SponsorRuntimeStatus,
  TxOutcome,
} from "./browser/client.js";
export {
  buildPassportCommittedClaimsWitness,
  buildPassportClaimsWitness,
  buildPassportPolicy,
  CONTRACT_COMPATIBILITY_REQUIREMENTS,
  createDefaultPassportClaimsForm,
  createDefaultPolicyForm,
  deriveGhostAccountPreview,
  issuePassportWithDevOrchestrator,
  isRootedPassportHints,
  MagnaBrowserClient,
  passportClaimsFromForm,
  readSponsorSlot,
} from "./browser/client.js";
export type { MagnaBrowserEnv } from "./browser/env.js";

export {
  bindExternalProviderDisconnect,
  beginExternalWalletConnection,
  confirmExternalWalletConnection,
  createEmbeddedWallet,
  createManagedWalletSession,
  createTransientGhostWalletSession,
  discoverExternalWallets,
  ensureGhostAccountLifecycle,
  ensureImportedLocalTestAccount,
  ensureImportedLocalTestAccountAddress,
  startExternalWalletDiscovery,
  type ExternalWalletDiscovery,
  type ExternalWalletDiscoveryOptions,
  type GhostAccountLifecycleOptions,
  type GhostAccountLifecycleResult,
  type ManagedAccountFlavor,
  type ManagedWalletOptions,
  type PendingExternalWalletConnection,
  type TransientGhostWalletSession,
  type WalletAccount,
  type WalletProvider,
  type WalletSession,
  type WalletSessionKind,
} from "./embedded/lifecycle.js";
export { registerKnownIssuerSender } from "./embedded/note-discovery.js";
export * from "./embedded/webauthn-session.js";
