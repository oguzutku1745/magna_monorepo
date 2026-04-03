import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import type { AccountManager } from "@aztec/aztec.js/wallet";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { Fr } from "@aztec/aztec.js/fields";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import { hashToEmoji } from "@aztec/wallet-sdk/crypto";
import { WalletManager, type PendingConnection, type WalletProvider } from "@aztec/wallet-sdk/manager";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { Buffer } from "buffer";
import { getChainInfo, stringifyAddress, toAddress } from "./aztec";

export type WalletSessionKind = "external" | "managed";
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
};

export type ManagedWalletOptions = {
  nodeUrl: string;
  alias: string;
  flavor: ManagedAccountFlavor;
  localTestAccountIndex: number;
  bootstrapWithLocalTestAccount: boolean;
};

function toWalletAccounts(accounts: Awaited<ReturnType<Wallet["getAccounts"]>>): WalletAccount[] {
  return accounts.map(account => ({
    alias: account.alias,
    address: stringifyAddress(account.item),
  }));
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
): Promise<WalletSession> {
  const accounts = toWalletAccounts(await wallet.getAccounts());
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

export async function ensureImportedLocalTestAccount(wallet: EmbeddedWallet, index: number): Promise<WalletAccount> {
  const initialAccounts = await getInitialTestAccountsData();
  const accountData = initialAccounts[index];
  if (!accountData) {
    throw new Error(`Local test account index ${index} is not available.`);
  }

  const currentAccounts = toWalletAccounts(await wallet.getAccounts());
  const existing = currentAccounts.find(account => account.address === accountData.address.toString());
  if (existing) {
    return existing;
  }

  const alias = `local-test-${index}`;
  await wallet.createSchnorrAccount(accountData.secret, accountData.salt, accountData.signingKey, alias);
  const updatedAccounts = toWalletAccounts(await wallet.getAccounts());
  return (
    updatedAccounts.find(account => account.address === accountData.address.toString()) ??
    {
      alias,
      address: accountData.address.toString(),
    }
  );
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
  timeoutMs: number = 15_000,
): Promise<WalletProvider[]> {
  const chainInfo = await getChainInfo(nodeUrl);
  const discovered: WalletProvider[] = [];
  const seen = new Set<string>();
  const discovery = WalletManager.configure({ extensions: { enabled: true } }).getAvailableWallets({
    chainInfo,
    appId,
    timeout: timeoutMs,
    onWalletDiscovered: provider => {
      if (seen.has(provider.id)) {
        return;
      }
      seen.add(provider.id);
      discovered.push(provider);
    },
  });
  await discovery.done;
  return discovered;
}

export async function beginExternalWalletConnection(
  provider: WalletProvider,
  appId: string,
): Promise<PendingExternalWalletConnection> {
  const pending = await provider.establishSecureChannel(appId);
  return {
    provider,
    pending,
    emojiGrid: hashToEmoji(pending.verificationHash),
  };
}

export async function confirmExternalWalletConnection(
  connection: PendingExternalWalletConnection,
): Promise<WalletSession> {
  const wallet = await connection.pending.confirm();
  return buildWalletSession("external", connection.provider.name, wallet, () => connection.provider.disconnect());
}

export async function createManagedWalletSession(
  options: ManagedWalletOptions,
): Promise<WalletSession> {
  const wallet = await EmbeddedWallet.create(options.nodeUrl, { ephemeral: false });
  const feePayer = options.bootstrapWithLocalTestAccount
    ? await ensureImportedLocalTestAccount(wallet, options.localTestAccountIndex)
    : undefined;

  const accountManager = await createManagedAccount(wallet, options.flavor, options.alias);
  let deploymentStatus = "counterfactual";

  if (feePayer) {
    const deployMethod = await accountManager.getDeployMethod();
    await deployMethod.send({
      from: toAddress(feePayer.address),
    });
    deploymentStatus = "deployed";
  }

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
      deploymentStatus,
      feePayer: feePayer?.address ?? "not-configured",
    },
  );
}
