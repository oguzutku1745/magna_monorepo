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
const CHAIN_FINGERPRINT_KEY = "magna-management:chain-fingerprint:v1";
const PASSPORT_A1_WITNESSES_KEY = "magna-management:passport-a1-witnesses:v1";

type StoredPassportA1WitnessRecord = {
  issuerAddress?: string;
  ownerAddress: string;
  mode?: "passport" | "rooted";
  rootCommitment?: string;
  claimsHash: string;
  witness: PassportCommittedClaimsV2LocalWitness;
};

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

function isPassportCommittedClaimsV2LocalWitness(value: unknown): value is PassportCommittedClaimsV2LocalWitness {
  const witness = value as Partial<PassportCommittedClaimsV2LocalWitness> | undefined;
  return Boolean(
    witness &&
      witness.schema === "passport-committed-claims-v2" &&
      witness.credentialAuthenticity === "passport-a1" &&
      typeof witness.minAgeProven === "number" &&
      typeof witness.nationalityAlpha3Packed === "string" &&
      typeof witness.nationalityBlind === "string" &&
      typeof witness.expiryTs === "string" &&
      typeof witness.expiryBlind === "string",
  );
}

function loadPassportA1WitnessRecords(): Record<string, StoredPassportA1WitnessRecord> {
  const parsed = safeParse<Record<string, StoredPassportA1WitnessRecord>>(
    window.localStorage.getItem(PASSPORT_A1_WITNESSES_KEY),
    {},
  );
  return Object.fromEntries(
    Object.entries(parsed).filter(([, record]) =>
      Boolean(
        record &&
          typeof record.ownerAddress === "string" &&
          typeof record.claimsHash === "string" &&
          isPassportCommittedClaimsV2LocalWitness(record.witness),
      ),
    ),
  );
}

function savePassportA1WitnessRecords(records: Record<string, StoredPassportA1WitnessRecord>): void {
  window.localStorage.setItem(PASSPORT_A1_WITNESSES_KEY, JSON.stringify(records));
}

export function passportA1WitnessStorageKey(
  ref: Pick<StoredCredentialRef, "ownerAddress" | "claimsHash"> &
    Partial<Pick<StoredCredentialRef, "issuerAddress" | "mode" | "rootCommitment">>,
): string {
  return [
    normalizeScopeValue(ref.issuerAddress),
    normalizeScopeValue(ref.ownerAddress),
    ref.mode ?? "",
    ref.rootCommitment ?? "",
    ref.claimsHash,
  ].join(":");
}

export function savePassportA1Witness(ref: StoredCredentialRef): void {
  if (ref.kind !== "passport" || !isPassportCommittedClaimsV2LocalWitness(ref.passportCommittedClaimsV2Witness)) {
    return;
  }
  const records = loadPassportA1WitnessRecords();
  records[passportA1WitnessStorageKey(ref)] = {
    issuerAddress: ref.issuerAddress,
    ownerAddress: ref.ownerAddress,
    mode: ref.mode,
    rootCommitment: ref.rootCommitment,
    claimsHash: ref.claimsHash,
    witness: ref.passportCommittedClaimsV2Witness,
  };
  savePassportA1WitnessRecords(records);
}

export function readPassportA1Witness(
  ref: Pick<StoredCredentialRef, "ownerAddress" | "claimsHash"> &
    Partial<Pick<StoredCredentialRef, "issuerAddress" | "mode" | "rootCommitment">>,
): PassportCommittedClaimsV2LocalWitness | undefined {
  return loadPassportA1WitnessRecords()[passportA1WitnessStorageKey(ref)]?.witness;
}

export function hydratePassportA1Witness(ref: StoredCredentialRef): StoredCredentialRef {
  if (ref.kind !== "passport" || ref.passportCommittedClaimsV2Witness) {
    return ref;
  }
  const witness = readPassportA1Witness(ref);
  if (!witness) {
    return ref;
  }
  return {
    ...ref,
    issuanceKind: ref.issuanceKind ?? "a1",
    passportCommittedClaimsV2Witness: witness,
  };
}

export function hydratePassportA1Witnesses(refs: StoredCredentialRef[]): StoredCredentialRef[] {
  return refs.map(hydratePassportA1Witness);
}

export function loadCredentialRefs(): StoredCredentialRef[] {
  return hydratePassportA1Witnesses(safeParse<StoredCredentialRef[]>(window.localStorage.getItem(CREDENTIALS_KEY), []));
}

export function saveCredentialRefs(refs: StoredCredentialRef[]): void {
  for (const ref of refs) {
    savePassportA1Witness(ref);
  }
  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(refs));
}

export function clearStoredWalletState(): void {
  window.localStorage.removeItem(CREDENTIALS_KEY);
  window.localStorage.removeItem(WALLET_PROFILE_KEY);
}

export function reconcileStoredChainFingerprint(nextFingerprint: string): boolean {
  const previousFingerprint = window.localStorage.getItem(CHAIN_FINGERPRINT_KEY);
  const changed = Boolean(previousFingerprint && previousFingerprint !== nextFingerprint);
  if (changed) {
    clearStoredWalletState();
  }
  window.localStorage.setItem(CHAIN_FINGERPRINT_KEY, nextFingerprint);
  return changed;
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
