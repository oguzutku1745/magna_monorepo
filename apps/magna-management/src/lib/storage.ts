import type { GhostDerivationVersion } from "@magna/wallet";

export type CredentialKind = "passport" | "instagram";
export type CredentialStatus = "active" | "pending_attestation" | "recovery_pending" | "unknown";

export type StoredCredentialRef = {
  id: string;
  ownerAddress: string;
  kind: CredentialKind;
  status: CredentialStatus;
  claimsHash: string;
  createdAt: string;
  updatedAt?: string;
  issuanceTxHash?: string;
  renewalTxHash?: string;
  mode?: "passport" | "rooted";
  rootCommitment?: string;
  ghostOwner?: string;
  ghostDerivationVersion?: GhostDerivationVersion;
  normalizedClaims?: {
    nationalityAlpha3: string;
    minAgeProven: number;
    passportExpiryDate: string;
    expiryTs: string;
  };
  instagramHandle?: string;
  handleHash?: string;
};

export type WalletProfile = {
  address: string;
  walletKind: string;
  createdAt: string;
  publicKey?: string;
  rpId?: string;
  origin?: string;
  deploymentStatus?: "deployed" | "counterfactual" | string;
  sessionOrigin?: "new" | "reused" | "recovered" | string;
  feePayer?: string;
  lastOpenedAt?: string;
};

const CREDENTIALS_KEY = "magna-management:credential-refs:v1";
const WALLET_PROFILE_KEY = "magna-management:wallet-profile:v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadCredentialRefs(): StoredCredentialRef[] {
  return safeParse<StoredCredentialRef[]>(window.localStorage.getItem(CREDENTIALS_KEY), []);
}

export function saveCredentialRefs(refs: StoredCredentialRef[]): void {
  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(refs));
}

export function upsertCredentialRef(ref: StoredCredentialRef): StoredCredentialRef[] {
  const refs = loadCredentialRefs();
  const index = refs.findIndex(existing => existing.id === ref.id);
  const next = index >= 0 ? refs.map(existing => (existing.id === ref.id ? ref : existing)) : [ref, ...refs];
  saveCredentialRefs(next);
  return next;
}

export function refsForOwner(ownerAddress?: string): StoredCredentialRef[] {
  if (!ownerAddress) return [];
  return loadCredentialRefs().filter(ref => ref.ownerAddress === ownerAddress);
}

export function saveWalletProfile(profile: WalletProfile): void {
  window.localStorage.setItem(WALLET_PROFILE_KEY, JSON.stringify(profile));
}

export function loadWalletProfile(): WalletProfile | null {
  return safeParse<WalletProfile | null>(window.localStorage.getItem(WALLET_PROFILE_KEY), null);
}
