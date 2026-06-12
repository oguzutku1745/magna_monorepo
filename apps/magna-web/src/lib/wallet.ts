import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { ContractInitializationStatus, type AccountManager } from "@aztec/aztec.js/wallet";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { CAPABILITY_VERSION, type AppCapabilities } from "@aztec/aztec.js/wallet";
import { Fq, Fr } from "@aztec/aztec.js/fields";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import { hashToEmoji } from "@aztec/wallet-sdk/crypto";
import {
  WalletManager,
  type DiscoverySession,
  type PendingConnection,
  type WalletProvider,
} from "@aztec/wallet-sdk/manager";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { Buffer } from "buffer";
import {
  SCOPED_GHOST_DERIVATION_VERSION,
  deriveGhostKeyMaterial,
  type GhostDerivationVersion,
} from "@magna/wallet";
import type { CredentialType } from "@magna/core";
import { getChainInfo, stringifyAddress } from "./aztec";
import { derivePasskeyDeterministicBytes } from "./passkey";

export type WalletSessionKind = "external" | "managed" | "passkey";
export type ManagedAccountFlavor = "schnorr" | "secp256r1";

export type WalletAccount = {
  alias: string;
  address: string;
};

export type WalletSession = {
  kind: WalletSessionKind;
  label: string;
  wallet: Wallet;
  accounts: WalletAccount[];
  activeAccount: WalletAccount;
  disconnect: () => Promise<void>;
  metadata?: Record<string, string>;
};

export type PendingExternalWalletConnection = {
  provider: WalletProvider;
  pending: PendingConnection;
  emojiGrid: string;
  appId: string;
};

export type ExternalWalletDiscovery = {
  done: Promise<WalletProvider[]>;
  cancel: () => void;
};

export type ExternalWalletDiscoveryOptions = {
  timeoutMs?: number;
  allowList?: string[];
  blockList?: string[];
  onWalletDiscovered?: (provider: WalletProvider) => void;
};

export type ManagedWalletOptions = {
  nodeUrl: string;
  alias: string;
  flavor: ManagedAccountFlavor;
  ephemeral?: boolean;
  localTestAccountIndex: number;
  bootstrapWithLocalTestAccount: boolean;
  deployWithLocalTestAccount?: boolean;
};

export type PasskeyWalletOptions = {
  nodeUrl: string;
  alias: string;
  credentialId: string;
  localTestAccountIndex?: number;
  deployWithLocalTestAccount?: boolean;
};

export type GhostAccountLifecycleOptions = {
  nodeUrl: string;
  uniqueIdentifier: string;
  credentialType: CredentialType;
  alias?: string;
  derivationVersion?: GhostDerivationVersion;
  deploymentFromAddress?: string;
  localTestAccountIndex?: number;
  deployWithLocalTestAccount?: boolean;
};

export type GhostAccountLifecycleResult = {
  address: string;
  derivationVersion: GhostDerivationVersion;
  scope: string;
  deploymentStatus: "deployed" | "counterfactual";
  localState: "derived-each-time";
  feePayer: string;
};

export type TransientGhostWalletSession = {
  wallet: Wallet;
  ghostAddress: string;
  derivationVersion: GhostDerivationVersion;
  scope: string;
  deploymentStatus: "deployed" | "counterfactual";
  localState: "derived-each-time";
  feePayer: string;
  dispose: () => Promise<void>;
};

type EmbeddedWalletStoredAccount = {
  secretKey: Fr;
  salt: Fr;
  type: "schnorr" | "ecdsasecp256r1" | "ecdsasecp256k1";
  signingKey: Buffer;
};

type EmbeddedWalletWithInternals = EmbeddedWallet & {
  walletDB?: {
    retrieveAccount: (address: AztecAddress | string) => Promise<EmbeddedWalletStoredAccount>;
  };
  pxe?: {
    debug?: {
      sync?: () => Promise<void>;
    };
  };
};

function readStorageMode(ephemeral: boolean): "ephemeral" | "persistent" {
  return ephemeral ? "ephemeral" : "persistent";
}

function pickReusableManagedAccount(accounts: WalletAccount[], alias: string): WalletAccount | null {
  const normalizedAlias = alias.trim();
  if (normalizedAlias) {
    const exactAliasMatch = accounts.find(account => account.alias === normalizedAlias);
    if (exactAliasMatch) {
      return exactAliasMatch;
    }
  }
  return accounts.length === 1 ? accounts[0] : null;
}

async function syncEmbeddedWalletPxeIfAvailable(wallet: EmbeddedWallet): Promise<void> {
  const pxeDebug = (wallet as EmbeddedWalletWithInternals).pxe?.debug;
  if (!pxeDebug?.sync) {
    return;
  }
  await pxeDebug.sync();
}

async function ensureAccountManagerRegistered(
  wallet: EmbeddedWallet,
  accountManager: AccountManager,
): Promise<void> {
  await wallet.registerContract(
    accountManager.getInstance(),
    await accountManager.getAccountContract().getContractArtifact(),
    accountManager.getSecretKey(),
  );
  await syncEmbeddedWalletPxeIfAvailable(wallet);
}

type AccountDeploymentResult = {
  isReady: boolean;
  feePayerAddress?: string;
};

type DeploymentFundingOptions = {
  localTestAccountIndex?: number;
  fromAddress?: string;
};

async function readAccountInitializationStatus(
  wallet: EmbeddedWallet,
  address: AztecAddress,
): Promise<ContractInitializationStatus> {
  await syncEmbeddedWalletPxeIfAvailable(wallet);
  const metadata = await wallet.getContractMetadata(address);
  return metadata.initializationStatus;
}

async function ensureAccountManagerDeployed(
  wallet: EmbeddedWallet,
  accountManager: AccountManager,
  funding?: DeploymentFundingOptions,
): Promise<AccountDeploymentResult> {
  const initializationStatus = await readAccountInitializationStatus(wallet, accountManager.address);
  if (initializationStatus === ContractInitializationStatus.INITIALIZED) {
    return { isReady: true };
  }
  let feePayerAddress: AztecAddress | undefined;
  if (funding?.fromAddress) {
    feePayerAddress = AztecAddress.fromString(funding.fromAddress);
  } else if (funding?.localTestAccountIndex !== undefined) {
    feePayerAddress = await ensureImportedLocalTestAccountAddress(wallet, funding.localTestAccountIndex);
  }
  if (!feePayerAddress) {
    return { isReady: false };
  }

  const deployMethod = await accountManager.getDeployMethod();
  try {
    await deployMethod.send({
      from: feePayerAddress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Existing nullifier")) {
      throw error;
    }
    const statusAfterConflict = await readAccountInitializationStatus(wallet, accountManager.address);
    if (statusAfterConflict !== ContractInitializationStatus.INITIALIZED) {
      throw error;
    }
  }

  return {
    isReady: true,
    feePayerAddress: feePayerAddress.toString(),
  };
}

async function restoreEmbeddedAccountManager(
  wallet: EmbeddedWallet,
  address: string,
  alias?: string,
): Promise<AccountManager | null> {
  const stored = await (wallet as EmbeddedWalletWithInternals).walletDB?.retrieveAccount(address);
  if (!stored) {
    return null;
  }
  switch (stored.type) {
    case "schnorr":
      return await wallet.createSchnorrAccount(stored.secretKey, stored.salt, Fq.fromBuffer(stored.signingKey), alias);
    case "ecdsasecp256r1":
      return await wallet.createECDSARAccount(stored.secretKey, stored.salt, Buffer.from(stored.signingKey), alias);
    case "ecdsasecp256k1":
      return await wallet.createECDSAKAccount(stored.secretKey, stored.salt, Buffer.from(stored.signingKey), alias);
    default:
      return null;
  }
}

function logExternalWalletFlow(step: string, details?: Record<string, unknown>) {
  if (details) {
    console.info("[magna][external-wallet]", step, details);
    return;
  }
  console.info("[magna][external-wallet]", step);
}

function createStallWarning(step: string, details?: Record<string, unknown>, timeoutMs: number = 5_000) {
  return setTimeout(() => {
    if (details) {
      console.warn("[magna][external-wallet]", `${step} still pending`, details);
      return;
    }
    console.warn("[magna][external-wallet]", `${step} still pending`);
  }, timeoutMs);
}

type ExternalWalletCapabilityGrant = {
  accounts: WalletAccount[];
  walletName: string;
  walletVersion: string;
  grantedCapabilityTypes: string[];
};

function createExternalWalletCapabilityManifest(appId: string): AppCapabilities {
  const url = typeof window !== "undefined" ? window.location.origin : undefined;
  return {
    version: CAPABILITY_VERSION,
    metadata: {
      name: "Magna Web",
      version: "0.1.0",
      description: "Issue, verify, recover, and sponsor Magna credentials with an external Aztec wallet.",
      url,
    },
    capabilities: [
      {
        type: "accounts",
        canGet: true,
        canCreateAuthWit: true,
      },
      {
        type: "contracts",
        contracts: "*",
        canRegister: true,
        canGetMetadata: true,
      },
      {
        type: "contractClasses",
        classes: "*",
        canGetMetadata: true,
      },
      {
        type: "simulation",
        transactions: { scope: "*" },
        utilities: { scope: "*" },
      },
      {
        type: "transaction",
        scope: "*",
      },
      {
        type: "data",
        addressBook: true,
        privateEvents: { contracts: "*" },
      },
    ],
  };
}

async function requestExternalWalletCapabilities(wallet: Wallet, appId: string): Promise<ExternalWalletCapabilityGrant> {
  const manifest = createExternalWalletCapabilityManifest(appId);
  logExternalWalletFlow("capabilities:request:start", {
    appId,
    capabilityTypes: manifest.capabilities.map(capability => capability.type),
  });
  const stallWarning = createStallWarning("capabilities:request", { appId });
  try {
    const granted = await wallet.requestCapabilities(manifest);
    const grantedAccountsCapability = granted.granted.find(capability => capability.type === "accounts");
    const grantedAccounts =
      grantedAccountsCapability && "accounts" in grantedAccountsCapability
        ? grantedAccountsCapability.accounts.map(account => ({
            alias: account.alias,
            address: stringifyAddress(account.item),
          }))
        : [];
    const grantedCapabilityTypes = granted.granted.map(capability => capability.type);
    logExternalWalletFlow("capabilities:request:resolved", {
      appId,
      walletName: granted.wallet.name,
      walletVersion: granted.wallet.version,
      grantedCapabilityTypes,
      grantedAccounts: grantedAccounts.map(account => account.address),
    });
    return {
      accounts: grantedAccounts,
      walletName: granted.wallet.name,
      walletVersion: granted.wallet.version,
      grantedCapabilityTypes,
    };
  } finally {
    clearTimeout(stallWarning);
  }
}

function toWalletAccounts(accounts: Awaited<ReturnType<Wallet["getAccounts"]>>): WalletAccount[] {
  return accounts.map(account => ({
    alias: account.alias,
    address: stringifyAddress(account.item),
  }));
}

function filterWalletAccounts(accounts: WalletAccount[], hiddenAddresses: string[]): WalletAccount[] {
  if (hiddenAddresses.length === 0) {
    return accounts;
  }
  const hidden = new Set(hiddenAddresses);
  return accounts.filter(account => !hidden.has(account.address));
}

function getPreferredAccount(accounts: WalletAccount[], preferredAddress?: string): WalletAccount {
  if (preferredAddress) {
    const match = accounts.find(account => account.address === preferredAddress);
    if (match) {
      return match;
    }
  }
  const first = accounts[0];
  if (!first) {
    throw new Error("No wallet accounts are available.");
  }
  return first;
}

async function buildWalletSession(
  kind: WalletSessionKind,
  label: string,
  wallet: Wallet,
  disconnect: () => Promise<void>,
  preferredAddress?: string,
  metadata?: Record<string, string>,
  preloadedAccounts?: WalletAccount[],
): Promise<WalletSession> {
  let accounts: WalletAccount[];
  if (preloadedAccounts) {
    accounts = preloadedAccounts;
    logExternalWalletFlow("buildWalletSession:accounts:preloaded", {
      kind,
      label,
      accountCount: accounts.length,
    });
  } else {
    logExternalWalletFlow("buildWalletSession:getAccounts:start", { kind, label, preferredAddress });
    const stallWarning = createStallWarning("buildWalletSession:getAccounts", { kind, label });
    try {
      accounts = toWalletAccounts(await wallet.getAccounts());
    } finally {
      clearTimeout(stallWarning);
    }
    logExternalWalletFlow("buildWalletSession:getAccounts:resolved", {
      kind,
      label,
      accountCount: accounts.length,
    });
  }
  return {
    kind,
    label,
    wallet,
    accounts,
    activeAccount: getPreferredAccount(accounts, preferredAddress),
    disconnect,
    metadata,
  };
}

async function generateValidSecp256r1PrivateKey(): Promise<Uint8Array> {
  const ecdsa = new Ecdsa("secp256r1");
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = crypto.getRandomValues(new Uint8Array(32));
    try {
      await ecdsa.computePublicKey(Buffer.from(candidate));
      return candidate;
    } catch {
      // Retry until the candidate is a valid scalar.
    }
  }
  throw new Error("Failed to generate a valid secp256r1 signing key.");
}

async function deriveValidSecp256r1PrivateKey(seedLabel: string, credentialId: string): Promise<Uint8Array> {
  const ecdsa = new Ecdsa("secp256r1");
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const domain = `${seedLabel}:${attempt}`;
    const candidate = await derivePasskeyDeterministicBytes(credentialId, domain, 32);
    try {
      await ecdsa.computePublicKey(Buffer.from(candidate));
      return candidate;
    } catch {
      // Keep trying deterministic variants until a valid scalar is found.
    }
  }
  throw new Error("Failed to derive a valid deterministic secp256r1 signing key from passkey credential.");
}

async function derivePasskeyAccountMaterial(credentialId: string): Promise<{
  secret: Fr;
  salt: Fr;
  signingKey: Uint8Array;
}> {
  const secretBytes = await derivePasskeyDeterministicBytes(credentialId, "magna-passkey-secret", 64);
  const saltBytes = await derivePasskeyDeterministicBytes(credentialId, "magna-passkey-salt", 64);
  const signingKey = await deriveValidSecp256r1PrivateKey("magna-passkey-signing-key", credentialId);
  return {
    secret: Fr.fromBufferReduce(Buffer.from(secretBytes)),
    salt: Fr.fromBufferReduce(Buffer.from(saltBytes)),
    signingKey,
  };
}

export async function createEmbeddedWallet(nodeUrl: string, ephemeral: boolean): Promise<EmbeddedWallet> {
  const node = createAztecNodeClient(nodeUrl);
  await waitForNode(node);
  return EmbeddedWallet.create(node, { ephemeral });
}

export async function ensureImportedLocalTestAccountAddress(
  wallet: EmbeddedWallet,
  index: number,
): Promise<AztecAddress> {
  const initialAccounts = await getInitialTestAccountsData();
  const accountData = initialAccounts[index];
  if (!accountData) {
    throw new Error(`Local test account index ${index} is not available.`);
  }

  const currentAccounts = await wallet.getAccounts();
  const existing = currentAccounts.find(account => account.item.equals(accountData.address));
  if (existing) {
    return existing.item;
  }

  const alias = `local-test-${index}`;
  const importedAccount = await wallet.createSchnorrAccount(
    accountData.secret,
    accountData.salt,
    accountData.signingKey,
    alias,
  );
  const updatedAccounts = await wallet.getAccounts();
  const importedMatch = updatedAccounts.find(account => account.item.equals(importedAccount.address));
  return importedMatch?.item ?? importedAccount.address;
}

export async function ensureImportedLocalTestAccount(wallet: EmbeddedWallet, index: number): Promise<WalletAccount> {
  const address = await ensureImportedLocalTestAccountAddress(wallet, index);
  const alias = `local-test-${index}`;
  const updatedAccounts = toWalletAccounts(await wallet.getAccounts());
  return (
    updatedAccounts.find(account => account.address === address.toString()) ??
    {
      alias,
      address: address.toString(),
    }
  );
}

async function ensureImportedLocalTestAccounts(
  wallet: EmbeddedWallet,
  startIndex: number,
  count: number,
): Promise<WalletAccount[]> {
  const imported: WalletAccount[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const index = startIndex + offset;
    try {
      imported.push(await ensureImportedLocalTestAccount(wallet, index));
    } catch (error) {
      if (offset === 0) {
        throw error;
      }
      break;
    }
  }
  return imported;
}

async function createManagedAccount(
  wallet: EmbeddedWallet,
  flavor: ManagedAccountFlavor,
  alias: string,
): Promise<AccountManager> {
  if (flavor === "schnorr") {
    return wallet.createSchnorrAccount(Fr.random(), Fr.random(), undefined, alias);
  }

  const signingKey = await generateValidSecp256r1PrivateKey();
  return wallet.createECDSARAccount(Fr.random(), Fr.random(), Buffer.from(signingKey), alias);
}

export async function discoverExternalWallets(
  nodeUrl: string,
  appId: string,
  timeoutMs: number = 60_000,
): Promise<WalletProvider[]> {
  const discovery = await startExternalWalletDiscovery(nodeUrl, appId, { timeoutMs });
  return discovery.done;
}

function parseExtensionList(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const normalized = values.map(value => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

export async function startExternalWalletDiscovery(
  nodeUrl: string,
  appId: string,
  options: ExternalWalletDiscoveryOptions = {},
): Promise<ExternalWalletDiscovery> {
  logExternalWalletFlow("discovery:start", {
    nodeUrl,
    appId,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  const chainInfo = await getChainInfo(nodeUrl);
  logExternalWalletFlow("discovery:chainInfo", {
    chainId: chainInfo.chainId.toString(),
    version: chainInfo.version.toString(),
  });
  const discovered: WalletProvider[] = [];
  const seen = new Set<string>();
  let closed = false;
  const extensionAllowList = parseExtensionList(options.allowList);
  const extensionBlockList = parseExtensionList(options.blockList);
  const manager = WalletManager.configure({
    extensions: {
      enabled: true,
      allowList: extensionAllowList,
      blockList: extensionBlockList,
    },
  });
  const discovery: DiscoverySession = manager.getAvailableWallets({
    chainInfo,
    appId,
    timeout: options.timeoutMs ?? 60_000,
    onWalletDiscovered: provider => {
      if (closed) return;
      if (seen.has(provider.id)) {
        return;
      }
      seen.add(provider.id);
      discovered.push(provider);
      logExternalWalletFlow("discovery:providerDiscovered", {
        providerId: provider.id,
        providerName: provider.name,
        providerType: provider.type,
      });
      options.onWalletDiscovered?.(provider);
    },
  });

  const done = discovery.done.then(() => {
    logExternalWalletFlow("discovery:done", { providerCount: discovered.length });
    return discovered.slice();
  });
  const cancel = () => {
    if (closed) return;
    closed = true;
    logExternalWalletFlow("discovery:cancel");
    discovery.cancel();
  };

  return { done, cancel };
}

export async function beginExternalWalletConnection(
  provider: WalletProvider,
  appId: string,
): Promise<PendingExternalWalletConnection> {
  logExternalWalletFlow("secureChannel:start", {
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.type,
    appId,
  });
  const stallWarning = createStallWarning("secureChannel:keyExchange", {
    providerId: provider.id,
    providerName: provider.name,
  });
  const pending = await provider.establishSecureChannel(appId);
  clearTimeout(stallWarning);
  logExternalWalletFlow("secureChannel:ready", {
    providerId: provider.id,
    providerName: provider.name,
    verificationHash: pending.verificationHash,
  });
  return {
    provider,
    pending,
    emojiGrid: hashToEmoji(pending.verificationHash),
    appId,
  };
}

export async function confirmExternalWalletConnection(
  connection: PendingExternalWalletConnection,
): Promise<WalletSession> {
  logExternalWalletFlow("confirm:start", {
    providerId: connection.provider.id,
    providerName: connection.provider.name,
  });
  const confirmStallWarning = createStallWarning("confirm:pending.confirm", {
    providerId: connection.provider.id,
    providerName: connection.provider.name,
  });
  const wallet = await connection.pending.confirm();
  clearTimeout(confirmStallWarning);
  logExternalWalletFlow("confirm:walletResolved", {
    providerId: connection.provider.id,
    providerName: connection.provider.name,
  });
  const granted = await requestExternalWalletCapabilities(wallet, connection.appId);
  if (granted.accounts.length === 0) {
    throw new Error("Wallet connected, but no accounts capability was granted.");
  }
  return buildWalletSession(
    "external",
    connection.provider.name,
    wallet,
    () => connection.provider.disconnect(),
    undefined,
    {
      providerId: connection.provider.id,
      providerType: connection.provider.type,
      walletVersion: granted.walletVersion,
      grantedCapabilities: granted.grantedCapabilityTypes.join(", "),
    },
    granted.accounts,
  );
}

export function bindExternalProviderDisconnect(
  provider: WalletProvider,
  onDisconnect: () => void,
): () => void {
  return provider.onDisconnect(onDisconnect);
}

export async function createManagedWalletSession(
  options: ManagedWalletOptions,
): Promise<WalletSession> {
  const storageIsEphemeral = options.ephemeral ?? false;
  const wallet = await createEmbeddedWallet(options.nodeUrl, storageIsEphemeral);
  if (options.bootstrapWithLocalTestAccount) {
    if (options.flavor !== "schnorr") {
      await wallet.stop();
      throw new Error("Local test bootstrap currently supports only Schnorr managed sessions.");
    }

    const importedAccounts = await ensureImportedLocalTestAccounts(wallet, options.localTestAccountIndex, 3);
    const orchestratorAccount = importedAccounts[0];
    const activeAccount = importedAccounts[1] ?? orchestratorAccount;
    const recoveryAccount =
      importedAccounts[2] ??
      importedAccounts.find(account => account.address !== activeAccount.address && account.address !== orchestratorAccount.address) ??
      importedAccounts.find(account => account.address !== activeAccount.address) ??
      activeAccount;

    await syncEmbeddedWalletPxeIfAvailable(wallet);

    return buildWalletSession(
      "managed",
      options.alias,
      wallet,
      async () => {
        await wallet.stop();
      },
      activeAccount.address,
      {
        accountFlavor: "schnorr",
        deploymentStatus: "deployed",
        sessionOrigin: "bootstrapped",
        storageMode: readStorageMode(storageIsEphemeral),
        feePayer: orchestratorAccount.address,
        recoveryAddress: recoveryAccount.address,
      },
    );
  }

  const existingAccounts = toWalletAccounts(await wallet.getAccounts());
  if (!storageIsEphemeral) {
    const reusableAccount = pickReusableManagedAccount(existingAccounts, options.alias);
    if (reusableAccount) {
      const restoredManager = await restoreEmbeddedAccountManager(wallet, reusableAccount.address, reusableAccount.alias);
      let deployment: AccountDeploymentResult = { isReady: false };
      if (restoredManager) {
        await ensureAccountManagerRegistered(wallet, restoredManager);
        deployment = await ensureAccountManagerDeployed(
          wallet,
          restoredManager,
          options.deployWithLocalTestAccount ? { localTestAccountIndex: options.localTestAccountIndex } : undefined,
        );
      } else {
        await syncEmbeddedWalletPxeIfAvailable(wallet);
      }
      const restoredAccounts = filterWalletAccounts(
        toWalletAccounts(await wallet.getAccounts()),
        deployment.feePayerAddress ? [deployment.feePayerAddress] : [],
      );
      return buildWalletSession(
        "managed",
        options.alias,
        wallet,
        async () => {
          await wallet.stop();
        },
        reusableAccount.address,
        {
          accountFlavor: options.flavor,
          deploymentStatus: deployment.isReady ? "deployed" : "counterfactual",
          sessionOrigin: "reused",
          storageMode: readStorageMode(storageIsEphemeral),
          feePayer: deployment.feePayerAddress ?? "not-configured",
        },
        restoredAccounts,
      );
    }
  }

  const accountManager = await createManagedAccount(wallet, options.flavor, options.alias);
  await ensureAccountManagerRegistered(wallet, accountManager);
  const deployment = await ensureAccountManagerDeployed(
    wallet,
    accountManager,
    options.deployWithLocalTestAccount ? { localTestAccountIndex: options.localTestAccountIndex } : undefined,
  );

  return buildWalletSession(
    "managed",
    options.alias,
    wallet,
    async () => {
      await wallet.stop();
    },
    accountManager.address.toString(),
    {
      accountFlavor: options.flavor,
      deploymentStatus: deployment.isReady ? "deployed" : "counterfactual",
      sessionOrigin: "new",
      storageMode: readStorageMode(storageIsEphemeral),
      feePayer: deployment.feePayerAddress ?? "not-configured",
    },
    filterWalletAccounts(
      toWalletAccounts(await wallet.getAccounts()),
      deployment.feePayerAddress ? [deployment.feePayerAddress] : [],
    ),
  );
}

export async function createPasskeyWalletSession(options: PasskeyWalletOptions): Promise<WalletSession> {
  const wallet = await createEmbeddedWallet(options.nodeUrl, false);
  const existingAccounts = toWalletAccounts(await wallet.getAccounts());
  const material = await derivePasskeyAccountMaterial(options.credentialId);
  const accountManager = await wallet.createECDSARAccount(
    material.secret,
    material.salt,
    Buffer.from(material.signingKey),
    options.alias,
  );
  await ensureAccountManagerRegistered(wallet, accountManager);
  const deployment = await ensureAccountManagerDeployed(
    wallet,
    accountManager,
    options.deployWithLocalTestAccount ? { localTestAccountIndex: options.localTestAccountIndex } : undefined,
  );

  return buildWalletSession(
    "passkey",
    `Passkey ${options.alias}`,
    wallet,
    async () => {
      await wallet.stop();
    },
    accountManager.address.toString(),
    {
      accountFlavor: "secp256r1",
      deploymentStatus: deployment.isReady ? "deployed" : "counterfactual",
      sessionOrigin: existingAccounts.some(account => account.address === accountManager.address.toString()) ? "reused" : "new",
      storageMode: "persistent",
      walletAuth: "passkey-derived",
      credentialId: options.credentialId,
      feePayer: deployment.feePayerAddress ?? "not-configured",
    },
    filterWalletAccounts(
      toWalletAccounts(await wallet.getAccounts()),
      deployment.feePayerAddress ? [deployment.feePayerAddress] : [],
    ),
  );
}

function fieldFromHexString(value: string, label: string): Fr {
  try {
    return Fr.fromHexString(value.startsWith("0x") ? value : `0x${value}`);
  } catch {
    throw new Error(`${label} must be a valid field-compatible hex string.`);
  }
}

async function prepareGhostAccountOnWallet(
  wallet: EmbeddedWallet,
  options: GhostAccountLifecycleOptions,
): Promise<GhostAccountLifecycleResult> {
  const uniqueIdentifier = options.uniqueIdentifier.trim();
  if (!uniqueIdentifier) {
    throw new Error("Scoped unique identifier is required to derive the ghost account.");
  }
  const derivationVersion = options.derivationVersion ?? SCOPED_GHOST_DERIVATION_VERSION;
  const ghostMaterial = deriveGhostKeyMaterial({
    uniqueIdentifier,
    credentialType: options.credentialType,
    derivationVersion,
  });
  const derivedAddress = await getSchnorrAccountContractAddress(
    fieldFromHexString(ghostMaterial.secretHex, "Ghost secret"),
    fieldFromHexString(ghostMaterial.saltHex, "Ghost salt"),
  );
  const ghostAddress = derivedAddress.toString();
  if (options.deploymentFromAddress?.trim()) {
    await wallet.registerSender(AztecAddress.fromString(options.deploymentFromAddress.trim()), "magna-ghost-fee-payer");
  }
  const alias = options.alias?.trim() || `magna-ghost-${options.credentialType}`;
  const ghostManager = await wallet.createSchnorrAccount(
    fieldFromHexString(ghostMaterial.secretHex, "Ghost secret"),
    fieldFromHexString(ghostMaterial.saltHex, "Ghost salt"),
    undefined,
    alias,
  );
  if (ghostManager.address.toString() !== ghostAddress) {
    throw new Error(
      `Ghost account derivation mismatch. expected=${ghostAddress} actual=${ghostManager.address.toString()}`,
    );
  }
  await ensureAccountManagerRegistered(wallet, ghostManager);
  const funding: DeploymentFundingOptions | undefined = options.deploymentFromAddress?.trim()
    ? { fromAddress: options.deploymentFromAddress.trim() }
    : options.deployWithLocalTestAccount
      ? { localTestAccountIndex: options.localTestAccountIndex ?? 0 }
      : undefined;
  const deployment = await ensureAccountManagerDeployed(wallet, ghostManager, funding);

  return {
    address: ghostAddress,
    derivationVersion,
    scope: ghostMaterial.scope,
    deploymentStatus: deployment.isReady ? "deployed" : "counterfactual",
    localState: "derived-each-time",
    feePayer: deployment.feePayerAddress ?? funding?.fromAddress ?? "not-configured",
  };
}

export async function ensureGhostAccountLifecycle(
  options: GhostAccountLifecycleOptions,
): Promise<GhostAccountLifecycleResult> {
  const wallet = await createEmbeddedWallet(options.nodeUrl, true);
  try {
    return await prepareGhostAccountOnWallet(wallet, options);
  } finally {
    await wallet.stop();
  }
}

export async function createTransientGhostWalletSession(
  options: GhostAccountLifecycleOptions,
): Promise<TransientGhostWalletSession> {
  const wallet = await createEmbeddedWallet(options.nodeUrl, true);
  const lifecycle = await prepareGhostAccountOnWallet(wallet, options);
  let disposed = false;
  return {
    wallet,
    ghostAddress: lifecycle.address,
    derivationVersion: lifecycle.derivationVersion,
    scope: lifecycle.scope,
    deploymentStatus: lifecycle.deploymentStatus,
    localState: lifecycle.localState,
    feePayer: lifecycle.feePayer,
    dispose: async () => {
      if (disposed) {
        return;
      }
      disposed = true;
      await wallet.stop();
    },
  };
}

export type { WalletProvider };
