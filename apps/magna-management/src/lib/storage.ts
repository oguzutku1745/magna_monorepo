import type { GhostDerivationVersion } from "@magna/wallet";

export type CredentialKind = "passport" | "instagram";
export type CredentialStatus = "active" | "pending_attestation" | "recovery_pending" | "unknown";
export type CredentialIssuanceKind = "a2";

export type PassportCommittedClaimsV2LocalWitness = {
  schema: "passport-committed-claims-v2";
  credentialAuthenticity: "passport-a2";
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
  recoveryTxHash?: string;
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
  handleBlind?: string;
};

export type WalletProfile = {
  address: string;
  label?: string;
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

export type PendingRecoveryV3Finalization = {
  version: 1;
  phase: "prepared" | "submitted";
  sourceCredentialId: string;
  target: WalletProfile;
  recoveredCredential: StoredCredentialRef;
  recoveryTxHash?: string;
  createdAt: string;
  updatedAt: string;
};

const CREDENTIALS_KEY = "magna-management:credential-refs:v1";
const WALLET_PROFILE_KEY = "magna-management:wallet-profile:v1";
const CHAIN_FINGERPRINT_KEY = "magna-management:chain-fingerprint:v1";
const PASSPORT_A2_WITNESSES_KEY = "magna-management:passport-a2-witnesses:v1";
const INSTAGRAM_V2_WITNESSES_KEY = "magna-management:instagram-v2-witnesses:v1";
const RECOVERY_V3_FINALIZATION_KEY = "magna-management:recovery-v3-finalization:v1";
const RECOVERY_TARGET_PROFILE_KEY = "magna-management:recovery-target-profile:v1";

type StoredPassportA2WitnessRecord = {
  issuerAddress?: string;
  ownerAddress: string;
  mode?: "passport" | "rooted";
  rootCommitment?: string;
  claimsHash: string;
  createdAt: string;
  issuanceKind?: CredentialIssuanceKind;
  ghostOwner?: string;
  ghostDerivationVersion?: GhostDerivationVersion;
  renewalTxHash?: string;
  recoveryTxHash?: string;
  normalizedClaims?: StoredCredentialRef["normalizedClaims"];
  witness: PassportCommittedClaimsV2LocalWitness;
};

type StoredInstagramV2WitnessRecord = {
  issuerAddress?: string;
  ownerAddress: string;
  claimsHash: string;
  createdAt: string;
  ghostOwner?: string;
  ghostDerivationVersion?: GhostDerivationVersion;
  instagramHandle: string;
  handleHash: string;
  handleBlind: string;
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
      witness.credentialAuthenticity === "passport-a2" &&
      typeof witness.minAgeProven === "number" &&
      typeof witness.nationalityAlpha3Packed === "string" &&
      typeof witness.nationalityBlind === "string" &&
      typeof witness.expiryTs === "string" &&
      typeof witness.expiryBlind === "string",
  );
}

function loadPassportA2WitnessRecords(): Record<string, StoredPassportA2WitnessRecord> {
  const parsed = safeParse<Record<string, StoredPassportA2WitnessRecord>>(
    window.localStorage.getItem(PASSPORT_A2_WITNESSES_KEY),
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

function savePassportA2WitnessRecords(records: Record<string, StoredPassportA2WitnessRecord>): void {
  window.localStorage.setItem(PASSPORT_A2_WITNESSES_KEY, JSON.stringify(records));
}

export function passportA2WitnessStorageKey(
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

export function savePassportA2Witness(ref: StoredCredentialRef): void {
  if (ref.kind !== "passport" || !isPassportCommittedClaimsV2LocalWitness(ref.passportCommittedClaimsV2Witness)) {
    return;
  }
  const records = loadPassportA2WitnessRecords();
  records[passportA2WitnessStorageKey(ref)] = {
    issuerAddress: ref.issuerAddress,
    ownerAddress: ref.ownerAddress,
    mode: ref.mode,
    rootCommitment: ref.rootCommitment,
    claimsHash: ref.claimsHash,
    createdAt: ref.createdAt,
    issuanceKind: ref.issuanceKind,
    ghostOwner: ref.ghostOwner,
    ghostDerivationVersion: ref.ghostDerivationVersion,
    renewalTxHash: ref.renewalTxHash,
    recoveryTxHash: ref.recoveryTxHash,
    normalizedClaims: ref.normalizedClaims,
    witness: ref.passportCommittedClaimsV2Witness,
  };
  savePassportA2WitnessRecords(records);
}

export function readPassportA2Witness(
  ref: Pick<StoredCredentialRef, "ownerAddress" | "claimsHash"> &
    Partial<Pick<StoredCredentialRef, "issuerAddress" | "mode" | "rootCommitment">>,
): PassportCommittedClaimsV2LocalWitness | undefined {
  return loadPassportA2WitnessRecords()[passportA2WitnessStorageKey(ref)]?.witness;
}

export function hydratePassportA2Witness(ref: StoredCredentialRef): StoredCredentialRef {
  if (ref.kind !== "passport" || ref.passportCommittedClaimsV2Witness) {
    return ref;
  }
  const record = loadPassportA2WitnessRecords()[passportA2WitnessStorageKey(ref)];
  if (!record?.witness) {
    return ref;
  }
  return {
    ...ref,
    createdAt: record.createdAt ?? ref.createdAt,
    issuanceKind: record.issuanceKind ?? ref.issuanceKind ?? "a2",
    ghostOwner: record.ghostOwner ?? ref.ghostOwner,
    ghostDerivationVersion: record.ghostDerivationVersion ?? ref.ghostDerivationVersion,
    renewalTxHash: record.renewalTxHash ?? ref.renewalTxHash,
    recoveryTxHash: record.recoveryTxHash ?? ref.recoveryTxHash,
    normalizedClaims: record.normalizedClaims ?? ref.normalizedClaims,
    passportCommittedClaimsV2Witness: record.witness,
  };
}

export function hydratePassportA2Witnesses(refs: StoredCredentialRef[]): StoredCredentialRef[] {
  return refs.map(hydratePassportA2Witness);
}

function instagramV2WitnessStorageKey(
  ref: Pick<StoredCredentialRef, "ownerAddress" | "claimsHash"> &
    Partial<Pick<StoredCredentialRef, "issuerAddress">>,
): string {
  return [
    normalizeScopeValue(ref.issuerAddress),
    normalizeScopeValue(ref.ownerAddress),
    ref.claimsHash,
  ].join(":");
}

function loadInstagramV2WitnessRecords(): Record<string, StoredInstagramV2WitnessRecord> {
  return safeParse<Record<string, StoredInstagramV2WitnessRecord>>(
    window.localStorage.getItem(INSTAGRAM_V2_WITNESSES_KEY),
    {},
  );
}

function saveInstagramV2Witness(ref: StoredCredentialRef): void {
  if (
    ref.kind !== "instagram" ||
    !ref.instagramHandle ||
    !ref.handleHash ||
    !ref.handleBlind
  ) {
    return;
  }
  const records = loadInstagramV2WitnessRecords();
  records[instagramV2WitnessStorageKey(ref)] = {
    issuerAddress: ref.issuerAddress,
    ownerAddress: ref.ownerAddress,
    claimsHash: ref.claimsHash,
    createdAt: ref.createdAt,
    ghostOwner: ref.ghostOwner,
    ghostDerivationVersion: ref.ghostDerivationVersion,
    instagramHandle: ref.instagramHandle,
    handleHash: ref.handleHash,
    handleBlind: ref.handleBlind,
  };
  window.localStorage.setItem(INSTAGRAM_V2_WITNESSES_KEY, JSON.stringify(records));
}

function hydrateInstagramV2Witness(ref: StoredCredentialRef): StoredCredentialRef {
  if (ref.kind !== "instagram") return ref;
  const witness = loadInstagramV2WitnessRecords()[instagramV2WitnessStorageKey(ref)];
  if (!witness) return ref;
  return {
    ...ref,
    createdAt: witness.createdAt,
    ghostOwner: witness.ghostOwner ?? ref.ghostOwner,
    ghostDerivationVersion: witness.ghostDerivationVersion ?? ref.ghostDerivationVersion,
    instagramHandle: witness.instagramHandle,
    handleHash: witness.handleHash,
    handleBlind: witness.handleBlind,
  };
}

function hydrateCredentialPrivateWitnesses(ref: StoredCredentialRef): StoredCredentialRef {
  return hydrateInstagramV2Witness(hydratePassportA2Witness(ref));
}

export function saveCredentialPrivateWitness(ref: StoredCredentialRef): void {
  savePassportA2Witness(ref);
  saveInstagramV2Witness(ref);
}

export function loadCredentialRefs(): StoredCredentialRef[] {
  return safeParse<StoredCredentialRef[]>(window.localStorage.getItem(CREDENTIALS_KEY), []).map(
    hydrateCredentialPrivateWitnesses,
  );
}

export function saveCredentialRefs(refs: StoredCredentialRef[]): void {
  for (const ref of refs) {
    saveCredentialPrivateWitness(ref);
  }
  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(refs));
}

export function clearStoredWalletState(): void {
  window.localStorage.removeItem(CREDENTIALS_KEY);
  window.localStorage.removeItem(WALLET_PROFILE_KEY);
  window.localStorage.removeItem(RECOVERY_V3_FINALIZATION_KEY);
  window.localStorage.removeItem(RECOVERY_TARGET_PROFILE_KEY);
}

export function loadRecoveryTargetProfile(): WalletProfile | null {
  const profile = safeParse<WalletProfile | null>(
    window.localStorage.getItem(RECOVERY_TARGET_PROFILE_KEY),
    null,
  );
  if (
    !profile ||
    typeof profile.address !== "string" ||
    typeof profile.walletKind !== "string" ||
    typeof profile.createdAt !== "string" ||
    typeof profile.publicKey !== "string"
  ) {
    return null;
  }
  return profile;
}

export function saveRecoveryTargetProfile(profile: WalletProfile): void {
  if (!profile.publicKey) {
    throw new Error("Recovery target profile requires its passkey public key.");
  }
  window.localStorage.setItem(RECOVERY_TARGET_PROFILE_KEY, JSON.stringify(profile));
}

export function loadPendingRecoveryV3Finalization(): PendingRecoveryV3Finalization | null {
  const pending = safeParse<PendingRecoveryV3Finalization | null>(
    window.localStorage.getItem(RECOVERY_V3_FINALIZATION_KEY),
    null,
  );
  if (
    !pending ||
    pending.version !== 1 ||
    (pending.phase !== "prepared" && pending.phase !== "submitted") ||
    typeof pending.sourceCredentialId !== "string" ||
    typeof pending.target?.address !== "string" ||
    typeof pending.target?.publicKey !== "string" ||
    typeof pending.recoveredCredential?.id !== "string" ||
    typeof pending.recoveredCredential?.claimsHash !== "string"
  ) {
    return null;
  }
  return pending;
}

export function savePendingRecoveryV3Finalization(pending: PendingRecoveryV3Finalization): void {
  window.localStorage.setItem(RECOVERY_V3_FINALIZATION_KEY, JSON.stringify(pending));
}

export function clearPendingRecoveryV3Finalization(): void {
  window.localStorage.removeItem(RECOVERY_V3_FINALIZATION_KEY);
}

export function storedChainFingerprintChanged(nextFingerprint: string): boolean {
  const previousFingerprint = window.localStorage.getItem(CHAIN_FINGERPRINT_KEY);
  return Boolean(previousFingerprint && previousFingerprint !== nextFingerprint);
}

/**
 * Commits a chain fingerprint only after the caller has successfully disposed
 * of any PXE databases from the previous chain. Recording it before OPFS
 * deletion would turn a transient "database is in use" failure into a
 * permanent stale-cache condition on the next reload.
 */
export function commitStoredChainFingerprint(nextFingerprint: string, clearChainState: boolean): void {
  if (clearChainState) clearStoredWalletState();
  window.localStorage.setItem(CHAIN_FINGERPRINT_KEY, nextFingerprint);
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

function sameCredentialScope(ref: StoredCredentialRef, ownerAddress: string, issuerAddress?: string): boolean {
  return (
    normalizeScopeValue(ref.ownerAddress) === normalizeScopeValue(ownerAddress) &&
    normalizeScopeValue(ref.issuerAddress) === normalizeScopeValue(issuerAddress)
  );
}

/**
 * Returns one canonical PXE snapshot enriched with private local witnesses.
 * Any legacy browser-cached references for this scope are removed: credential
 * existence belongs to Aztec/PXE and is deliberately not persisted here.
 */
export function replaceCredentialRefsForOwnerFromChain(
  ownerAddress: string,
  issuerAddress: string | undefined,
  chainRefs: StoredCredentialRef[],
): StoredCredentialRef[] {
  const canonical = new Map<string, StoredCredentialRef>();
  for (const ref of chainRefs) {
    if (!sameCredentialScope(ref, ownerAddress, issuerAddress)) {
      throw new Error("Chain credential snapshot contains a reference outside the requested owner/issuer scope.");
    }
    canonical.set(credentialStorageKey(ref), hydrateCredentialPrivateWitnesses(ref));
  }
  const scoped = Array.from(canonical.values());
  const outsideScope = loadCredentialRefs().filter(ref => !sameCredentialScope(ref, ownerAddress, issuerAddress));
  saveCredentialRefs(outsideScope);
  return scoped;
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
