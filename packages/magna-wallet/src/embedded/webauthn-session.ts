import { AccountManager } from "@aztec/aztec.js/wallet";
import { Fr } from "@aztec/aztec.js/fields";
import { bytesToHex, hexToBytes } from "@magna/core";
import { MagnaWebAuthnAccountContract } from "../webauthn/account-contract.js";
import {
  makeBrowserAsserter,
  registerWebAuthnCredential,
  type WebAuthnRegistration,
} from "../webauthn/ceremony.js";
import {
  buildWalletSession,
  createEmbeddedWallet,
  ensureAccountManagerDeployed,
  ensureAccountManagerRegistered,
  type WalletSession,
} from "./lifecycle.js";

export type StoredWebAuthnAccount = {
  credentialId: string;
  publicKeyX: string;
  publicKeyY: string;
  rpIdHash: string;
  rpId: string;
  origin: string;
  secretKey: string;
  salt: string;
  address: string;
};

export type WebAuthnWalletSessionOptions = {
  nodeUrl: string;
  userName: string;
  rpId: string;
  alias: string;
  storage?: Storage;
  localTestAccountIndex?: number;
  deployWithLocalTestAccount?: boolean;
};

const STORAGE_KEY = "magna-webauthn-accounts-v1";

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
  const all = loadStoredWebAuthnAccounts(storage).filter(a => a.credentialId !== account.credentialId);
  all.push(account);
  storage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/**
 * Registers a fresh passkey for a new MagnaWebAuthnAccount. The protocol
 * secret and salt are RANDOM (never derived from the credential ID) and
 * persist only under the wallet origin.
 */
export async function createWebAuthnAccountMaterial(
  userName: string,
  rpId: string,
): Promise<{ registration: WebAuthnRegistration; secret: Fr; salt: Fr }> {
  const registration = await registerWebAuthnCredential(userName, rpId);
  return { registration, secret: Fr.random(), salt: Fr.random() };
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

function frToHex(value: Fr): string {
  return bytesToHex(new Uint8Array(value.toBuffer()));
}

function frFromHex(value: string): Fr {
  return Fr.fromHexString(`0x${value}`);
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

function storedFromRegistration(
  registration: WebAuthnRegistration,
  secret: Fr,
  salt: Fr,
  address: string,
): StoredWebAuthnAccount {
  return {
    credentialId: base64urlEncode(registration.credentialId),
    publicKeyX: bytesToHex(registration.publicKey.x),
    publicKeyY: bytesToHex(registration.publicKey.y),
    rpIdHash: bytesToHex(registration.rpIdHash),
    rpId: registration.rpId,
    origin: registration.origin,
    secretKey: frToHex(secret),
    salt: frToHex(salt),
    address,
  };
}

export async function createWebAuthnWalletSession(options: WebAuthnWalletSessionOptions): Promise<WalletSession> {
  const storage = storageForOptions(options.storage);
  const wallet = await createEmbeddedWallet(options.nodeUrl, false);
  const stored = loadStoredWebAuthnAccounts(storage).find(
    account => account.rpId === options.rpId && account.origin === globalThis.location?.origin,
  );
  let registration: WebAuthnRegistration;
  let secret: Fr;
  let salt: Fr;
  if (stored) {
    registration = registrationFromStored(stored);
    secret = frFromHex(stored.secretKey);
    salt = frFromHex(stored.salt);
  } else {
    const material = await createWebAuthnAccountMaterial(options.userName, options.rpId);
    registration = material.registration;
    secret = material.secret;
    salt = material.salt;
  }

  const accountManager = await AccountManager.create(wallet, secret, webAuthnAccountContract(registration), salt);
  await ensureAccountManagerRegistered(wallet, accountManager);
  const deployment = await ensureAccountManagerDeployed(
    wallet,
    accountManager,
    options.deployWithLocalTestAccount ? { localTestAccountIndex: options.localTestAccountIndex ?? 0 } : undefined,
  );
  const address = accountManager.address.toString();
  if (!stored) {
    saveStoredWebAuthnAccount(storage, storedFromRegistration(registration, secret, salt, address));
  }

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
      sessionOrigin: stored ? "reused" : "new",
      storageMode: "persistent",
      walletAuth: "webauthn",
      credentialId: base64urlEncode(registration.credentialId),
      feePayer: deployment.feePayerAddress ?? "not-configured",
    },
  );
}
