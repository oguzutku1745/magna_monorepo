import { AccountManager } from "@aztec/aztec.js/wallet";
import type { Account } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { clearEmbeddedPxeCacheForNode, isAztecWorldStateAnchorError } from "../browser/pxe-cache.js";
import { bytesToHex, hexToBytes } from "@magna/core";
import { MagnaWebAuthnAccountContract } from "../webauthn/account-contract.js";
import {
  computeWebAuthnRpIdHash,
  discoverWebAuthnAccountPrf,
  evaluateWebAuthnAccountPrf,
  makeBrowserAsserter,
  registerWebAuthnCredential,
  type WebAuthnDiscoveredPrfOutputs,
  type WebAuthnPrfOutputs,
  type WebAuthnRegistration,
} from "../webauthn/ceremony.js";
import {
  buildWalletSession,
  createEmbeddedWallet,
  ensureAccountManagerDeployed,
  ensureAccountManagerRegistered,
  type EmbeddedWalletWithInternals,
  type WalletSession,
} from "./lifecycle.js";

export type StoredWebAuthnAccount = {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpIdHash: string;
  rpId: string;
  origin: string;
  address: string;
  walletMaterialSource: "webauthn-prf";
};

export type WebAuthnPublicKeyRecoveryBundle = {
  kind: "magna-webauthn-public-key";
  version: 1;
  publicKeyX: string;
  publicKeyY: string;
  rpId?: string;
  origin?: string;
  address?: string;
};

export type WebAuthnWalletSessionOptions = {
  nodeUrl: string;
  userName: string;
  rpId: string;
  alias: string;
  forceCreate?: boolean;
  publicKeyRecoveryBundle?: string;
  storage?: Storage;
  localTestAccountIndex?: number;
  deployWithLocalTestAccount?: boolean;
};

const STORAGE_KEY = "magna-webauthn-accounts-v1";
const WEB_AUTHN_ACCOUNT_RESOLVERS_KEY = Symbol.for("magna.webauthn.accountResolvers");

type WebAuthnAccountResolverMap = Map<string, () => Promise<Account>>;
type EmbeddedWalletWithWebAuthnResolvers = EmbeddedWalletWithInternals & {
  [WEB_AUTHN_ACCOUNT_RESOLVERS_KEY]?: WebAuthnAccountResolverMap;
};

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function loadStoredWebAuthnAccounts(storage: Storage): StoredWebAuthnAccount[] {
  const raw = storage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredWebAuthnAccount[]) : [];
}

export function saveStoredWebAuthnAccount(storage: Storage, account: StoredWebAuthnAccount): void {
  const all = loadStoredWebAuthnAccounts(storage).filter(
    a => a.credentialId !== account.credentialId && (a.rpId !== account.rpId || a.origin !== account.origin),
  );
  all.push(account);
  storage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function serializeWebAuthnPublicKeyRecoveryBundle(account: StoredWebAuthnAccount): string {
  return `04${account.publicKeyX}${account.publicKeyY}`;
}

export function parseWebAuthnPublicKeyRecoveryBundle(input: string): WebAuthnPublicKeyRecoveryBundle {
  const trimmed = input.trim();
  const publicKey = parseUncompressedPublicKeyHex(trimmed);
  if (publicKey) {
    return {
      kind: "magna-webauthn-public-key",
      version: 1,
      publicKeyX: publicKey.publicKeyX,
      publicKeyY: publicKey.publicKeyY,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Public key must be uncompressed P-256 hex (04 + x + y) or a valid Magna public key JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Public key JSON must be an object");
  }
  const value = parsed as Partial<WebAuthnPublicKeyRecoveryBundle> & {
    x?: unknown;
    y?: unknown;
    publicKey?: unknown;
  };
  if (value.kind !== undefined && value.kind !== "magna-webauthn-public-key") {
    throw new Error("Public key JSON has an unsupported kind");
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error("Public key JSON has an unsupported version");
  }

  if (typeof value.publicKey === "string") {
    const parsedPublicKey = parseUncompressedPublicKeyHex(value.publicKey);
    if (!parsedPublicKey) {
      throw new Error("publicKey must be uncompressed P-256 hex (04 + x + y)");
    }
    return {
      kind: "magna-webauthn-public-key",
      version: 1,
      ...parsedPublicKey,
      rpId: typeof value.rpId === "string" ? value.rpId : undefined,
      origin: typeof value.origin === "string" ? value.origin : undefined,
      address: typeof value.address === "string" ? value.address : undefined,
    };
  }

  const publicKeyX = normalizeHex32(value.publicKeyX ?? value.x, "publicKeyX");
  const publicKeyY = normalizeHex32(value.publicKeyY ?? value.y, "publicKeyY");
  if (value.rpId !== undefined && typeof value.rpId !== "string") {
    throw new Error("Public key JSON rpId must be a string when present");
  }
  if (value.origin !== undefined && typeof value.origin !== "string") {
    throw new Error("Public key JSON origin must be a string when present");
  }
  if (value.address !== undefined && typeof value.address !== "string") {
    throw new Error("Public key JSON address must be a string when present");
  }
  return {
    kind: "magna-webauthn-public-key",
    version: 1,
    publicKeyX,
    publicKeyY,
    rpId: value.rpId,
    origin: value.origin,
    address: value.address,
  };
}

/**
 * Registers a fresh passkey for a new MagnaWebAuthnAccount. The protocol
 * secret and salt come from WebAuthn PRF so synced passkeys can recreate the
 * same Aztec account material without persisting raw material locally.
 */
export async function createWebAuthnAccountMaterial(
  userName: string,
  rpId: string,
): Promise<{ registration: WebAuthnRegistration; secret: Fr; salt: Fr }> {
  const registration = await registerWebAuthnCredential(userName, rpId);
  const material = await deriveWebAuthnAccountMaterial(registration);
  return { registration, ...material };
}

export async function deriveWebAuthnAccountMaterial(registration: WebAuthnRegistration): Promise<{
  secret: Fr;
  salt: Fr;
}> {
  return webAuthnPrfOutputsToAccountMaterial(await evaluateWebAuthnAccountPrf(registration));
}

export function webAuthnPrfOutputsToAccountMaterial(outputs: WebAuthnPrfOutputs): {
  secret: Fr;
  salt: Fr;
} {
  return {
    secret: Fr.fromBufferReduce(Buffer.from(outputs.secret)),
    salt: Fr.fromBufferReduce(Buffer.from(outputs.salt)),
  };
}

function normalizeHex32(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a hex string`);
  }
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`${label} must be exactly 32 bytes of hex`);
  }
  return normalized.toLowerCase();
}

function parseUncompressedPublicKeyHex(value: string): { publicKeyX: string; publicKeyY: string } | null {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{130}$/.test(normalized) || normalized.slice(0, 2) !== "04") {
    return null;
  }
  return {
    publicKeyX: normalized.slice(2, 66).toLowerCase(),
    publicKeyY: normalized.slice(66, 130).toLowerCase(),
  };
}

/** Account contract adapter for registration or session restore. */
export function webAuthnAccountContract(registration: WebAuthnRegistration): MagnaWebAuthnAccountContract {
  return new MagnaWebAuthnAccountContract(registration, makeBrowserAsserter(registration));
}

function storageForOptions(storage?: Storage): Storage {
  const resolved = storage ?? globalThis.localStorage;
  if (!resolved) {
    throw new Error("WebAuthn account storage is unavailable");
  }
  return resolved;
}

function registrationFromStored(account: StoredWebAuthnAccount): WebAuthnRegistration {
  return {
    credentialId: base64urlDecode(account.credentialId),
    publicKey: {
      x: hexToBytes(account.publicKeyX),
      y: hexToBytes(account.publicKeyY),
    },
    rpId: account.rpId,
    rpIdHash: hexToBytes(account.rpIdHash),
    origin: account.origin,
  };
}

function registrationFromPublicKeyRecovery(
  bundle: WebAuthnPublicKeyRecoveryBundle,
  discovered: WebAuthnDiscoveredPrfOutputs,
  rpIdHash: Uint8Array,
  rpId: string,
  origin: string,
): WebAuthnRegistration {
  return {
    credentialId: discovered.credentialId,
    publicKey: {
      x: hexToBytes(bundle.publicKeyX),
      y: hexToBytes(bundle.publicKeyY),
    },
    rpId,
    rpIdHash,
    origin,
  };
}

export function storedWebAuthnAccountFromRegistration(
  registration: WebAuthnRegistration,
  address: string,
): StoredWebAuthnAccount {
  return {
    credentialId: base64urlEncode(registration.credentialId),
    publicKeyX: bytesToHex(registration.publicKey.x),
    publicKeyY: bytesToHex(registration.publicKey.y),
    rpIdHash: bytesToHex(registration.rpIdHash),
    rpId: registration.rpId,
    origin: registration.origin,
    address,
    walletMaterialSource: "webauthn-prf",
  };
}

async function installWebAuthnAccountResolverOnEmbeddedWallet(
  wallet: EmbeddedWalletWithInternals,
  accountManager: AccountManager,
): Promise<void> {
  const walletWithResolvers = wallet as EmbeddedWalletWithWebAuthnResolvers;
  if (!walletWithResolvers[WEB_AUTHN_ACCOUNT_RESOLVERS_KEY]) {
    walletWithResolvers[WEB_AUTHN_ACCOUNT_RESOLVERS_KEY] = new Map();
    const originalGetAccountFromAddress = wallet.getAccountFromAddress?.bind(wallet);
    wallet.getAccountFromAddress = async address => {
      const resolver = walletWithResolvers[WEB_AUTHN_ACCOUNT_RESOLVERS_KEY]?.get(address.toString());
      if (resolver) {
        return resolver();
      }
      if (!originalGetAccountFromAddress) {
        throw new Error(`Account not found in wallet for address: ${address.toString()}`);
      }
      return originalGetAccountFromAddress(address);
    };
  }
  walletWithResolvers[WEB_AUTHN_ACCOUNT_RESOLVERS_KEY]!.set(accountManager.address.toString(), () =>
    accountManager.getAccount(),
  );
}

async function persistWebAuthnAccountOnEmbeddedWallet(
  wallet: EmbeddedWalletWithInternals,
  accountManager: AccountManager,
  alias: string,
): Promise<void> {
  if (!wallet.walletDB?.storeAccount) {
    throw new Error("Embedded wallet does not expose account storage for WebAuthn passkey accounts.");
  }
  await wallet.walletDB.storeAccount(accountManager.address, {
    type: "ecdsasecp256r1",
    secretKey: accountManager.getSecretKey(),
    salt: Fr.ZERO,
    signingKey: accountManager.getSecretKey().toBuffer(),
    alias,
  });
}

async function deleteWebAuthnAccountFromEmbeddedWallet(
  wallet: EmbeddedWalletWithInternals,
  accountManager: AccountManager,
): Promise<void> {
  await wallet.walletDB?.deleteAccount?.(accountManager.address);
}

export async function createWebAuthnWalletSession(options: WebAuthnWalletSessionOptions): Promise<WalletSession> {
  try {
    return await createWebAuthnWalletSessionOnce(options);
  } catch (error) {
    if (!isAztecWorldStateAnchorError(error)) {
      throw error;
    }
    await clearEmbeddedPxeCacheForNode(options.nodeUrl);
    return await createWebAuthnWalletSessionOnce(options);
  }
}

async function createWebAuthnWalletSessionOnce(options: WebAuthnWalletSessionOptions): Promise<WalletSession> {
  const storage = storageForOptions(options.storage);
  const wallet = await createEmbeddedWallet(options.nodeUrl, false);
  try {
    const recoveryBundle = options.publicKeyRecoveryBundle
      ? parseWebAuthnPublicKeyRecoveryBundle(options.publicKeyRecoveryBundle)
      : null;
    const stored = options.forceCreate || recoveryBundle
      ? undefined
      : loadStoredWebAuthnAccounts(storage).find(
          account => account.rpId === options.rpId && account.origin === globalThis.location?.origin,
        );
    let registration: WebAuthnRegistration;
    let secret: Fr;
    let salt: Fr;
    let sessionOrigin: "new" | "reused" | "recovered";
    if (stored) {
      if (stored.walletMaterialSource !== "webauthn-prf") {
        throw new Error("Stored WebAuthn account uses legacy local wallet material. Clear it and create a PRF-backed passkey wallet.");
      }
      registration = registrationFromStored(stored);
      const material = await deriveWebAuthnAccountMaterial(registration);
      secret = material.secret;
      salt = material.salt;
      sessionOrigin = "reused";
    } else if (recoveryBundle) {
      const currentOrigin = globalThis.location?.origin;
      if (recoveryBundle.rpId && recoveryBundle.rpId !== options.rpId) {
        throw new Error(`Public key recovery bundle is for rpId ${recoveryBundle.rpId}, not ${options.rpId}`);
      }
      if (currentOrigin && recoveryBundle.origin && recoveryBundle.origin !== currentOrigin) {
        throw new Error(`Public key recovery bundle is for origin ${recoveryBundle.origin}, not ${currentOrigin}`);
      }
      const origin = recoveryBundle.origin ?? currentOrigin;
      if (!origin) {
        throw new Error("Cannot recover WebAuthn account without a wallet origin");
      }
      const discovered = await discoverWebAuthnAccountPrf(options.rpId);
      const material = webAuthnPrfOutputsToAccountMaterial(discovered);
      registration = registrationFromPublicKeyRecovery(
        recoveryBundle,
        discovered,
        await computeWebAuthnRpIdHash(options.rpId),
        options.rpId,
        origin,
      );
      secret = material.secret;
      salt = material.salt;
      sessionOrigin = "recovered";
    } else {
      const material = await createWebAuthnAccountMaterial(options.userName, options.rpId);
      registration = material.registration;
      secret = material.secret;
      salt = material.salt;
      sessionOrigin = "new";
    }

    const accountManager = await AccountManager.create(wallet, secret, webAuthnAccountContract(registration), { salt });
    const address = accountManager.address.toString();
    if (recoveryBundle?.address && recoveryBundle.address !== address) {
      throw new Error(`Recovered WebAuthn account address mismatch. expected=${recoveryBundle.address} derived=${address}`);
    }
    const storedAccount = stored ?? storedWebAuthnAccountFromRegistration(registration, address);
    if (!stored) {
      saveStoredWebAuthnAccount(storage, storedAccount);
    }
    const embeddedWallet = wallet as EmbeddedWalletWithInternals;
    await installWebAuthnAccountResolverOnEmbeddedWallet(embeddedWallet, accountManager);
    await deleteWebAuthnAccountFromEmbeddedWallet(embeddedWallet, accountManager);
    await ensureAccountManagerRegistered(wallet, accountManager);
    const deployment = await ensureAccountManagerDeployed(
      wallet,
      accountManager,
      options.deployWithLocalTestAccount ? { localTestAccountIndex: options.localTestAccountIndex ?? 0 } : undefined,
    );
    await persistWebAuthnAccountOnEmbeddedWallet(embeddedWallet, accountManager, `WebAuthn ${options.alias}`);

    return buildWalletSession(
      "passkey",
      `WebAuthn ${options.alias}`,
      wallet,
      async () => {
        await wallet.stop();
      },
      address,
      {
        accountFlavor: "secp256r1",
        deploymentStatus: deployment.isReady ? "deployed" : "counterfactual",
        sessionOrigin,
        storageMode: "persistent",
        walletAuth: "webauthn",
        credentialId: base64urlEncode(registration.credentialId),
        publicKeyRecoveryBundle: serializeWebAuthnPublicKeyRecoveryBundle(storedAccount),
        feePayer: deployment.feePayerAddress ?? "not-configured",
      },
    );
  } catch (error) {
    try {
      await wallet.stop();
    } catch {
      // Preserve the original wallet-creation failure.
    }
    throw error;
  }
}
