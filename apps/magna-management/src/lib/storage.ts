import type { GhostDerivationVersion } from "@magna/wallet";

export type CredentialKind = "passport" | "instagram";
export type CredentialStatus = "active" | "pending_attestation" | "recovery_pending" | "unknown";
export type CredentialIssuanceKind = "legacy" | "pilot" | "a1";

export type PassportCommittedClaimsV2LocalWitness = {
  schema: "passport-committed-claims-v2";
  credentialAuthenticity: "passport-a1";
  minAgeProven: number;
  nationalityAlpha3Packed: string;
  nationalityBlind: string;
  expiryTs: string;
  expiryBlind: string;
};

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
  issuerAddress?: string;
  orchestratorAddress?: string;
  mode?: "passport" | "rooted";
  issuanceKind?: CredentialIssuanceKind;
  rootCommitment?: string;
  ghostOwner?: string;
  ghostDerivationVersion?: GhostDerivationVersion;
  passportCommittedClaimsV2Witness?: PassportCommittedClaimsV2LocalWitness;
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
  role?: "user" | "company";
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

export type CredentialRefFilter = {
  issuerAddress?: string;
};

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

function normalizeScopeValue(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function credentialStorageKey(ref: StoredCredentialRef): string {
  return [
    normalizeScopeValue(ref.issuerAddress),
    normalizeScopeValue(ref.ownerAddress),
    ref.kind,
    ref.mode ?? "",
    ref.claimsHash,
    ref.rootCommitment ?? "",
  ].join(":");
}

export function upsertCredentialRef(ref: StoredCredentialRef): StoredCredentialRef[] {
  const refs = loadCredentialRefs();
  const key = credentialStorageKey(ref);
  const index = refs.findIndex(existing => credentialStorageKey(existing) === key);
  const next = index >= 0 ? refs.map(existing => (credentialStorageKey(existing) === key ? ref : existing)) : [ref, ...refs];
  saveCredentialRefs(next);
  return next;
}

export function refsForOwner(ownerAddress?: string, filter: CredentialRefFilter = {}): StoredCredentialRef[] {
  if (!ownerAddress) return [];
  const expectedIssuer = normalizeScopeValue(filter.issuerAddress);
  return loadCredentialRefs().filter(ref => {
    if (ref.ownerAddress !== ownerAddress) return false;
    if (!expectedIssuer) return true;
    return normalizeScopeValue(ref.issuerAddress) === expectedIssuer;
  });
}

export function saveWalletProfile(profile: WalletProfile): void {
  window.localStorage.setItem(WALLET_PROFILE_KEY, JSON.stringify(profile));
}

export function loadWalletProfile(): WalletProfile | null {
  return safeParse<WalletProfile | null>(window.localStorage.getItem(WALLET_PROFILE_KEY), null);
}
