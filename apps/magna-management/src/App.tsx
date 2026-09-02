import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import type { PassportWrapperLocalWitness } from "@magna/passport-wrapper-proof/safe";
import type { RecoveryWrapperLocalWitness } from "@magna/recovery-wrapper-proof/safe";
import {
  INSTAGRAM_V2_SCHEMA,
  INSTAGRAM_V2_VALIDITY_SECONDS,
  proveInstagramEmailInBrowser,
} from "@magna/instagram-proof/browser";
import {
  CredentialType,
  computeInstagramClaimsHash,
  computeInstagramHandleCommitment,
  computeInstagramHandleHash,
  createTransientGhostWalletSession,
  createWebAuthnWalletSession,
  clearEmbeddedPxeCacheForNode,
  deriveGhostAccountPreview,
  fundLocalFeeJuice,
  prepareWebAuthnRecoveryTarget,
  loadStoredWebAuthnAccounts,
  parseWebAuthnPublicKeyRecoveryBundle,
  rememberWebAuthnWalletSessionAccount,
  serializeWebAuthnPublicKeyRecoveryBundle,
  MagnaBrowserClient,
  isRootedPassportHints,
  packAlpha3,
  readLocalFeeJuiceBalance,
  type DiscoveredMagnaCredentialRef,
  type PassportHints,
  type PassportCommittedClaimsWitness,
  type RootedPassportHints,
  type RootedCredentialChainState,
  type SponsorRightsSnapshot,
  type SponsorRuntimeStatus,
  type StoredWebAuthnAccount,
  type WalletSession,
  SCOPED_GHOST_DERIVATION_VERSION,
} from "@magna/wallet";
import { AuthorizePage } from "./AuthorizePage";
import { Threads } from "./components/Threads";
import {
  getChainInfo,
  getRecoveryTransactionChainState,
  type RecoveryTransactionChainState,
} from "./lib/aztec";
import { getManagementEnv, type ManagementEnv } from "./lib/env";
import { navigate, useRoute } from "./lib/router";
import {
  clearPendingRecoveryV3Finalization,
  loadCredentialRefs,
  loadPendingRecoveryV3Finalization,
  loadRecoveryTargetProfile,
  loadWalletProfile,
  hydratePassportA2Witness,
  reconcileStoredChainFingerprint,
  refsForOwner,
  saveWalletProfile,
  saveCredentialRefs,
  savePendingRecoveryV3Finalization,
  saveRecoveryTargetProfile,
  upsertCredentialRef,
  type PendingRecoveryV3Finalization,
  type PassportCommittedClaimsV2LocalWitness,
  type StoredCredentialRef,
  type WalletProfile,
} from "./lib/storage";
import {
  startPassportZkRequest,
  verifyAndRefreshRootAuthorityThroughBackend,
  verifyAndIssueInstagramThroughBackend,
  verifyAndIssuePassportA2ThroughBackend,
  type ActiveZkPassportRequest,
  type ZkPassportLifecycleEvent,
} from "./lib/zkpassport";
import {
  buildPassportA2ProofMaterial,
  compressedOuterProof,
  issuePassportThroughConfiguredBackend,
  PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE,
  passportA2BindCustomData,
  passportCredentialUsageBlock,
  proofModeForPassportIssuanceKind,
  secureRandomField,
  type PassportA2LocalWitness,
} from "./lib/passport-issuance";
import {
  assertRecoveryV3PrivateMutationsRejected,
  buildRecoveryV3DeveloperProof,
  preflightRecoveryV3LocalClock,
  prepareRecoveryV3Request,
  submitRecoveryV3DeveloperAuthorization,
  waitForRecoveryV3InboxMessage,
  type RecoveryV3NetworkContext,
} from "./lib/recovery-v3";
import { runWalletLoginForRequestWithSession } from "./lib/wallet-login";
import { registerWalletSessionLoginBroker } from "./lib/wallet-session-broker";

type Role = "user" | "company";

type OpenPasskeyWalletOptions = {
  publicKeyRecoveryBundle?: string;
  captureRecoveryTarget?: boolean;
  stayOnCurrentPage?: boolean;
  forceCreate?: boolean;
  storedCredentialId?: string;
  passkeyName?: string;
  expectedAddress?: string;
  replaceActiveSession?: boolean;
};

type Notice = {
  tone: "info" | "success" | "warning" | "danger";
  text: string;
};

type CredentialHintState = {
  status: "loading" | "loaded" | "error";
  hints?: PassportHints | RootedPassportHints;
  chainState?: RootedCredentialChainState;
  message?: string;
};

type CredentialRailId = "passport" | "instagram" | "sanctions" | "jurisdiction" | "accredited";

type CredentialRail = {
  id: CredentialRailId;
  eyebrow: string;
  title: string;
  summary: string;
  status: "live" | "planned" | "partner";
  proofLabel: string;
};

const DEFAULT_ALIAS = "magna-user";
const DEFAULT_COMPANY_ALIAS = "magna-company";
const WALLET_OPEN_MINIMUM_MS = 2_500;
const ZKPASSPORT_FINAL_RESULT_TIMEOUT_MS = 120_000;

export function defaultPasskeyName(
  purpose: "wallet" | "recovery",
  now: Date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  ].join(" ");
  return `Magna ${purpose === "recovery" ? "recovery" : "wallet"} · ${timestamp}`;
}

export function feeJuiceBalanceLabel(value?: string): string {
  if (!value) return "checking…";
  try {
    return `${BigInt(value).toLocaleString("en-US")} base units`;
  } catch {
    return "unavailable";
  }
}

export function boundWalletProfileRecoveryBundle(profile: WalletProfile): string | null {
  if (!profile.publicKey) return null;
  try {
    const parsed = parseWebAuthnPublicKeyRecoveryBundle(profile.publicKey);
    return JSON.stringify({
      ...parsed,
      address: profile.address,
      rpId: profile.rpId ?? parsed.rpId,
      origin: profile.origin ?? parsed.origin,
    });
  } catch {
    return null;
  }
}

function fingerprintFromChainContext(chain: { chainId: string; version: string }, env: ManagementEnv): string {
  return JSON.stringify({
    aztecNodeUrl: env.aztecNodeUrl,
    deploymentInstanceId: env.deploymentInstanceId ?? "",
    chainId: chain.chainId,
    version: chain.version,
    issuerAddress: env.issuerAddress ?? "",
    orchestratorAddress: env.orchestratorAddress ?? "",
    activeCompanySponsorAddress: env.activeCompanySponsorAddress ?? "",
    rightsRegistryAddress: env.rightsRegistryAddress ?? "",
    rightsPurchaseL2Address: env.rightsPurchaseL2Address ?? "",
    l2PaymentTokenAddress: env.l2PaymentTokenAddress ?? "",
  });
}

const ISSUANCE_RAILS: CredentialRail[] = [
  {
    id: "passport",
    eyebrow: "zkPassport",
    title: "Passport-backed private credential",
    summary: "Prove age and passport eligibility without revealing the document.",
    status: "live",
    proofLabel: "Age / nationality proof",
  },
  {
    id: "instagram",
    eyebrow: "Instagram",
    title: "Signed security email proof",
    summary: "Confirm a social handle from a signed Instagram security email.",
    status: "live",
    proofLabel: "Handle ownership",
  },
  {
    id: "sanctions",
    eyebrow: "Sanctions / OFAC",
    title: "not_sanctioned",
    summary: "The floor for institutional and RWA flows.",
    status: "planned",
    proofLabel: "Compliance eligibility",
  },
  {
    id: "jurisdiction",
    eyebrow: "Jurisdiction",
    title: "Residency / region eligibility",
    summary: "Asset and feature gating based on allowed regions.",
    status: "planned",
    proofLabel: "Regional access",
  },
  {
    id: "accredited",
    eyebrow: "Accredited investor",
    title: "Tokenized securities access",
    summary: "Via a licensed KYC/accreditation issuer.",
    status: "partner",
    proofLabel: "Investor status",
  },
];

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function provePassportWrapperInBrowser(witness: PassportWrapperLocalWitness) {
  const { provePassportWrapper } = await import("../../../packages/magna-passport-wrapper-proof/src/browser");
  return provePassportWrapper(witness);
}

async function proveRecoveryWrapperInBrowser(witness: RecoveryWrapperLocalWitness) {
  const { proveRecoveryWrapperInBrowser: prove } = await import(
    "../../../packages/magna-recovery-wrapper-proof/src/browser"
  );
  return prove(witness);
}

async function assertRecoveryWrapperWitnessRejectedInBrowser(witness: RecoveryWrapperLocalWitness) {
  const { assertRecoveryWrapperWitnessRejectedInBrowser: assertRejected } = await import(
    "../../../packages/magna-recovery-wrapper-proof/src/browser"
  );
  return assertRejected(witness);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function passkeysSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

const INVALID_INSTAGRAM_USERNAME_MESSAGE = "invalid username";

export function canonicalInstagramHandle(value: string): string {
  return value.trim().slice(1).toLowerCase();
}

export function isInstagramHandleInputValid(value: string): boolean {
  return /^@[a-z0-9._]{1,30}$/i.test(value.trim());
}

function isInstagramUsernameError(value: unknown): boolean {
  const message = errorMessage(value).toLowerCase();
  return message.includes("instagram handle must") || message.includes("expected instagram greeting");
}

function credentialId(
  ref: Pick<StoredCredentialRef, "ownerAddress" | "kind" | "claimsHash"> &
    Partial<Pick<StoredCredentialRef, "issuerAddress" | "mode" | "rootCommitment">>,
): string {
  return [
    ref.issuerAddress?.trim().toLowerCase() ?? "issuer:unknown",
    ref.ownerAddress,
    ref.kind,
    ref.mode ?? "",
    ref.claimsHash,
    ref.rootCommitment ?? "",
  ].join(":");
}

function matchesDiscoveredCredentialRef(existing: StoredCredentialRef, discovered: DiscoveredMagnaCredentialRef): boolean {
  return (
    existing.ownerAddress === discovered.ownerAddress &&
    existing.kind === discovered.kind &&
    existing.claimsHash === discovered.claimsHash &&
    (existing.mode ?? "passport") === discovered.mode &&
    (existing.rootCommitment ?? "") === (discovered.rootCommitment ?? "")
  );
}

function hasSameCredentialClaims(existing: StoredCredentialRef, discovered: DiscoveredMagnaCredentialRef): boolean {
  return (
    existing.ownerAddress === discovered.ownerAddress &&
    existing.kind === discovered.kind &&
    existing.claimsHash === discovered.claimsHash
  );
}

function credentialRefHasLocalA2Witness(ref?: Pick<StoredCredentialRef, "passportCommittedClaimsV2Witness">): boolean {
  return Boolean(ref?.passportCommittedClaimsV2Witness);
}

function isPassportA2Credential(
  ref?: Pick<StoredCredentialRef, "kind" | "issuanceKind" | "passportCommittedClaimsV2Witness">,
): boolean {
  return Boolean(ref?.kind === "passport" && ref.issuanceKind === "a2" && ref.passportCommittedClaimsV2Witness);
}

function deploymentStatusFor(session: WalletSession | null, profile: WalletProfile | null): string {
  return session?.metadata?.deploymentStatus ?? profile?.deploymentStatus ?? "not opened";
}

function sessionOriginFor(session: WalletSession | null, profile: WalletProfile | null): string {
  return session?.metadata?.sessionOrigin ?? profile?.sessionOrigin ?? "unknown";
}

function feePayerFor(session: WalletSession | null, profile: WalletProfile | null): string {
  return session?.metadata?.feePayer ?? profile?.feePayer ?? "not configured";
}

function normalizeAddress(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isFeePayerIdentityAddress(
  address: string | undefined,
  session: WalletSession | null,
  profile: WalletProfile | null,
  env: Pick<ManagementEnv, "orchestratorAddress">,
): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  return [
    session?.metadata?.feePayer,
    profile?.feePayer,
    env.orchestratorAddress,
  ].some(candidate => normalizeAddress(candidate) === normalized);
}

export function walletIdentityAddress(
  session: WalletSession | null,
  profile: WalletProfile | null,
  env: Pick<ManagementEnv, "orchestratorAddress">,
): string | undefined {
  const sessionAddress = session?.activeAccount.address;
  if (sessionAddress && !isFeePayerIdentityAddress(sessionAddress, session, profile, env)) {
    return sessionAddress;
  }
  const profileAddress = profile?.address;
  if (profileAddress && !isFeePayerIdentityAddress(profileAddress, session, profile, env)) {
    return profileAddress;
  }
  return undefined;
}

function requireSessionIdentityAddress(
  session: WalletSession,
  env: Pick<ManagementEnv, "orchestratorAddress">,
): string {
  const address = walletIdentityAddress(session, null, env);
  if (!address) {
    throw new Error(
      "Passkey session resolved to the local fee payer/orchestrator account, not the passkey wallet. Reopen the passkey wallet before continuing.",
    );
  }
  return address;
}

export type RecoveryGhostDeploymentAttempt = {
  deploymentFromAddress?: string;
  deployWithLocalTestAccount?: boolean;
  localTestAccountIndex?: number;
};

export function buildRecoveryGhostDeploymentAttempts(input: {
  feePayer?: string | null;
  activeAddress: string;
  enableLocalTestBootstrap: boolean;
  localTestAccountIndex: number;
}): RecoveryGhostDeploymentAttempt[] {
  const feePayer = input.feePayer?.trim();
  const preferredPayer = feePayer && feePayer.startsWith("0x") ? feePayer : input.activeAddress;
  return [
    { deploymentFromAddress: preferredPayer },
    ...(input.enableLocalTestBootstrap
      ? [{ deployWithLocalTestAccount: true, localTestAccountIndex: input.localTestAccountIndex }]
      : []),
  ];
}

function isDeployedSession(session: WalletSession | null): boolean {
  return session?.metadata?.deploymentStatus === "deployed";
}

function isDeployedProfile(profile: WalletProfile | null): boolean {
  return profile?.deploymentStatus === "deployed";
}

function isReadyWallet(
  session: WalletSession | null,
  profile: WalletProfile | null,
  env: Pick<ManagementEnv, "orchestratorAddress">,
): boolean {
  return isDeployedSession(session) && Boolean(walletIdentityAddress(session, profile, env));
}

export function passportCredentialAuthenticityLabel(
  ref: Pick<StoredCredentialRef, "kind" | "issuanceKind" | "normalizedClaims" | "passportCommittedClaimsV2Witness">,
): string | undefined {
  if (ref.kind !== "passport") {
    return undefined;
  }
  if (ref.issuanceKind === "a2" && ref.passportCommittedClaimsV2Witness) {
    return "passport A2 recursive proof (PII-blind)";
  }
  return "passport note found (local A2 committed-claims witness missing)";
}

function committedClaimsV2WitnessFromA2LocalWitness(
  localWitness: PassportA2LocalWitness,
): PassportCommittedClaimsV2LocalWitness {
  return {
    schema: "passport-committed-claims-v2",
    credentialAuthenticity: "passport-a2",
    minAgeProven: localWitness.witness.minAgeProven,
    nationalityAlpha3Packed: packAlpha3(localWitness.witness.nationalityAlpha3).toString(),
    nationalityBlind: BigInt(localWitness.witness.nationalityBlind).toString(),
    expiryTs: BigInt(localWitness.witness.expiryTs).toString(),
    expiryBlind: BigInt(localWitness.witness.expiryBlind).toString(),
  };
}

function walletClaimsWitnessFromA2LocalWitness(
  localWitness: PassportA2LocalWitness,
): PassportCommittedClaimsWitness {
  return {
    minAgeProven: localWitness.witness.minAgeProven,
    nationalityAlpha3Packed: packAlpha3(localWitness.witness.nationalityAlpha3),
    nationalityBlind: BigInt(localWitness.witness.nationalityBlind),
    expiryTs: BigInt(localWitness.witness.expiryTs),
    expiryBlind: BigInt(localWitness.witness.expiryBlind),
  };
}

export function App() {
  const env = useMemo(() => getManagementEnv(), []);
  const route = useRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [walletProfile, setWalletProfile] = useState<WalletProfile | null>(() => loadWalletProfile());
  const [credentials, setCredentials] = useState<StoredCredentialRef[]>(() => loadCredentialRefs());
  const [credentialHints, setCredentialHints] = useState<Record<string, CredentialHintState>>({});
  const [zkRequest, setZkRequest] = useState<ActiveZkPassportRequest | null>(null);
  const [zkStage, setZkStage] = useState("idle");
  const [zkProofCount, setZkProofCount] = useState(0);
  const [passportA2LocalWitness, setPassportA2LocalWitness] = useState<PassportA2LocalWitness | null>(null);
  const [ageThreshold, setAgeThreshold] = useState("18");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [instagramEmailFile, setInstagramEmailFile] = useState<File | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<WalletProfile | null>(() => {
    const persisted = loadRecoveryTargetProfile();
    if (persisted) return persisted;
    const recovered = loadCredentialRefs().find(
      ref => ref.kind === "passport" && ref.mode === "rooted" && Boolean(ref.recoveryTxHash),
    );
    if (!recovered || typeof window === "undefined") return null;
    const stored = loadStoredWebAuthnAccounts(window.localStorage).find(
      account => normalizeAddress(account.address) === normalizeAddress(recovered.ownerAddress),
    );
    if (!stored) return null;
    return {
      address: stored.address,
      label: stored.displayName ?? "Recovered passkey",
      walletKind: "passkey",
      role: "user",
      createdAt: recovered.updatedAt ?? recovered.createdAt,
      publicKey: serializeWebAuthnPublicKeyRecoveryBundle(stored),
      rpId: stored.rpId,
      origin: stored.origin,
      deploymentStatus: "deployed",
      sessionOrigin: "recovered",
    };
  });
  const [pendingRecoveryFinalization, setPendingRecoveryFinalization] =
    useState<PendingRecoveryV3Finalization | null>(() => loadPendingRecoveryV3Finalization());
  const [latestRecoveryBundle, setLatestRecoveryBundle] = useState(() => walletProfile?.publicKey ?? "");
  const [storedPublicKeyInput, setStoredPublicKeyInput] = useState("");
  const [newPasskeyName, setNewPasskeyName] = useState(() => defaultPasskeyName("wallet"));
  const [recoveryPasskeyName, setRecoveryPasskeyName] = useState(() => defaultPasskeyName("recovery"));
  const [feeJuiceBalances, setFeeJuiceBalances] = useState<Record<string, string>>({});
  const [recoveryTransactionChainState, setRecoveryTransactionChainState] =
    useState<RecoveryTransactionChainState | null>(null);
  const [companySponsorAddress, setCompanySponsorAddress] = useState(env.activeCompanySponsorAddress ?? "");
  const [sponsorSnapshot, setSponsorSnapshot] = useState<SponsorRightsSnapshot | null>(null);
  const [sponsorStatuses, setSponsorStatuses] = useState<SponsorRuntimeStatus[]>([]);
  const [topUpRightsAmount, setTopUpRightsAmount] = useState("10");
  const [topUpPackageId, setTopUpPackageId] = useState("");
  const [gatewayCandidate, setGatewayCandidate] = useState(env.activeCompanySponsorAddress ?? "");
  const [restoreAttempted, setRestoreAttempted] = useState(false);
  const [chainContextReady, setChainContextReady] = useState(false);
  const [storedPasskeyRevision, setStoredPasskeyRevision] = useState(0);

  const activeAddress = walletIdentityAddress(session, walletProfile, env);
  const activeCredentialRefs = useMemo(
    () => refsForOwner(activeAddress, { issuerAddress: env.issuerAddress }),
    [activeAddress, credentials, env.issuerAddress],
  );
  // This record is only a locator for the destination credential. Its presence
  // in localStorage is not evidence that recovery completed.
  const recoveredCredentialCandidate = useMemo(
    () => credentials.find(ref => ref.kind === "passport" && ref.mode === "rooted" && Boolean(ref.recoveryTxHash)),
    [credentials],
  );
  const recoveredCredentialChainState = recoveredCredentialCandidate
    ? credentialHints[recoveredCredentialCandidate.id]?.chainState
    : undefined;
  // Completion is asserted only after authenticated target notes have been
  // checked against Aztec's canonical nullifier tree.
  const chainConfirmedRecoveredCredential =
    recoveredCredentialChainState?.status === "active" && recoveryTransactionChainState?.status === "confirmed"
      ? recoveredCredentialCandidate
      : undefined;
  const displayedRecoveryTarget = useMemo<WalletProfile | null>(() => {
    if (recoveryTarget) return recoveryTarget;
    if (!recoveredCredentialCandidate) return null;
    return {
      address: recoveredCredentialCandidate.ownerAddress,
      label: "Recovered passkey · public key required",
      walletKind: "passkey",
      role: "user",
      createdAt: recoveredCredentialCandidate.updatedAt ?? recoveredCredentialCandidate.createdAt,
      deploymentStatus: "deployed",
    };
  }, [recoveredCredentialCandidate, recoveryTarget]);
  const hasCredentials = activeCredentialRefs.length > 0;
  const localFundingEnabled = Boolean(
    env.enableLocalTestBootstrap && env.l1RpcUrl && env.localFaucetPrivateKey,
  );
  const storedPasskeyAccounts = useMemo<StoredWebAuthnAccount[]>(() => {
    if (typeof window === "undefined") return [];
    return loadStoredWebAuthnAccounts(window.localStorage);
  }, [recoveryTarget, route.path, session, storedPasskeyRevision]);
  const storedPasskeyCount = storedPasskeyAccounts.length;
  const missingRememberedWallet = useMemo(() => {
    if (!walletProfile || walletProfile.role === "company" || !boundWalletProfileRecoveryBundle(walletProfile)) {
      return null;
    }
    return storedPasskeyAccounts.some(
      account => normalizeAddress(account.address) === normalizeAddress(walletProfile.address),
    )
      ? null
      : walletProfile;
  }, [storedPasskeyAccounts, walletProfile]);

  // Notices describe the current route only. Clear them for menu clicks,
  // redirects, and browser back/forward navigation so stale feedback cannot
  // follow the user onto another page.
  useEffect(() => {
    setNotice(null);
  }, [route.path]);

  // Chrome navigation (menu, brand, login buttons) clears any transient notice
  // so action feedback never follows the user onto an unrelated page.
  const goTo = useCallback(
    (path: string) => {
      setNotice(null);
      route.go(path);
    },
    [route],
  );

  const appendLog = useCallback((message: string) => {
    console.info(`[magna-management] ${message}`);
  }, []);

  busyRef.current = busy;

  useEffect(() => {
    if (!session || session.kind !== "passkey" || route.path === "/authorize") return;
    return registerWalletSessionLoginBroker(async input => {
      if (busyRef.current) {
        throw new Error(`The open Magna wallet is busy with: ${busyRef.current}.`);
      }
      const label = "Login with Magna";
      busyRef.current = label;
      setBusy(label);
      appendLog("Accepted Login with Magna through the existing wallet/PXE session.");
      try {
        return await runWalletLoginForRequestWithSession(
          {
            ...input,
            onVerifying: () => appendLog("Running brokered private verification through the registered gateway."),
          },
          session,
        );
      } finally {
        busyRef.current = null;
        setBusy(null);
      }
    });
  }, [appendLog, route.path, session]);

  useEffect(() => {
    if (!session || session.kind !== "passkey" || typeof window === "undefined") return;
    const address = session.activeAccount.address;
    if (storedPasskeyAccounts.some(account => normalizeAddress(account.address) === normalizeAddress(address))) return;
    let cancelled = false;
    void rememberWebAuthnWalletSessionAccount(session, {
      rpId: window.location.hostname || "localhost",
      origin: window.location.origin,
      displayName: walletProfile?.label ?? session.metadata?.passkeyName,
      storage: window.localStorage,
    })
      .then(account => {
        if (cancelled) return;
        setStoredPasskeyRevision(revision => revision + 1);
        appendLog(`Restored authenticated passkey lookup metadata for ${account.address}.`);
      })
      .catch(error => appendLog(`Authenticated passkey lookup repair skipped: ${errorMessage(error)}`));
    return () => {
      cancelled = true;
    };
  }, [appendLog, session, storedPasskeyAccounts, walletProfile?.label]);

  useEffect(() => {
    const txHash = recoveredCredentialCandidate?.recoveryTxHash;
    if (!txHash) {
      setRecoveryTransactionChainState(null);
      return;
    }
    let cancelled = false;
    setRecoveryTransactionChainState({ status: "pending", txStatus: "checking" });
    void getRecoveryTransactionChainState(env.aztecNodeUrl, txHash)
      .then(state => {
        if (cancelled) return;
        setRecoveryTransactionChainState(state);
        appendLog(
          state.status === "confirmed"
            ? `Recovery transaction ${txHash} is ${state.txStatus} with successful execution at Aztec L2 block ${state.blockNumber}.`
            : `Recovery transaction ${txHash} is ${state.status} on Aztec (${state.txStatus}).`,
        );
      })
      .catch(error => {
        if (cancelled) return;
        setRecoveryTransactionChainState({
          status: "unavailable",
          txStatus: "unavailable",
          message: errorMessage(error),
        });
        appendLog(`Recovery transaction chain check failed: ${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [appendLog, env.aztecNodeUrl, recoveredCredentialCandidate?.recoveryTxHash]);

  useEffect(() => {
    const addresses = [activeAddress, recoveryTarget?.address].filter((value): value is string => Boolean(value));
    if (!localFundingEnabled || addresses.length === 0) return;
    let cancelled = false;
    void Promise.all(
      addresses.map(async address => {
        const balance = await readLocalFeeJuiceBalance(env.aztecNodeUrl, address);
        return [normalizeAddress(address), balance.toString()] as const;
      }),
    )
      .then(entries => {
        if (!cancelled) {
          setFeeJuiceBalances(current => ({ ...current, ...Object.fromEntries(entries) }));
        }
      })
      .catch(error => appendLog(`Fee Juice balance refresh skipped: ${errorMessage(error)}`));
    return () => {
      cancelled = true;
    };
  }, [activeAddress, appendLog, env.aztecNodeUrl, localFundingEnabled, recoveryTarget?.address]);

  useEffect(() => {
    let cancelled = false;
    setChainContextReady(false);
    void getChainInfo(env.aztecNodeUrl)
      .then(async info => {
        if (cancelled || typeof window === "undefined") return;
        const nextFingerprint = fingerprintFromChainContext(
          {
            chainId: info.chainId.toString(),
            version: info.version.toString(),
          },
          env,
        );
        if (!reconcileStoredChainFingerprint(nextFingerprint)) return;
        await clearEmbeddedPxeCacheForNode(env.aztecNodeUrl);
        setSession(null);
        setWalletProfile(null);
        setRecoveryTarget(null);
        setCredentials(loadCredentialRefs());
        setCredentialHints({});
        setNotice({
          tone: "warning",
          text: "Detected a chain/deployment change. Cleared local credential metadata; re-issue credentials for this chain.",
        });
        appendLog("Detected chain/deployment change; cleared local wallet metadata.");
        if (route.path.startsWith("/user") && route.path !== "/user/login") {
          route.go("/user/login");
        }
      })
      .catch(error => {
        appendLog(`Chain fingerprint check skipped: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (!cancelled) setChainContextReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appendLog, env, route]);

  useEffect(() => {
    if (
      restoreAttempted ||
      !chainContextReady ||
      session ||
      !walletProfile ||
      walletProfile.role === "company" ||
      !route.path.startsWith("/user") ||
      route.path === "/user/login" ||
      storedPasskeyCount === 0 ||
      busy
    ) {
      return;
    }
    setRestoreAttempted(true);
    appendLog("Restoring remembered passkey wallet after refresh.");
    const remembered = storedPasskeyAccounts.find(
      account => normalizeAddress(account.address) === normalizeAddress(walletProfile.address),
    );
    if (!remembered) {
      appendLog("Remembered wallet has no matching stored passkey credential; automatic restore skipped.");
      return;
    }
    void openPasskeyWallet("user", {
      stayOnCurrentPage: true,
      storedCredentialId: remembered.credentialId,
      passkeyName: remembered.displayName,
      expectedAddress: remembered.address,
    });
  }, [appendLog, busy, chainContextReady, restoreAttempted, route.path, session, storedPasskeyAccounts, storedPasskeyCount, walletProfile]);

  async function runAction<T>(label: string, action: () => Promise<T>): Promise<T | null> {
    busyRef.current = label;
    setBusy(label);
    setNotice({ tone: "info", text: label });
    appendLog(`${label} started.`);
    try {
      const result = await action();
      setNotice({ tone: "success", text: `${label} completed.` });
      appendLog(`${label} completed.`);
      return result;
    } catch (error) {
      const message = errorMessage(error);
      setNotice({ tone: "danger", text: message });
      appendLog(`${label} failed: ${message}`);
      return null;
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  async function fundLocalAddress(
    address: string,
    subject: "active wallet" | "recovery target",
  ) {
    const activeSession = requireDeployedWallet(`funding the ${subject}`);
    if (!activeSession) return;
    if (!localFundingEnabled || !env.l1RpcUrl || !env.localFaucetPrivateKey) {
      setNotice({
        tone: "danger",
        text: "The local Fee Juice faucet is unavailable. It is enabled only for the chain-31337 developer profile.",
      });
      return;
    }
    const result = await runAction(`Fund ${subject}`, () =>
      fundLocalFeeJuice({
        wallet: activeSession.wallet,
        recipient: address,
        nodeUrl: env.aztecNodeUrl,
        l1RpcUrl: env.l1RpcUrl!,
        l1PrivateKey: env.localFaucetPrivateKey as `0x${string}`,
        localTestAccountIndex: env.localTestAccountIndex,
        onProgress: progress => appendLog(`Local Fee Juice ${subject}: ${progress}.`),
      }),
    );
    if (!result) return;
    setFeeJuiceBalances(current => ({
      ...current,
      [normalizeAddress(result.recipient)]: result.balanceAfter.toString(),
    }));
    setNotice({
      tone: "success",
      text: `${subject === "active wallet" ? "Active wallet" : "Recovery target"} funded with Fee Juice.`,
    });
    appendLog(
      `Local Fee Juice claim ${result.claimTxHash}: ${result.balanceBefore.toString()} -> ${result.balanceAfter.toString()} base units.`,
    );
  }

  function createClient(nextSession: WalletSession = session!): MagnaBrowserClient {
    if (!nextSession) throw new Error("Open a wallet session first.");
    if (!isDeployedSession(nextSession)) {
      throw new Error("This passkey wallet is counterfactual. Deploy it before running sponsor or credential actions.");
    }
    return new MagnaBrowserClient(nextSession.wallet, env, requireSessionIdentityAddress(nextSession, env));
  }

  function requireDeployedWallet(action: string): WalletSession | null {
    if (!session) {
      setNotice({ tone: "danger", text: `Open a user passkey wallet before ${action}.` });
      route.go("/user/login");
      return null;
    }
    if (!isDeployedSession(session)) {
      setNotice({
        tone: "danger",
        text:
          "This passkey wallet is counterfactual, not deployed. Deployment must complete before issuance, renewal, recovery, or Login with Magna.",
      });
      return null;
    }
    try {
      requireSessionIdentityAddress(session, env);
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
      return null;
    }
    return session;
  }

  async function loadHintsForCredentialRefs(nextSession: WalletSession, refs: StoredCredentialRef[]) {
    const ownerAddress = requireSessionIdentityAddress(nextSession, env);
    // Rooted references must be revalidated even if a previous local snapshot
    // called them inactive. Reorgs and later chain sync are decided by Aztec,
    // never by localStorage.
    const refsToValidate = refs.filter(
      ref =>
        (ref.kind === "passport" || ref.kind === "instagram") &&
        (ref.status === "active" || ref.mode === "rooted"),
    );
    if (refsToValidate.length === 0 || !env.issuerAddress) return;

    const client = new MagnaBrowserClient(nextSession.wallet, env, ownerAddress);
    await client.syncOrchestratorSender();
    for (const ref of refsToValidate) {
      const passportBlock = ref.kind === "passport" ? passportCredentialUsageBlock(ref) : null;
      if (passportBlock) {
        setCredentialHints(current => ({
          ...current,
          [ref.id]: { status: "error", message: passportBlock },
        }));
        continue;
      }
      setCredentialHints(current => ({
        ...current,
        [ref.id]: { status: "loading", message: "Fetching hinted notes" },
      }));
      try {
        const hints =
          ref.kind === "passport" && ref.mode === "rooted" && ref.rootCommitment
            ? await client.fetchRootedPassportHintsByClaimsHash(ref.ownerAddress, ref.rootCommitment, ref.claimsHash)
            : await client.fetchPassportHintsByClaimsHash(ref.ownerAddress, ref.claimsHash);
        const chainState = isRootedPassportHints(hints)
          ? await client.readRootedPassportChainState(hints)
          : undefined;
        setCredentialHints(current => ({
          ...current,
          [ref.id]: {
            status: "loaded",
            hints,
            chainState,
            message: chainState ? "Notes loaded; chain state confirmed" : "Hinted notes loaded",
          },
        }));
        if (chainState) {
          appendLog(
            `Credential ${ref.id} is ${chainState.status} from Aztec nullifier state at L2 block ${chainState.checkedAtBlock} (${chainState.reason}).`,
          );
        }
      } catch (error) {
        setCredentialHints(current => ({
          ...current,
          [ref.id]: { status: "error", message: errorMessage(error) },
        }));
      }
    }
  }

  function storedRefFromDiscovered(
    discovered: DiscoveredMagnaCredentialRef,
    existing?: StoredCredentialRef,
  ): StoredCredentialRef {
    const now = new Date().toISOString();
    return hydratePassportA2Witness({
      ...existing,
      id: credentialId({
        ownerAddress: discovered.ownerAddress,
        kind: discovered.kind,
        claimsHash: discovered.claimsHash,
        issuerAddress: env.issuerAddress,
        mode: discovered.mode,
        rootCommitment: discovered.rootCommitment,
      }),
      ownerAddress: discovered.ownerAddress,
      kind: discovered.kind,
      status: "active",
      claimsHash: discovered.claimsHash,
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? now : undefined,
      issuanceTxHash: discovered.issuanceTxHash ?? existing?.issuanceTxHash,
      issuerAddress: env.issuerAddress,
      mode: discovered.mode,
      issuanceKind: existing?.issuanceKind ?? (credentialRefHasLocalA2Witness(existing) ? "a2" : undefined),
      rootCommitment: discovered.rootCommitment ?? existing?.rootCommitment,
    });
  }

  async function refreshCredentialRefsFromPxe(nextSession: WalletSession): Promise<StoredCredentialRef[]> {
    const ownerAddress = requireSessionIdentityAddress(nextSession, env);
    if (!env.issuerAddress) {
      return refsForOwner(ownerAddress);
    }
    try {
      const client = new MagnaBrowserClient(nextSession.wallet, env, ownerAddress);
      const discovered = await client.discoverCredentialRefs(ownerAddress);
      if (discovered.length === 0) {
        return refsForOwner(ownerAddress, { issuerAddress: env.issuerAddress });
      }

      const currentRefs = loadCredentialRefs();
      const nextById = new Map(currentRefs.map(ref => [ref.id, ref]));
      for (const ref of discovered) {
        const id = credentialId({
          ownerAddress: ref.ownerAddress,
          kind: ref.kind,
          claimsHash: ref.claimsHash,
          issuerAddress: env.issuerAddress,
          mode: ref.mode,
          rootCommitment: ref.rootCommitment,
        });
        const existing =
          nextById.get(id) ??
          currentRefs.find(existingRef => matchesDiscoveredCredentialRef(existingRef, ref)) ??
          currentRefs.find(existingRef => hasSameCredentialClaims(existingRef, ref));
        if (existing?.id && existing.id !== id) {
          nextById.delete(existing.id);
        }
        nextById.set(id, storedRefFromDiscovered(ref, existing));
      }
      const nextRefs = Array.from(nextById.values());
      saveCredentialRefs(nextRefs);
      appendLog(`Discovered ${discovered.length} credential reference${discovered.length === 1 ? "" : "s"} from PXE notes.`);
      return refsForOwner(ownerAddress, { issuerAddress: env.issuerAddress });
    } catch (error) {
      appendLog(`Credential note discovery skipped: ${errorMessage(error)}`);
      return refsForOwner(ownerAddress, { issuerAddress: env.issuerAddress });
    }
  }

  async function disconnect() {
    if (!session) return;
    setBusy("Disconnect wallet");
    try {
      await session.disconnect();
      setSession(null);
      setZkRequest(null);
      setZkStage("idle");
      setNotice(null);
      route.go("/");
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function syncAfterLogin(nextSession: WalletSession, role: Role) {
    if (role === "company") {
      setCredentials(loadCredentialRefs());
      route.go("/company");
      return;
    }

    const refs = await refreshCredentialRefsFromPxe(nextSession);
    const storedRefs = loadCredentialRefs();
    setCredentials(storedRefs);
    const recoveredCandidates = storedRefs.filter(
      ref =>
        ref.kind === "passport" &&
        ref.mode === "rooted" &&
        Boolean(ref.recoveryTxHash) &&
        !refs.some(activeRef => activeRef.id === ref.id),
    );
    // The saved refs identify which private notes to ask PXE for. They do not
    // supply status: readRootedPassportChainState derives status from the
    // authenticated notes and Aztec's nullifier tree at one pinned L2 block.
    await loadHintsForCredentialRefs(nextSession, [...refs, ...recoveredCandidates]);
    setNotice({
      tone: refs.length > 0 ? "success" : "warning",
      text:
        refs.length > 0
          ? `Loaded ${refs.length} credential reference${refs.length === 1 ? "" : "s"} and started hinted-note sync.`
          : "No credential notes found for this wallet. Start issuance next.",
    });
    route.go(refs.length > 0 ? "/user" : "/user/issue");
  }

  async function openPasskeyWallet(role: Role, options: OpenPasskeyWalletOptions = {}) {
    if (!passkeysSupported()) {
      setNotice({ tone: "danger", text: "Passkeys are not supported in this browser." });
      return;
    }

    // Switching to a recovered destination is an explicit post-recovery user
    // action. Close the source PXE first so the target session can take the
    // same persistent OPFS store without creating a second live store owner.
    // This is never used while authorizing or executing recovery.
    if (options.replaceActiveSession && session) {
      setBusy("Switch to recovered wallet");
      setNotice({ tone: "info", text: "Closing the source wallet before opening the recovered passkey." });
      try {
        await session.disconnect();
        setSession(null);
      } catch (error) {
        setNotice({ tone: "danger", text: `Could not close the source wallet: ${errorMessage(error)}` });
        setBusy(null);
        return;
      }
      setBusy(null);
    }

    const label = options.publicKeyRecoveryBundle
      ? "Use stored passkey wallet"
      : options.forceCreate
        ? "Create passkey wallet"
        : "Open passkey wallet";

    if (options.captureRecoveryTarget) {
      const activeSession = requireDeployedWallet("preparing a recovery target");
      if (!activeSession) return;
      const prepared = await runAction(label, async () => {
        const [target] = await Promise.all([
          prepareWebAuthnRecoveryTarget({
            wallet: activeSession.wallet,
            userName: options.passkeyName?.trim() || defaultPasskeyName("recovery"),
            rpId: window.location.hostname || "localhost",
            publicKeyRecoveryBundle: options.publicKeyRecoveryBundle,
            localTestAccountIndex: env.localTestAccountIndex,
            deployWithLocalTestAccount: env.enableLocalTestBootstrap,
          }),
          sleep(WALLET_OPEN_MINIMUM_MS),
        ]);
        if (
          recoveredCredentialCandidate &&
          !recoveryTarget &&
          normalizeAddress(target.address) !== normalizeAddress(recoveredCredentialCandidate.ownerAddress)
        ) {
          throw new Error(
            `Selected passkey does not derive the completed recovery destination. ` +
              `expected=${recoveredCredentialCandidate.ownerAddress} actual=${target.address}`,
          );
        }
        return target;
      });
      if (!prepared) return;

      const targetProfile: WalletProfile = {
        address: prepared.address,
        label: prepared.displayName,
        walletKind: "passkey",
        role: "user",
        createdAt: new Date().toISOString(),
        publicKey: prepared.publicKeyRecoveryBundle,
        rpId: window.location.hostname || "localhost",
        origin: window.location.origin,
        deploymentStatus: prepared.deploymentStatus,
        sessionOrigin: prepared.materialOrigin,
        feePayer: prepared.feePayer,
        lastOpenedAt: new Date().toISOString(),
      };
      setLatestRecoveryBundle(targetProfile.publicKey ?? "");
      if (!isDeployedProfile(targetProfile)) {
        setNotice({
          tone: "danger",
          text: "Recovery target is counterfactual. Deploy the new passkey wallet before rotating credentials to it.",
        });
        return;
      }
      setRecoveryTarget(targetProfile);
      saveRecoveryTargetProfile(targetProfile);
      appendLog(`Recovery target prepared on the active wallet session: ${targetProfile.address}`);
      route.go("/user/recovery");
      return;
    }

    const next = await runAction(label, async () => {
      const alias =
        role === "company"
          ? DEFAULT_COMPANY_ALIAS
          : options.forceCreate
            ? options.passkeyName?.trim() || defaultPasskeyName("wallet")
            : options.publicKeyRecoveryBundle
              ? options.passkeyName?.trim() || DEFAULT_ALIAS
              : DEFAULT_ALIAS;
      const [nextSession] = await Promise.all([
        createWebAuthnWalletSession({
          nodeUrl: env.aztecNodeUrl,
          alias,
          userName: alias,
          rpId: window.location.hostname || "localhost",
          publicKeyRecoveryBundle: options.publicKeyRecoveryBundle,
          forceCreate: options.forceCreate,
          storedCredentialId: options.storedCredentialId,
          localTestAccountIndex: env.localTestAccountIndex,
          deployWithLocalTestAccount: env.enableLocalTestBootstrap,
        }),
        sleep(WALLET_OPEN_MINIMUM_MS),
      ]);
      let address: string;
      try {
        address = requireSessionIdentityAddress(nextSession, env);
        if (options.expectedAddress && normalizeAddress(address) !== normalizeAddress(options.expectedAddress)) {
          throw new Error(
            `Selected passkey does not derive the recovered destination. ` +
              `expected=${options.expectedAddress} actual=${address}`,
          );
        }
      } catch (error) {
        await nextSession.disconnect().catch(() => undefined);
        throw error;
      }
      const profile: WalletProfile = {
        address,
        label: nextSession.metadata?.passkeyName ?? alias,
        walletKind: nextSession.kind,
        role,
        createdAt: new Date().toISOString(),
        publicKey: nextSession.metadata?.publicKeyRecoveryBundle,
        rpId: nextSession.metadata?.rpId ?? window.location.hostname,
        origin: window.location.origin,
        deploymentStatus: nextSession.metadata?.deploymentStatus,
        sessionOrigin: nextSession.metadata?.sessionOrigin,
        feePayer: nextSession.metadata?.feePayer,
        lastOpenedAt: new Date().toISOString(),
      };
      return { nextSession, profile };
    });
    if (!next) return;

    setSession(next.nextSession);
    setWalletProfile(next.profile);
    setLatestRecoveryBundle(next.profile.publicKey ?? "");
    saveWalletProfile(next.profile);
    if (!isDeployedSession(next.nextSession)) {
      setNotice({
        tone: "danger",
        text:
          "Passkey wallet opened but is counterfactual, not deployed. Keep the Magna passkey public key, then fix funding/node state before issuing credentials.",
      });
      return;
    }
    if (options.stayOnCurrentPage) {
      const refs = await refreshCredentialRefsFromPxe(next.nextSession);
      setCredentials(loadCredentialRefs());
      await loadHintsForCredentialRefs(next.nextSession, refs);
      setNotice({
        tone: "success",
        text: `Passkey wallet restored. Loaded ${refs.length} credential reference${refs.length === 1 ? "" : "s"}.`,
      });
      appendLog(`Passkey wallet restored: ${next.profile.address}`);
      return;
    }
    await syncAfterLogin(next.nextSession, role);
  }

  async function openRecoveredTargetWallet() {
    const target = recoveryTarget;
    if (!target?.publicKey) {
      setNotice({ tone: "danger", text: "The recovered target is missing its passkey public key." });
      return;
    }
    const storedTarget = storedPasskeyAccounts.find(
      account => normalizeAddress(account.address) === normalizeAddress(target.address),
    );
    await openPasskeyWallet("user", {
      ...(storedTarget
        ? { storedCredentialId: storedTarget.credentialId }
        : { publicKeyRecoveryBundle: target.publicKey }),
      passkeyName: target.label,
      expectedAddress: target.address,
      replaceActiveSession: true,
    });
  }

  async function useStoredPasskey(role: Role, captureRecoveryTarget = false) {
    const publicKey = storedPublicKeyInput.trim();
    if (!publicKey) {
      setNotice({ tone: "danger", text: "Paste a public key to use a stored passkey wallet." });
      return;
    }
    await openPasskeyWallet(role, { publicKeyRecoveryBundle: publicKey, captureRecoveryTarget });
  }

  async function copyRecoveryBundle() {
    if (!latestRecoveryBundle) {
      setNotice({ tone: "warning", text: "No Magna passkey public key is available yet." });
      return;
    }
    try {
      await navigator.clipboard.writeText(latestRecoveryBundle);
      setNotice({ tone: "success", text: "Magna passkey public key copied." });
    } catch {
      setNotice({ tone: "warning", text: "Copy failed. Select the public key and copy it manually." });
    }
  }

  function handleZkEvent(event: ZkPassportLifecycleEvent) {
    switch (event.type) {
      case "request_created":
        appendLog(`zkPassport request created: ${event.requestId}`);
        break;
      case "bridge_connected":
        appendLog("zkPassport bridge connected.");
        break;
      case "request_received":
        appendLog("zkPassport request received on mobile app.");
        break;
      case "generating_proof":
        appendLog("zkPassport generating proof(s).");
        break;
      case "proof_generated":
        setZkProofCount(event.proofCount);
        appendLog(
          `zkPassport proof generated (${event.proofCount}${event.proofTotal ? `/${event.proofTotal}` : ""}). Waiting for final result.`,
        );
        break;
      case "query_result_received":
        appendLog("zkPassport final query result received.");
        break;
      case "sdk_verification_prepared":
        appendLog(`zkPassport SDK local verifier CRS prepared (${event.srsSize} points).`);
        break;
      case "result_received":
        appendLog(`zkPassport result received (verified=${event.verified}).`);
        break;
    }
    setZkStage(event.type);
  }

  async function startZkPassportIssuance() {
    const activeSession = requireDeployedWallet("issuance");
    if (!activeSession) return;
    const activeOwner = requireSessionIdentityAddress(activeSession, env);
    const parsedAge = Number.parseInt(ageThreshold, 10);
    if (!Number.isFinite(parsedAge)) {
      setNotice({ tone: "danger", text: "Age threshold must be a valid number." });
      return;
    }
    if (!env.verificationApiUrl) {
      setNotice({ tone: "danger", text: "VITE_MAGNA_VERIFICATION_API_URL is required for zkPassport issuance." });
      return;
    }
    if (!env.issuerAddress) {
      setNotice({ tone: "danger", text: "VITE_MAGNA_ISSUER_ADDRESS is required for zkPassport issuance." });
      return;
    }
    const proofMode = proofModeForPassportIssuanceKind("a2");
    const a2BindCustomData = passportA2BindCustomData({
      action: "issue",
      activeOwner,
      requestScope: env.zkPassportRequestScope,
    });

    setZkStage("creating_request");
    setZkProofCount(0);
    setPassportA2LocalWitness(null);
    appendLog("zkPassport issuance flow started.");
    if (env.zkPassportDevMode) {
      appendLog("zkPassport dev mode enabled (official non-salted mock identifier; OPRF disabled).");
    }
    appendLog("Passport A2 issuance will recursively verify the compressed proof in the local wrapper.");
    let finalResultTimeout: number | undefined;
    let timedOutWaitingForResult = false;
    let activeZkPassportRequest: ActiveZkPassportRequest | null = null;
    const request = await runAction("Create zkPassport QR request", async () =>
      startPassportZkRequest({
        ageThreshold: parsedAge,
        proofMode,
        a2BindCustomData,
        metadata: {
          name: env.zkPassportRequestName,
          logo: env.zkPassportRequestLogo,
          purpose: env.zkPassportRequestPurpose,
          scope: env.zkPassportRequestScope,
        },
        devMode: env.zkPassportDevMode,
        onEvent: event => {
          handleZkEvent(event);
          if (event.type !== "proof_generated" || !event.proofTotal || event.proofCount < event.proofTotal || finalResultTimeout) {
            return;
          }
          finalResultTimeout = window.setTimeout(() => {
            timedOutWaitingForResult = true;
            activeZkPassportRequest?.cancel();
            setZkRequest(null);
            setZkStage("error");
            setNotice({
              tone: "danger",
              text: "zkPassport did not return a final result after generating proofs. Retry the request from the beginning.",
            });
            appendLog(
              `zkPassport final result timed out after all proofs were generated (${event.proofCount}/${event.proofTotal}).`,
            );
          }, ZKPASSPORT_FINAL_RESULT_TIMEOUT_MS);
        },
      }),
    );
    if (!request) return;
    activeZkPassportRequest = request;
    setZkRequest(request);
    setNotice({
      tone: "info",
      text: "zkPassport request created. Continue in the mobile app; proof generation is still in progress.",
    });

    request.completion
      .then(async completion => {
        if (timedOutWaitingForResult) return;
        if (finalResultTimeout) {
          window.clearTimeout(finalResultTimeout);
          finalResultTimeout = undefined;
        }
        if (completion.status === "rejected") {
          setNotice({ tone: "warning", text: "zkPassport request was rejected." });
          setZkStage("rejected");
          appendLog("zkPassport request rejected.");
          return;
        }
        setZkStage("submitting_to_backend");
        appendLog("zkPassport result received. Building the local A2 proof before API submission.");
        const issueResult = await issuePassportThroughConfiguredBackend(
          {
            issuanceKind: "a2",
            verificationApiUrl: env.verificationApiUrl!,
            completion,
            activeOwner,
            issuerAddress: env.issuerAddress!,
            ageThreshold: parsedAge,
            mode: env.zkPassportPrimaryIssuanceMode,
            ghostDerivationVersion: env.zkPassportGhostDerivationVersion,
            requestScope: env.zkPassportRequestScope,
            a2BindCustomData,
          },
          {
            verifyAndIssuePassportA2ThroughBackend,
            provePassportWrapper: provePassportWrapperInBrowser,
            onA2Progress: event => {
              if (event.type === "building_witness") {
                setZkStage("building_a2_witness");
                appendLog("Building local A2 wrapper witness.");
              } else if (event.type === "generating_wrapper_proof") {
                setZkStage("generating_a2_wrapper_proof");
                appendLog("Generating local A2 recursive wrapper proof.");
              } else {
                setZkStage("submitting_to_backend");
                appendLog("Submitting A2 public proof payload to verification API.");
              }
            },
          },
        );
        setPassportA2LocalWitness(issueResult.localWitness);
        const issued = issueResult.response;
        const passportCommittedClaimsV2Witness = committedClaimsV2WitnessFromA2LocalWitness(issueResult.localWitness);
        const ref: StoredCredentialRef = {
          id: credentialId({
            ownerAddress: activeOwner,
            kind: "passport",
            claimsHash: issued.claimsHash,
            issuerAddress: issued.issuerAddress,
            mode: issued.mode,
            rootCommitment: issued.rootCommitment,
          }),
          ownerAddress: activeOwner,
          kind: "passport",
          status: "active",
          claimsHash: issued.claimsHash,
          createdAt: new Date().toISOString(),
          issuanceTxHash: issued.issuanceTxHash,
          issuerAddress: issued.issuerAddress,
          orchestratorAddress: issued.orchestratorAddress,
          mode: issued.mode,
          issuanceKind: issueResult.issuanceKind,
          rootCommitment: issued.rootCommitment,
          ghostOwner: issued.ghostOwner,
          ghostDerivationVersion: issued.ghostDerivationVersion,
          passportCommittedClaimsV2Witness,
        };
        setCredentials(upsertCredentialRef(ref));
        await loadHintsForCredentialRefs(activeSession, [ref]);
        setNotice({
          tone: "success",
          text: "Passport A2 credential issued and stored for this wallet. Its committed-claims witness remains on this device.",
        });
        setZkStage("issued");
        appendLog(`Passport A2 credential issued. Local witness retained. Claims hash: ${issued.claimsHash}`);
      })
      .catch(error => {
        if (finalResultTimeout) {
          window.clearTimeout(finalResultTimeout);
          finalResultTimeout = undefined;
        }
        if (timedOutWaitingForResult) return;
        const message = errorMessage(error);
        setNotice({ tone: "danger", text: message });
        setZkStage("error");
        appendLog(`zkPassport issuance failed: ${message}`);
      })
      .finally(() => {
        if (finalResultTimeout) window.clearTimeout(finalResultTimeout);
        setZkRequest(null);
      });
  }

  async function issueInstagramCredential() {
    const activeSession = requireDeployedWallet("collecting Instagram");
    if (!activeSession) return;
    const activeOwner = requireSessionIdentityAddress(activeSession, env);
    if (!env.verificationApiUrl) {
      setNotice({ tone: "danger", text: "VITE_MAGNA_VERIFICATION_API_URL is required for Instagram issuance." });
      return;
    }
    if (!isInstagramHandleInputValid(instagramHandle)) {
      setNotice({ tone: "danger", text: INVALID_INSTAGRAM_USERNAME_MESSAGE });
      return;
    }
    const handle = canonicalInstagramHandle(instagramHandle);
    if (!instagramEmailFile) {
      setNotice({ tone: "danger", text: "Choose the Instagram security email .eml file." });
      return;
    }
    await runAction("Issuing Instagram credential", async () => {
      if (!env.issuerAddress) {
        throw new Error("VITE_MAGNA_ISSUER_ADDRESS is required for Instagram issuance.");
      }
      appendLog("Reading and verifying the Instagram email locally. The .eml and handle are not sent to Magna API.");
      const handleBlind = secureRandomField();
      const expiryTs = BigInt(Math.floor(Date.now() / 1000) + INSTAGRAM_V2_VALIDITY_SECONDS);
      const chainInfo = await getChainInfo(env.aztecNodeUrl);
      const artifact = await proveInstagramEmailInBrowser(
        new Uint8Array(await instagramEmailFile.arrayBuffer()),
        handle,
        {
          handleBlind,
          expiryTs,
          activeOwner: BigInt(activeOwner),
          issuerAddress: BigInt(env.issuerAddress),
          chainId: chainInfo.chainId.toBigInt(),
        },
      );
      const handleHash = computeInstagramHandleHash(handle);
      const handleCommitment = computeInstagramHandleCommitment(handleHash, handleBlind);
      const localClaimsHash = computeInstagramClaimsHash({
        schemaVersion: 2,
        credentialType: CredentialType.Instagram,
        handleCommitment,
        expiryTs,
      });
      if (BigInt(artifact.outputs.claimsHash) !== localClaimsHash) {
        throw new Error("Instagram V2 proof claims hash does not match the locally retained handle witness.");
      }
      appendLog("Instagram V2 proof generated locally with owner, issuer, chain, expiry, and blinded handle binding.");
      const issued = await (async () => {
        try {
          return await verifyAndIssueInstagramThroughBackend(env.verificationApiUrl!, {
            schema: INSTAGRAM_V2_SCHEMA,
            proof: {
              proof: Array.from(artifact.proof.proof),
              publicInputs: artifact.publicInputs,
            },
            activeOwner,
          });
        } catch (error) {
          if (isInstagramUsernameError(error)) {
            throw new Error(INVALID_INSTAGRAM_USERNAME_MESSAGE);
          }
          throw error;
        }
      })();
      if (issued.claimsHash !== localClaimsHash.toString() || BigInt(issued.expiryTs) !== expiryTs) {
        throw new Error("Instagram API issuance response does not match the locally generated proof.");
      }
      const ref: StoredCredentialRef = {
        id: credentialId({
          ownerAddress: activeOwner,
          kind: "instagram",
          claimsHash: issued.claimsHash,
          issuerAddress: issued.issuerAddress,
        }),
        ownerAddress: activeOwner,
        kind: "instagram",
        status: "active",
        claimsHash: issued.claimsHash,
        createdAt: new Date().toISOString(),
        issuanceTxHash: issued.issuanceTxHash,
        issuerAddress: issued.issuerAddress,
        orchestratorAddress: issued.orchestratorAddress,
        ghostOwner: issued.ghostOwner,
        ghostDerivationVersion: issued.ghostDerivationVersion,
        instagramHandle: handle,
        handleHash: handleHash.toString(),
        handleBlind: handleBlind.toString(),
      };
      setCredentials(upsertCredentialRef(ref));
      await loadHintsForCredentialRefs(activeSession, [ref]);
      setInstagramHandle("");
      setInstagramEmailFile(null);
      setNotice({ tone: "success", text: "Instagram credential issued and stored for this wallet." });
      navigate("/user");
    });
  }

  async function startRootedRenewal(ref: StoredCredentialRef) {
    const activeSession = requireDeployedWallet("renewal");
    if (!activeSession) return;
    const activeOwner = requireSessionIdentityAddress(activeSession, env);
    const passportBlock = passportCredentialUsageBlock(ref);
    if (passportBlock) {
      setNotice({ tone: "danger", text: passportBlock });
      return;
    }
    if (!env.verificationApiUrl) {
      setNotice({ tone: "danger", text: "VITE_MAGNA_VERIFICATION_API_URL is required for rooted renewal." });
      return;
    }
    const hintState = credentialHints[ref.id];
    if (!hintState?.hints || !isRootedPassportHints(hintState.hints)) {
      setNotice({ tone: "danger", text: "Rooted hinted notes must load before renewal." });
      return;
    }
    const rootedHints = hintState.hints;
    if (!ref.ghostOwner) {
      setNotice({ tone: "danger", text: "Rooted renewal requires the credential ghost owner." });
      return;
    }
    if (!isPassportA2Credential(ref) || !ref.issuerAddress) {
      setNotice({ tone: "danger", text: PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE });
      return;
    }
    const localClaimsWitness = ref.passportCommittedClaimsV2Witness;
    if (!localClaimsWitness) {
      setNotice({ tone: "danger", text: PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE });
      return;
    }
    const age = localClaimsWitness.minAgeProven;
    const a2BindCustomData = passportA2BindCustomData({
      action: "renew",
      activeOwner,
      requestScope: env.zkPassportRequestScope,
    });
    const request = await runAction("Create zkPassport renewal request", async () =>
      startPassportZkRequest({
        ageThreshold: age,
        proofMode: proofModeForPassportIssuanceKind("a2"),
        a2BindCustomData,
        metadata: {
          name: env.zkPassportRequestName,
          logo: env.zkPassportRequestLogo,
          purpose: env.zkPassportRequestPurpose,
          scope: env.zkPassportRequestScope,
        },
        devMode: env.zkPassportDevMode,
        onEvent: handleZkEvent,
      }),
    );
    if (!request) return;
    setZkRequest(request);
    setZkProofCount(0);

    request.completion
      .then(async completion => {
        if (completion.status === "rejected") {
          setNotice({ tone: "warning", text: "zkPassport renewal request was rejected." });
          setZkStage("rejected");
          return;
        }
        setZkStage("submitting_renewal");
        const a2ProofMaterial = await buildPassportA2ProofMaterial(
          {
            action: "renew",
            ghostOwner: ref.ghostOwner!,
            issuanceKind: "a2",
            verificationApiUrl: env.verificationApiUrl!,
            completion,
            activeOwner,
            issuerAddress: ref.issuerAddress!,
            ageThreshold: age,
            mode: "rooted",
            ghostDerivationVersion: ref.ghostDerivationVersion ?? env.zkPassportGhostDerivationVersion,
            preparedGhostOwner: ref.ghostOwner,
            requestScope: env.zkPassportRequestScope,
            a2BindCustomData,
          },
          {
            provePassportWrapper: provePassportWrapperInBrowser,
            onA2Progress: event => {
              if (event.type === "building_witness") {
                setZkStage("building_a2_witness");
                appendLog("Building local A2 renewal wrapper witness.");
              } else if (event.type === "generating_wrapper_proof") {
                setZkStage("generating_a2_wrapper_proof");
                appendLog("Generating local A2 renewal wrapper proof.");
              }
            },
          },
        );
        setZkStage("submitting_renewal");
        appendLog("Submitting A2 renewal proof without rooted notes.");
        const renewed = await verifyAndRefreshRootAuthorityThroughBackend(
          env.verificationApiUrl!,
          { ...a2ProofMaterial.payload, activeOwner, ghostOwner: ref.ghostOwner! },
        );
        appendLog(`Renewal authorization confirmed on Aztec: ${renewed.renewalAuthorizationTxHash}`);
        setZkStage("refreshing_root_authority_locally");
        const renewalClient = new MagnaBrowserClient(activeSession.wallet, env, activeOwner);
        const localRenewal = await renewalClient.refreshRootAuthorityAuthorized(
          ref.ghostOwner!,
          walletClaimsWitnessFromA2LocalWitness(a2ProofMaterial.localWitness),
          BigInt(a2ProofMaterial.payload.credentialValidUntil),
          rootedHints,
        );
        const renewedRef: StoredCredentialRef = {
          ...ref,
          id: credentialId({
            ownerAddress: ref.ownerAddress,
            kind: "passport",
            claimsHash: renewed.claimsHash,
            issuerAddress: renewed.issuerAddress,
            mode: "rooted",
            rootCommitment: renewed.rootCommitment,
          }),
          claimsHash: renewed.claimsHash,
          rootCommitment: renewed.rootCommitment,
          ghostOwner: renewed.ghostOwner,
          renewalTxHash: localRenewal.txHash,
          issuerAddress: renewed.issuerAddress,
          orchestratorAddress: renewed.orchestratorAddress,
          issuanceKind: "a2",
          passportCommittedClaimsV2Witness: committedClaimsV2WitnessFromA2LocalWitness(a2ProofMaterial.localWitness),
          updatedAt: new Date().toISOString(),
        };
        setPassportA2LocalWitness(a2ProofMaterial.localWitness);
        setCredentials(upsertCredentialRef(renewedRef));
        await loadHintsForCredentialRefs(activeSession, [renewedRef]);
        setNotice({
          tone: "success",
          text: "Rooted passport authority renewed with A2. The refreshed claims witness remains on this device.",
        });
        setZkStage("renewed");
      })
      .catch(error => {
        setNotice({ tone: "danger", text: errorMessage(error) });
        setZkStage("error");
      })
      .finally(() => setZkRequest(null));
  }

  function completeRecoveryV3Finalization(
    pending: PendingRecoveryV3Finalization,
    recoveredHints: RootedPassportHints,
    recoveredChainState: RootedCredentialChainState,
  ) {
    const recoveredRef: StoredCredentialRef = {
      ...pending.recoveredCredential,
      status: "active",
      recoveryTxHash: pending.recoveryTxHash ?? pending.recoveredCredential.recoveryTxHash,
      updatedAt: new Date().toISOString(),
    };
    const nextRefs = [
      recoveredRef,
      ...loadCredentialRefs().filter(
        existing => existing.id !== pending.sourceCredentialId && existing.id !== recoveredRef.id,
      ),
    ];
    saveCredentialRefs(nextRefs);
    clearPendingRecoveryV3Finalization();
    setPendingRecoveryFinalization(null);
    setCredentials(nextRefs);
    setCredentialHints(current => ({
      ...current,
      [recoveredRef.id]: {
        status: "loaded",
        hints: recoveredHints,
        chainState: recoveredChainState,
        message: "Recovered notes loaded; chain state confirmed",
      },
    }));
    return recoveredRef;
  }

  async function resumeRecoveryV3Finalization() {
    const activeSession = requireDeployedWallet("resuming Recovery V3 finalization");
    if (!activeSession) return;
    const pending = pendingRecoveryFinalization ?? loadPendingRecoveryV3Finalization();
    if (!pending) {
      setNotice({ tone: "warning", text: "No pending Recovery V3 finalization is stored." });
      return;
    }
    if (!pending.target.publicKey) {
      setNotice({ tone: "danger", text: "Pending recovery is missing the target passkey public key." });
      return;
    }
    const result = await runAction("Resume Recovery V3 finalization", async () => {
      const preparedTarget = await prepareWebAuthnRecoveryTarget({
        wallet: activeSession.wallet,
        userName: pending.target.label ?? defaultPasskeyName("recovery"),
        rpId: window.location.hostname || "localhost",
        publicKeyRecoveryBundle: pending.target.publicKey,
        localTestAccountIndex: env.localTestAccountIndex,
        deployWithLocalTestAccount: env.enableLocalTestBootstrap,
      });
      if (normalizeAddress(preparedTarget.address) !== normalizeAddress(pending.target.address)) {
        throw new Error(
          `Recovered target account mismatch. expected=${pending.target.address} actual=${preparedTarget.address}`,
        );
      }
      if (preparedTarget.deploymentStatus !== "deployed") {
        throw new Error("The pending recovery target is not deployed.");
      }
      const rootCommitment = pending.recoveredCredential.rootCommitment;
      if (!rootCommitment) {
        throw new Error("Pending recovery is missing its authenticated root commitment.");
      }
      const targetClient = new MagnaBrowserClient(
        activeSession.wallet,
        env,
        preparedTarget.address,
      );
      const hints = await targetClient.fetchRootedPassportHintsByClaimsHash(
        preparedTarget.address,
        rootCommitment,
        pending.recoveredCredential.claimsHash,
      );
      if (!isRootedPassportHints(hints)) {
        throw new Error("Recovered destination is missing the complete rooted passport note set.");
      }
      const chainState = await targetClient.readRootedPassportChainState(hints);
      if (chainState.status !== "active") {
        throw new Error(
          `Recovered destination credential is ${chainState.status} at Aztec L2 block ${chainState.checkedAtBlock}.`,
        );
      }
      return {
        targetProfile: {
          ...pending.target,
          address: preparedTarget.address,
          label: preparedTarget.displayName,
          deploymentStatus: preparedTarget.deploymentStatus,
          feePayer: preparedTarget.feePayer,
          sessionOrigin: preparedTarget.materialOrigin,
          lastOpenedAt: new Date().toISOString(),
        } satisfies WalletProfile,
        hints,
        chainState,
      };
    });
    if (!result) return;

    setRecoveryTarget(result.targetProfile);
    saveRecoveryTargetProfile(result.targetProfile);
    setLatestRecoveryBundle(result.targetProfile.publicKey ?? "");
    completeRecoveryV3Finalization(pending, result.hints, result.chainState);
    appendLog(
      `Recovery V3 finalization resumed${pending.recoveryTxHash ? ` for tx ${pending.recoveryTxHash}` : ""}; ` +
        "the complete destination note set is available.",
    );
    setNotice({
      tone: "success",
      text: "Recovery V3 finalization completed from the stored destination-bound metadata.",
    });
    setZkStage("recovery_v3_complete");
  }

  async function startRootRecovery(ref: StoredCredentialRef) {
    const activeSession = requireDeployedWallet("recovery");
    if (!activeSession) return;
    const currentOwnerAddress = requireSessionIdentityAddress(activeSession, env);
    const passportBlock = passportCredentialUsageBlock(ref);
    if (passportBlock) {
      setNotice({ tone: "danger", text: passportBlock });
      return;
    }
    if (!recoveryTarget) {
      setNotice({ tone: "danger", text: "Create or open the new passkey target before recovering root lineage." });
      return;
    }
    if (!isDeployedProfile(recoveryTarget)) {
      setNotice({ tone: "danger", text: "The recovery target is counterfactual. Deploy the target wallet before root recovery." });
      return;
    }
    if (isFeePayerIdentityAddress(recoveryTarget.address, null, recoveryTarget, env)) {
      setNotice({
        tone: "danger",
        text: "The recovery target resolved to the local fee payer/orchestrator account. Create or open the actual passkey target before recovery.",
      });
      return;
    }
    const recoveryTargetAddress = recoveryTarget.address;
    if (!ref.ghostOwner || !ref.rootCommitment) {
      setNotice({ tone: "danger", text: "Root recovery requires ghost owner and root commitment." });
      return;
    }
    if (!isPassportA2Credential(ref) || !ref.issuerAddress) {
      setNotice({ tone: "danger", text: PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE });
      return;
    }
    const localClaimsWitness = ref.passportCommittedClaimsV2Witness;
    if (!localClaimsWitness) {
      setNotice({ tone: "danger", text: PASSPORT_A2_LOCAL_WITNESS_MISSING_MESSAGE });
      return;
    }
    if (!env.zkPassportDevMode) {
      setNotice({ tone: "danger", text: "The current Recovery V3 integration is isolated to Gate B-dev." });
      return;
    }
    if (!env.recoveryV3 || !env.l1RpcUrl || !env.recoveryV3RelayerPrivateKey) {
      setNotice({
        tone: "danger",
        text: "Run npm run recovery-v3:bootstrap:local, then restart the management app with its local L1 RPC/key configuration.",
      });
      return;
    }
    if (window.location.hostname !== env.recoveryV3.domain) {
      setNotice({
        tone: "danger",
        text: `Recovery V3 was bootstrapped for ${env.recoveryV3.domain}, but this app is running on ${window.location.hostname}. Re-bootstrap with the exact browser hostname.`,
      });
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(recoveryTargetAddress) || !/^0x[0-9a-fA-F]{64}$/.test(ref.issuerAddress)) {
      setNotice({ tone: "danger", text: "Recovery V3 requires field-compatible Aztec destination and issuer addresses." });
      return;
    }
    try {
      const drift = await preflightRecoveryV3LocalClock(
        env.l1RpcUrl,
        env.recoveryV3.ethereumChainId,
      );
      appendLog(`Recovery V3 pre-scan local clock check passed (L1-host drift ${drift}s).`);
    } catch (error) {
      const message = errorMessage(error);
      setNotice({ tone: "danger", text: message });
      appendLog(`Recovery V3 pre-scan local clock check failed: ${message}`);
      return;
    }
    const age = localClaimsWitness.minAgeProven;
    const network: RecoveryV3NetworkContext = {
      ethereumChainId: env.recoveryV3.ethereumChainId,
      recoveryPortalL1Address: env.recoveryV3.portalAddress,
      aztecProtocolVersion: env.recoveryV3.aztecProtocolVersion,
      aztecChainId: env.recoveryV3.aztecChainId,
      issuerL2Address: ref.issuerAddress as `0x${string}`,
    };
    const prepared = await prepareRecoveryV3Request(
      network,
      recoveryTargetAddress as `0x${string}`,
    );
    appendLog(`Recovery V3 intent prepared for portal ${env.recoveryV3.portalAddress}.`);
    const request = await runAction("Create zkPassport root recovery request", async () =>
      startPassportZkRequest({
        ageThreshold: age,
        proofMode: proofModeForPassportIssuanceKind("a2"),
        a2BindCustomData: prepared.bindCustomData,
        metadata: {
          name: env.zkPassportRequestName,
          logo: env.zkPassportRequestLogo,
          purpose: env.zkPassportRequestPurpose,
          scope: env.recoveryV3!.scope,
        },
        devMode: true,
        onEvent: handleZkEvent,
      }),
    );
    if (!request) return;
    setZkRequest(request);
    setZkProofCount(0);

    request.completion
      .then(async completion => {
        if (completion.status === "rejected") {
          setNotice({ tone: "warning", text: "zkPassport recovery request was rejected." });
          setZkStage("rejected");
          return;
        }
        // Recovery V3 never sends the authenticated identifier to Magna's API. The
        // dedicated wrapper consumes it only inside the local witness.
        completion.uniqueIdentifier = undefined;
        const outerArtifact = compressedOuterProof(completion);
        const outerArtifactHash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(outerArtifact.proof)),
          ),
          byte => byte.toString(16).padStart(2, "0"),
        ).join("");
        appendLog(
          `Recovery proof metadata: ${outerArtifact.name}@${outerArtifact.version}, VK ${outerArtifact.vkeyHash}, outer-proof SHA-256 ${outerArtifactHash} (raw proof not retained).`,
        );
        setZkStage("building_recovery_v3_witness");
        appendLog("Building the dedicated Recovery V3 developer wrapper witness.");
        setZkStage("generating_recovery_v3_wrapper_proof");
        const artifact = await buildRecoveryV3DeveloperProof(
          completion,
          age,
          network,
          prepared,
          proveRecoveryWrapperInBrowser,
        );
        const authenticatedRoot = artifact.metadata.rootCommitment;
        if (authenticatedRoot !== BigInt(ref.rootCommitment!)) {
          throw new Error(
            `Authenticated passport root does not match the selected Magna lineage. ` +
              `proof=${authenticatedRoot} stored=${ref.rootCommitment}`,
          );
        }
        const ghostPreview = await deriveGhostAccountPreview({
          uniqueIdentifier: artifact.metadata.identityValue.toString(),
          credentialType: CredentialType.Passport,
          derivationVersion: SCOPED_GHOST_DERIVATION_VERSION,
        });
        if (ghostPreview.rootCommitment !== authenticatedRoot) {
          throw new Error("Recovery Ghost/root derivation does not match rooted A2 issuance.");
        }
        if (normalizeAddress(ghostPreview.address) !== normalizeAddress(ref.ghostOwner)) {
          throw new Error(
            `Authenticated passport derives a different Ghost owner. ` +
              `derived=${ghostPreview.address} stored=${ref.ghostOwner}`,
          );
        }
        appendLog("Authenticated recovery identity matches the selected A2 root and Ghost owner.");
        appendLog("Running live private-witness mutation checks against the exact scanned proof.");
        const privateMutations = await assertRecoveryV3PrivateMutationsRejected({
          completion,
          ageThreshold: age,
          network,
          prepared,
          assertRejected: assertRecoveryWrapperWitnessRejectedInBrowser,
        });
        appendLog(`Rejected private mutations: ${privateMutations.join(", ")}.`);
        setZkStage("submitting_recovery_v3_portal");
        appendLog("Submitting the real EVM-target proof directly from the browser; Magna API is not used.");
        const evidence = await submitRecoveryV3DeveloperAuthorization({
          aztecNodeUrl: env.aztecNodeUrl,
          l1RpcUrl: env.l1RpcUrl!,
          relayerPrivateKey: env.recoveryV3RelayerPrivateKey as `0x${string}`,
          network,
          contracts: {
            rootRegistryAddress: env.recoveryV3!.rootRegistryAddress,
            certificateRegistryAddress: env.recoveryV3!.certificateRegistryAddress,
            circuitRegistryAddress: env.recoveryV3!.circuitRegistryAddress,
            recoveryPortalAddress: env.recoveryV3!.portalAddress,
          },
          artifact,
          sdkVerified: true,
        });
        if (evidence.clockSync) {
          appendLog(
            `Local L1/L2 clock synchronized through ${evidence.clockSync.method}: ` +
              `L1 block ${evidence.clockSync.fromBlockNumber} (${evidence.clockSync.fromBlockTimestamp}) -> ` +
              `${evidence.clockSync.toBlockNumber} (${evidence.clockSync.toBlockTimestamp}), ` +
              `result block ${evidence.clockSync.toBlockHash}.`,
          );
        }
        appendLog(`Recovery V3 portal tx: ${evidence.transactionHash}`);
        appendLog(`Recovery wrapper proof keccak256: ${evidence.wrapperProofHash}`);
        appendLog(`Canonical Inbox leaf/index: ${evidence.inboxLeaf} / ${evidence.messageLeafIndex}`);
        appendLog(`Rejected EVM mutations: ${evidence.evmMutationsRejected.join(", ")}; replay rejected.`);

        setZkStage("waiting_recovery_v3_inbox");
        appendLog("Waiting for the canonical Inbox leaf to become provable on Aztec.");
        const inboxWait = await waitForRecoveryV3InboxMessage({
          aztecNodeUrl: env.aztecNodeUrl,
          l1RpcUrl: env.l1RpcUrl!,
          inboxLeaf: evidence.inboxLeaf,
          expectedLeafIndex: evidence.messageLeafIndex,
          enableLocalCheckpointAdvancement:
            env.enableLocalTestBootstrap && network.ethereumChainId === 31_337n,
        });
        if (inboxWait.localCheckpointsAdvanced > 0) {
          appendLog(
            `Advanced ${inboxWait.localCheckpointsAdvanced} official local Aztec checkpoint(s) ` +
              `to ingest the canonical Inbox message.`,
          );
        }
        appendLog("Canonical Inbox membership is available on Aztec.");

        const deploymentAttempts = buildRecoveryGhostDeploymentAttempts({
          feePayer: activeSession.metadata?.feePayer,
          activeAddress: currentOwnerAddress,
          enableLocalTestBootstrap: env.enableLocalTestBootstrap,
          localTestAccountIndex: env.localTestAccountIndex,
        });
        let ghostSession: Awaited<ReturnType<typeof createTransientGhostWalletSession>> | undefined;
        const deploymentErrors: string[] = [];
        for (const deployment of deploymentAttempts) {
          try {
            ghostSession = await createTransientGhostWalletSession({
              nodeUrl: env.aztecNodeUrl,
              uniqueIdentifier: artifact.metadata.identityValue.toString(),
              credentialType: CredentialType.Passport,
              derivationVersion: SCOPED_GHOST_DERIVATION_VERSION,
              ...deployment,
            });
            break;
          } catch (error) {
            deploymentErrors.push(errorMessage(error));
          }
        }
        if (!ghostSession) {
          throw new Error(`Could not prepare the authenticated Ghost account: ${deploymentErrors.join(" | ")}`);
        }
        appendLog("Authenticated Ghost account prepared in an isolated in-memory PXE.");
        let submittedFinalization: PendingRecoveryV3Finalization | undefined;
        try {
          if (normalizeAddress(ghostSession.ghostAddress) !== normalizeAddress(ref.ghostOwner)) {
            throw new Error(
              `Prepared Ghost account does not own the selected recovery note. ` +
                `prepared=${ghostSession.ghostAddress} stored=${ref.ghostOwner}`,
            );
          }
          if (localFundingEnabled && env.l1RpcUrl && env.localFaucetPrivateKey) {
            appendLog("Funding the transient recovery Ghost through the chain-31337 UI faucet.");
            const ghostFunding = await fundLocalFeeJuice({
              wallet: ghostSession.wallet,
              recipient: ghostSession.ghostAddress,
              nodeUrl: env.aztecNodeUrl,
              l1RpcUrl: env.l1RpcUrl,
              l1PrivateKey: env.localFaucetPrivateKey as `0x${string}`,
              localTestAccountIndex: env.localTestAccountIndex,
              onProgress: progress => appendLog(`Local Fee Juice recovery Ghost: ${progress}.`),
            });
            appendLog(
              `Recovery Ghost Fee Juice: ${ghostFunding.balanceBefore.toString()} -> ` +
                `${ghostFunding.balanceAfter.toString()} base units (claim ${ghostFunding.claimTxHash}).`,
            );
          }
          const preparedAt = new Date().toISOString();
          const recoveredCredential: StoredCredentialRef = {
            ...ref,
            id: credentialId({
              ownerAddress: recoveryTargetAddress,
              kind: "passport",
              claimsHash: artifact.metadata.claimsHash.toString(),
              issuerAddress: ref.issuerAddress,
              mode: "rooted",
              rootCommitment: authenticatedRoot.toString(),
            }),
            ownerAddress: recoveryTargetAddress,
            status: "recovery_pending",
            claimsHash: artifact.metadata.claimsHash.toString(),
            rootCommitment: authenticatedRoot.toString(),
            ghostOwner: ghostSession.ghostAddress,
            ghostDerivationVersion: SCOPED_GHOST_DERIVATION_VERSION,
            recoveryTxHash: undefined,
            updatedAt: preparedAt,
            passportCommittedClaimsV2Witness: {
              ...localClaimsWitness,
              nationalityBlind: artifact.metadata.nationalityBlind.toString(),
              expiryBlind: artifact.metadata.expiryBlind.toString(),
            },
          };
          const preparedFinalization: PendingRecoveryV3Finalization = {
            version: 1,
            phase: "prepared",
            sourceCredentialId: ref.id,
            target: recoveryTarget,
            recoveredCredential,
            createdAt: preparedAt,
            updatedAt: preparedAt,
          };
          savePendingRecoveryV3Finalization(preparedFinalization);
          setPendingRecoveryFinalization(preparedFinalization);
          setZkStage("consuming_recovery_v3_inbox");
          const ghostClient = new MagnaBrowserClient(ghostSession.wallet, env, ghostSession.ghostAddress);
          const hintedRootRecovery = await ghostClient.fetchRootRecoveryHint(
            ghostSession.ghostAddress,
            authenticatedRoot,
          );
          const recoveryOutcome = await ghostClient.recoverRootV3(hintedRootRecovery, {
            destination: recoveryTargetAddress,
            nonce: prepared.recoveryNonce,
            claimsHash: artifact.metadata.claimsHash,
            credentialValidUntil: artifact.metadata.credentialValidUntil,
            messageSecret: prepared.messageSecret,
            messageLeafIndex: evidence.messageLeafIndex,
          });
          appendLog(`Recovery V3 Aztec issuer tx: ${recoveryOutcome.txHash}`);
          const submittedAt = new Date().toISOString();
          submittedFinalization = {
            ...preparedFinalization,
            phase: "submitted",
            recoveryTxHash: recoveryOutcome.txHash,
            recoveredCredential: {
              ...recoveredCredential,
              recoveryTxHash: recoveryOutcome.txHash,
              updatedAt: submittedAt,
            },
            updatedAt: submittedAt,
          };
          savePendingRecoveryV3Finalization(submittedFinalization);
          setPendingRecoveryFinalization(submittedFinalization);
          await Promise.all([
            ghostClient.fetchRootRecoveryHint(ghostSession.ghostAddress, authenticatedRoot),
            ghostClient.fetchLinkedRecoveryHint(
              ghostSession.ghostAddress,
              authenticatedRoot,
              artifact.metadata.claimsHash,
            ),
          ]);
          appendLog("Fresh Ghost-owned root and linked recovery notes are discoverable after recovery.");
        } finally {
          await ghostSession.dispose();
          appendLog("Transient Ghost PXE disposed; the active passkey wallet session remains open.");
        }

        if (!submittedFinalization) {
          throw new Error("Recovery V3 issuer transaction did not produce resumable finalization state.");
        }

        const targetClient = new MagnaBrowserClient(activeSession.wallet, env, recoveryTargetAddress);
        const recoveredHints = await targetClient.fetchRootedPassportHintsByClaimsHash(
          recoveryTargetAddress,
          authenticatedRoot,
          artifact.metadata.claimsHash,
        );
        if (!isRootedPassportHints(recoveredHints)) {
          throw new Error("Recovered destination is missing the complete rooted passport note set.");
        }
        const recoveredChainState = await targetClient.readRootedPassportChainState(recoveredHints);
        if (recoveredChainState.status !== "active") {
          throw new Error(
            `Recovered destination credential is ${recoveredChainState.status} at Aztec L2 block ` +
              `${recoveredChainState.checkedAtBlock}.`,
          );
        }
        completeRecoveryV3Finalization(submittedFinalization, recoveredHints, recoveredChainState);
        setNotice({
          tone: "success",
          text: "Recovery V3 completed: the destination-bound Inbox authorization was consumed and the complete rooted passport note set was minted to the target passkey.",
        });
        setZkStage("recovery_v3_complete");
      })
      .catch(error => {
        setNotice({ tone: "danger", text: errorMessage(error) });
        setZkStage("error");
      })
      .finally(() => setZkRequest(null));
  }

  async function readSponsorRights() {
    const result = await runAction("Read sponsor rights", async () =>
      createClient().readSponsorRightsSnapshot(companySponsorAddress),
    );
    if (result) setSponsorSnapshot(result);
  }

  async function inspectSponsorRuntime() {
    const result = await runAction("Inspect sponsor runtime", async () => createClient().getSponsorRuntimeStatuses());
    if (result) setSponsorStatuses(result);
  }

  async function topUpSponsorRights(kind: "l1" | "l2") {
    const result = await runAction(`Top up sponsor rights via ${kind.toUpperCase()}`, async () => {
      const client = createClient();
      const request = {
        sponsorAddress: companySponsorAddress,
        rightsAmount: topUpRightsAmount,
        packageId: topUpPackageId || undefined,
      };
      return kind === "l1"
        ? await client.topUpSponsorRightsFromL1Purchase(request)
        : await client.topUpSponsorRightsFromL2Payment(request);
    });
    if (result) await readSponsorRights();
  }

  async function addSponsorGateway() {
    await runAction("Add sponsor gateway", async () => createClient().addCompanySponsorGateway(gatewayCandidate));
  }

  const page = (() => {
    if (route.path === "/company/login") {
      return (
        <CompanyLogin
          env={env}
          busy={busy}
          session={session}
          profile={walletProfile}
          recoveryBundle={latestRecoveryBundle}
          storedPublicKeyInput={storedPublicKeyInput}
          setStoredPublicKeyInput={setStoredPublicKeyInput}
          onOpen={() => openPasskeyWallet("company")}
          onStored={() => useStoredPasskey("company")}
          onCopyRecoveryBundle={() => void copyRecoveryBundle()}
        />
      );
    }
    if (route.path === "/company") {
      return (
        <CompanyDashboard
          env={env}
          session={session}
          profile={walletProfile}
          sponsorAddress={companySponsorAddress}
          setSponsorAddress={setCompanySponsorAddress}
          snapshot={sponsorSnapshot}
          statuses={sponsorStatuses}
          topUpRightsAmount={topUpRightsAmount}
          setTopUpRightsAmount={setTopUpRightsAmount}
          topUpPackageId={topUpPackageId}
          setTopUpPackageId={setTopUpPackageId}
          gatewayCandidate={gatewayCandidate}
          setGatewayCandidate={setGatewayCandidate}
          onReadRights={() => void readSponsorRights()}
          onInspectRuntime={() => void inspectSponsorRuntime()}
          onTopUpL1={() => void topUpSponsorRights("l1")}
          onTopUpL2={() => void topUpSponsorRights("l2")}
          onAddGateway={() => void addSponsorGateway()}
          busy={busy}
          go={goTo}
        />
      );
    }
    if (route.path === "/user/login") {
      return (
        <UserLogin
          busy={busy}
          passkeyName={newPasskeyName}
          setPasskeyName={setNewPasskeyName}
          storedAccounts={storedPasskeyAccounts}
          missingRememberedWallet={missingRememberedWallet}
          onCreate={() => openPasskeyWallet("user", { forceCreate: true, passkeyName: newPasskeyName })}
          onExisting={account =>
            openPasskeyWallet("user", {
              storedCredentialId: account.credentialId,
              passkeyName: account.displayName,
              expectedAddress: account.address,
            })
          }
          onRestoreRemembered={profile => {
            const publicKeyRecoveryBundle = boundWalletProfileRecoveryBundle(profile);
            if (!publicKeyRecoveryBundle) {
              setNotice({ tone: "danger", text: "The remembered wallet has no valid public passkey recovery value." });
              return;
            }
            void openPasskeyWallet("user", {
              publicKeyRecoveryBundle,
              passkeyName: profile.label,
              expectedAddress: profile.address,
            });
          }}
          onRecovery={() => goTo("/user/recovery")}
        />
      );
    }
    if (route.path === "/user/issue") {
      return (
        <UserFrame
          active="issue"
          activeAddress={activeAddress}
          credentials={activeCredentialRefs}
          session={session}
          profile={walletProfile}
          go={goTo}
          busy={busy}
          onDisconnect={() => void disconnect()}
          onReconnect={() => void openPasskeyWallet("user", { stayOnCurrentPage: true })}
        >
          <Issuance
            busy={busy}
            walletReady={isReadyWallet(session, walletProfile, env)}
            zkRequest={zkRequest}
            zkStage={zkStage}
            zkProofCount={zkProofCount}
            zkPassportIssuanceKind={env.zkPassportIssuanceKind}
            passportA2LocalWitnessAvailable={Boolean(passportA2LocalWitness)}
            ageThreshold={ageThreshold}
            setAgeThreshold={setAgeThreshold}
            instagramHandle={instagramHandle}
            setInstagramHandle={setInstagramHandle}
            instagramEmailFileName={instagramEmailFile?.name ?? ""}
            onInstagramEmailFile={setInstagramEmailFile}
            onReconnect={() => void openPasskeyWallet("user", { stayOnCurrentPage: true })}
            onStartZkPassport={() => void startZkPassportIssuance()}
            onIssueInstagram={() => void issueInstagramCredential()}
          />
        </UserFrame>
      );
    }
    if (route.path === "/user/renewal") {
      return (
        <UserFrame
          active="renewal"
          activeAddress={activeAddress}
          credentials={activeCredentialRefs}
          session={session}
          profile={walletProfile}
          go={goTo}
          busy={busy}
          onDisconnect={() => void disconnect()}
          onReconnect={() => void openPasskeyWallet("user", { stayOnCurrentPage: true })}
        >
          <Renewal
            credentials={activeCredentialRefs}
            hints={credentialHints}
            busy={busy}
            walletReady={isReadyWallet(session, walletProfile, env)}
            zkRequest={zkRequest}
            zkStage={zkStage}
            zkProofCount={zkProofCount}
            onRenew={ref => void startRootedRenewal(ref)}
          />
        </UserFrame>
      );
    }
    if (route.path === "/user/recovery") {
      return (
        <UserFrame
          active="recovery"
          activeAddress={activeAddress}
          credentials={activeCredentialRefs}
          session={session}
          profile={walletProfile}
          go={goTo}
          busy={busy}
          onDisconnect={() => void disconnect()}
          onReconnect={() => void openPasskeyWallet("user", { stayOnCurrentPage: true })}
        >
          <Recovery
            busy={busy}
            walletReady={isReadyWallet(session, walletProfile, env)}
            recoveryTarget={displayedRecoveryTarget}
            recoveredCredentialChainState={recoveredCredentialChainState}
            recoveryTransactionChainState={recoveryTransactionChainState}
            recoveryComplete={Boolean(chainConfirmedRecoveredCredential)}
            passkeyName={recoveryPasskeyName}
            setPasskeyName={setRecoveryPasskeyName}
            localFundingEnabled={localFundingEnabled}
            targetFeeJuiceBalance={
              displayedRecoveryTarget ? feeJuiceBalances[normalizeAddress(displayedRecoveryTarget.address)] : undefined
            }
            pendingRecoveryFinalization={pendingRecoveryFinalization}
            storedPublicKeyInput={storedPublicKeyInput}
            setStoredPublicKeyInput={setStoredPublicKeyInput}
            credentials={activeCredentialRefs}
            hints={credentialHints}
            zkRequest={zkRequest}
            zkStage={zkStage}
            zkProofCount={zkProofCount}
            onCreateTarget={() =>
              openPasskeyWallet("user", {
                captureRecoveryTarget: true,
                forceCreate: true,
                passkeyName: recoveryPasskeyName,
              })
            }
            onStoredTarget={() => useStoredPasskey("user", true)}
            onCopyTargetPublicKey={() => void copyRecoveryBundle()}
            onFundTarget={
              recoveryTarget
                ? () => void fundLocalAddress(recoveryTarget.address, "recovery target")
                : undefined
            }
            onFinalizePending={() => void resumeRecoveryV3Finalization()}
            onOpenTarget={() => void openRecoveredTargetWallet()}
            onRecover={ref => void startRootRecovery(ref)}
          />
        </UserFrame>
      );
    }
    if (route.path === "/user/settings") {
      return (
        <UserFrame
          active="settings"
          activeAddress={activeAddress}
          credentials={activeCredentialRefs}
          session={session}
          profile={walletProfile}
          go={goTo}
          busy={busy}
          onDisconnect={() => void disconnect()}
          onReconnect={() => void openPasskeyWallet("user", { stayOnCurrentPage: true })}
        >
          <Settings
            env={env}
            busy={busy}
            profile={walletProfile}
            session={session}
            recoveryBundle={latestRecoveryBundle}
            localFundingEnabled={localFundingEnabled}
            feeJuiceBalance={activeAddress ? feeJuiceBalances[normalizeAddress(activeAddress)] : undefined}
            onFundActive={() => activeAddress && void fundLocalAddress(activeAddress, "active wallet")}
            onCopyRecoveryBundle={() => void copyRecoveryBundle()}
          />
        </UserFrame>
      );
    }
    if (route.path === "/authorize") {
      return <AuthorizePage />;
    }
    if (route.path === "/user") {
      return (
        <UserFrame
          active="dashboard"
          activeAddress={activeAddress}
          credentials={activeCredentialRefs}
          session={session}
          profile={walletProfile}
          go={goTo}
          busy={busy}
          onDisconnect={() => void disconnect()}
          onReconnect={() => void openPasskeyWallet("user", { stayOnCurrentPage: true })}
        >
          <Dashboard credentials={activeCredentialRefs} hints={credentialHints} hasCredentials={hasCredentials} go={route.go} />
        </UserFrame>
      );
    }
    return <Landing go={route.go} />;
  })();

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-mark" type="button" onClick={() => goTo("/")}>
          MAGNA
        </button>
        <div className="topbar-state" />
      </header>
      {notice ? <div className={`notice ${notice.tone}`}>{notice.text}</div> : null}
      <div className="app-page">{page}</div>
    </div>
  );
}

function WalletStatusPanel(props: {
  env: ManagementEnv;
  session: WalletSession | null;
  profile: WalletProfile | null;
  recoveryBundle: string;
  onCopyRecoveryBundle: () => void;
  localFundingEnabled?: boolean;
  feeJuiceBalance?: string;
  onFund?: () => void;
  busy?: boolean;
}) {
  const identityAddress = walletIdentityAddress(props.session, props.profile, props.env);
  const status = identityAddress ? deploymentStatusFor(props.session, props.profile) : "not opened";
  const isReady = status === "deployed";
  return (
    <article className={`wallet-status-panel ${isReady ? "ready" : "blocked"}`}>
      <div className="card-head">
        <span>Wallet readiness</span>
        <strong>{status}</strong>
      </div>
      <KeyValue label="Wallet name" value={props.profile?.label ?? props.session?.metadata?.passkeyName ?? "legacy unnamed passkey"} />
      <KeyValue label="Address" value={identityAddress ?? "not opened"} />
      <KeyValue label="Session origin" value={sessionOriginFor(props.session, props.profile)} />
      <KeyValue label="Fee payer" value={feePayerFor(props.session, props.profile)} />
      {props.localFundingEnabled ? (
        <div className="local-funding-strip">
          <div>
            <span>Local Fee Juice</span>
            <strong>{feeJuiceBalanceLabel(props.feeJuiceBalance)}</strong>
          </div>
          <button className="secondary" type="button" disabled={props.busy || !isReady} onClick={props.onFund}>
            Fund active wallet
          </button>
        </div>
      ) : null}
      <KeyValue label="Last opened" value={props.profile?.lastOpenedAt ?? "unknown"} />
      {!isReady ? (
        <p className="fine-print danger-text">
          This wallet is not ready for issuance, recovery, sponsor actions, or Login with Magna until deployment is confirmed.
        </p>
      ) : null}
      {props.recoveryBundle ? (
        <div className="recovery-bundle">
          <label>
            Magna passkey public key
            <textarea readOnly value={props.recoveryBundle} />
          </label>
          <button className="secondary" type="button" onClick={props.onCopyRecoveryBundle}>
            Copy public key
          </button>
        </div>
      ) : null}
    </article>
  );
}

function StoredPasskeyInput(props: { value: string; onChange: (value: string) => void }) {
  const inputId = useId();
  return (
    <div className="stored-passkey-input">
      <div className="stored-passkey-head">
        <span>Stored passkey</span>
        <strong>Magna passkey public key</strong>
        <small>Paste the public key copied when this passkey wallet was created. It is not a secret.</small>
      </div>
      <label htmlFor={inputId}>Public key</label>
      <textarea
        id={inputId}
        value={props.value}
        onChange={event => props.onChange(event.target.value)}
        placeholder="04..."
        rows={3}
        spellCheck={false}
      />
      <p>Expected format: uncompressed P-256 public key hex, starting with 04.</p>
    </div>
  );
}

function PasskeyNameInput(props: {
  value: string;
  onChange: (value: string) => void;
  purpose: "wallet" | "recovery";
}) {
  const inputId = useId();
  return (
    <div className="passkey-name-input">
      <label htmlFor={inputId}>New wallet name</label>
      <input
        id={inputId}
        value={props.value}
        onChange={event => props.onChange(event.target.value)}
        maxLength={64}
        autoComplete="off"
        spellCheck={false}
      />
      <small>Passkey name that is being used to create the wallet.</small>
    </div>
  );
}

function WalletBlockBanner(props: { onReconnect?: () => void }) {
  return (
    <div className="wallet-block-banner" role="alert">
      <span>Wallet is counterfactual or the live passkey session is not open. Reopen or deploy the wallet before running this action.</span>
      {props.onReconnect ? (
        <button className="secondary" type="button" onClick={props.onReconnect}>
          Reopen passkey
        </button>
      ) : null}
    </div>
  );
}

function Landing(props: { go: (path: string) => void }) {
  const headline = "Prove who you are, reveal nothing else.";
  return (
    <main className="landing">
      <Threads
        className="threads-bg"
        color={[0.95, 0.5, 0.32]}
        amplitude={1.7}
        distance={0.35}
        enableMouseInteraction
      />
      <section className="landing-hero">
        <p className="eyebrow reveal-up" style={{ animationDelay: "0.05s" }}>Private identity layer</p>
        <h1 className="landing-title">
          {headline.split(" ").map((word, index) => (
            <span className="word" key={`${word}-${index}`} style={{ animationDelay: `${0.15 + index * 0.07}s` }}>
              {word}&nbsp;
            </span>
          ))}
        </h1>
        <p className="hero-copy reveal-up" style={{ animationDelay: "0.78s" }}>
          Magna turns your passport and social proofs into private credentials held in a passkey wallet. Apps get a
          simple yes or no, never your documents.
        </p>
        <div className="hero-actions reveal-up" style={{ animationDelay: "0.92s" }}>
          <button className="magnetic" type="button" onClick={() => props.go("/user/login")}>User Login</button>
          <button className="secondary magnetic" type="button" onClick={() => props.go("/company/login")}>
            Company Login
          </button>
        </div>
      </section>

    </main>
  );
}

function CompanyLogin(props: {
  env: ManagementEnv;
  busy: string | null;
  session: WalletSession | null;
  profile: WalletProfile | null;
  recoveryBundle: string;
  storedPublicKeyInput: string;
  setStoredPublicKeyInput: (value: string) => void;
  onOpen: () => void;
  onStored: () => void;
  onCopyRecoveryBundle: () => void;
}) {
  return (
    <main className="login-split">
      <section>
        <p className="eyebrow">Company operator</p>
        <h1>Sponsorship console login</h1>
        <p className="hero-copy">Open an operator passkey wallet before reading sponsor state or preparing top-ups.</p>
        <WalletStatusPanel
          env={props.env}
          session={props.session}
          profile={props.profile}
          recoveryBundle={props.recoveryBundle}
          onCopyRecoveryBundle={props.onCopyRecoveryBundle}
        />
      </section>
      <section className="action-panel">
        <button type="button" disabled={Boolean(props.busy)} onClick={props.onOpen}>Use company passkey</button>
        <StoredPasskeyInput value={props.storedPublicKeyInput} onChange={props.setStoredPublicKeyInput} />
        <button className="secondary" type="button" disabled={Boolean(props.busy)} onClick={props.onStored}>
          Use stored passkey wallet
        </button>
      </section>
    </main>
  );
}

export function UserLogin(props: {
  busy: string | null;
  passkeyName: string;
  setPasskeyName: (value: string) => void;
  storedAccounts: StoredWebAuthnAccount[];
  missingRememberedWallet: WalletProfile | null;
  onCreate: () => void;
  onExisting: (account: StoredWebAuthnAccount) => void;
  onRestoreRemembered: (profile: WalletProfile) => void;
  onRecovery: () => void;
}) {
  const busy = Boolean(props.busy);
  return (
    <main className="auth-screen">
      <Threads className="threads-bg soft" color={[0.48, 0.85, 0.8]} amplitude={1.1} distance={0.25} />
      <section className="auth-card">
        <p className="eyebrow">Magna wallet</p>
        <h1>Sign in to Magna</h1>
        <p className="auth-sub">
          Choose the wallet you intend to open. Your face or fingerprint unlocks its passkey; private wallet material
          never leaves the authenticator.
        </p>
        {props.storedAccounts.length > 0 ? (
          <div className="stored-wallet-picker" aria-label="Stored Magna wallets">
            <div className="stored-wallet-picker-head">
              <span>Stored wallets</span>
              <small>Choose the passkey account you intend to open.</small>
            </div>
            {props.storedAccounts.map(account => (
              <button
                className="stored-wallet-choice"
                type="button"
                key={account.credentialId}
                disabled={busy}
                onClick={() => props.onExisting(account)}
              >
                <span>
                  <strong>{account.displayName ?? "Legacy unnamed Magna passkey"}</strong>
                  <small>{account.address}</small>
                </span>
                <b>Open</b>
              </button>
            ))}
          </div>
        ) : (
          <p className="auth-empty-wallets">No Magna passkeys are remembered by this browser profile.</p>
        )}
        {props.missingRememberedWallet ? (
          <div className="remembered-wallet-repair">
            <div>
              <span>Previous wallet record</span>
              <strong>{props.missingRememberedWallet.label ?? "Legacy unnamed Magna passkey"}</strong>
              <small>{props.missingRememberedWallet.address}</small>
            </div>
            <p>
              Its passkey lookup entry was replaced by an earlier single-wallet build. Select the matching passkey to
              restore the lookup record; Magna verifies the derived Aztec address before accepting it.
            </p>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => props.onRestoreRemembered(props.missingRememberedWallet!)}
            >
              Restore previous wallet
            </button>
          </div>
        ) : null}
        <div className="create-wallet-panel">
          <div className="create-wallet-panel-head">
            <span>Create a different wallet</span>
            <small>This name applies only to the new passkey.</small>
          </div>
          <PasskeyNameInput value={props.passkeyName} onChange={props.setPasskeyName} purpose="wallet" />
          <div className="auth-actions">
            <button type="button" disabled={busy || !props.passkeyName.trim()} onClick={props.onCreate}>
              {busy ? "Opening wallet\u2026" : "Create new passkey wallet"}
            </button>
          </div>
        </div>
        <button className="auth-link" type="button" disabled={busy} onClick={props.onRecovery}>
          I forgot my account
        </button>
      </section>
    </main>
  );
}

function UserFrame(props: {
  active: "dashboard" | "issue" | "renewal" | "recovery" | "settings";
  activeAddress?: string;
  credentials: StoredCredentialRef[];
  session: WalletSession | null;
  profile: WalletProfile | null;
  go: (path: string) => void;
  busy: string | null;
  onDisconnect: () => void;
  onReconnect: () => void;
  children: React.ReactNode;
}) {
  const tabs = [
    ["dashboard", "/user", "Dashboard"],
    ["renewal", "/user/renewal", "Renewal"],
    ["recovery", "/user/recovery", "Recovery"],
    ["settings", "/user/settings", "Settings"],
  ] as const;
  return (
    <main className="workspace">
      <aside className="sidebar">
        <p className="eyebrow">User surface</p>
        <span>{props.credentials.length} credential{props.credentials.length === 1 ? "" : "s"} in active wallet</span>
        <nav>
          {tabs.map(([id, path, label]) => (
            <button
              key={id}
              type="button"
              className={props.active === id ? "active" : ""}
              aria-current={props.active === id ? "page" : undefined}
              onClick={() => props.go(path)}
            >
              {label}
            </button>
          ))}
          <button type="button" className={props.active === "issue" ? "active" : ""} onClick={() => props.go("/user/issue")}>
            Issue
          </button>
        </nav>
        {props.session ? (
          <button
            className="sidebar-logout"
            type="button"
            disabled={Boolean(props.busy)}
            onClick={props.onDisconnect}
          >
            Log out
          </button>
        ) : props.profile ? (
          <button
            className="sidebar-logout"
            type="button"
            disabled={Boolean(props.busy)}
            onClick={props.onReconnect}
          >
            Reopen passkey
          </button>
        ) : null}
      </aside>
      <section className="workbench">{props.children}</section>
    </main>
  );
}

function Dashboard(props: {
  credentials: StoredCredentialRef[];
  hints: Record<string, CredentialHintState>;
  hasCredentials: boolean;
  go: (path: string) => void;
}) {
  if (!props.hasCredentials) {
    return (
      <section className="dashboard-surface">
        <div className="empty-state">
          <p className="eyebrow">No credentials</p>
          <h2>Issue zkPassport or collect Instagram next.</h2>
          <button type="button" onClick={() => props.go("/user/issue")}>Go to issuance</button>
        </div>
      </section>
    );
  }
  return (
    <section className="dashboard-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h2>Credentials loaded on wallet open</h2>
        </div>
        <button className="secondary" type="button" onClick={() => props.go("/user/issue")}>Issue another</button>
      </div>
      <div className="credential-grid">
        {props.credentials.map(ref => <CredentialCard key={ref.id} refData={ref} hintState={props.hints[ref.id]} />)}
      </div>
    </section>
  );
}

function CredentialCard(props: { refData: StoredCredentialRef; hintState?: CredentialHintState }) {
  const ref = props.refData;
  const passportAuthenticity = passportCredentialAuthenticityLabel(ref);
  const chainGoverned = ref.kind === "passport" && ref.mode === "rooted";
  const displayedStatus = chainGoverned
    ? props.hintState?.chainState?.status ?? (props.hintState?.status === "loading" ? "checking" : "unverified")
    : ref.status.replace(/_/g, " ");
  const chainReason = props.hintState?.chainState
    ? rootedChainStateReasonLabel(props.hintState.chainState.reason)
    : undefined;
  return (
    <article className="credential-card">
      <div className="card-head">
        <span>{ref.kind}</span>
        <strong className={`credential-state credential-state-${displayedStatus.replace(/\s+/g, "-")}`}>
          {displayedStatus}
        </strong>
      </div>
      <KeyValue label="Claims hash" value={ref.claimsHash} />
      {passportAuthenticity ? <KeyValue label="Authenticity" value={passportAuthenticity} /> : null}
      {props.hintState ? <KeyValue label="Hinted notes" value={props.hintState.message ?? props.hintState.status} /> : null}
      {chainReason ? <KeyValue label="Chain state" value={chainReason} /> : null}
      {props.hintState?.chainState ? (
        <KeyValue label="Checked at" value={`Aztec L2 block ${props.hintState.chainState.checkedAtBlock}`} />
      ) : null}
      {ref.mode ? <KeyValue label="Mode" value={ref.mode} /> : null}
      {ref.rootCommitment ? <KeyValue label="Root commitment" value={ref.rootCommitment} /> : null}
      {ref.ghostOwner ? <KeyValue label="Ghost owner" value={ref.ghostOwner} /> : null}
      {ref.passportCommittedClaimsV2Witness ? <KeyValue label="A2 witness" value="available locally" /> : null}
      {ref.normalizedClaims ? (
        <>
          <KeyValue label="Nationality" value={ref.normalizedClaims.nationalityAlpha3} />
          <KeyValue label="Age proof" value={`>= ${ref.normalizedClaims.minAgeProven}`} />
        </>
      ) : null}
      {ref.instagramHandle ? <KeyValue label="Instagram" value={`@${ref.instagramHandle}`} /> : null}
      <KeyValue label="Created" value={new Date(ref.createdAt).toLocaleString()} />
    </article>
  );
}

export function rootedChainStateReasonLabel(reason: RootedCredentialChainState["reason"]): string {
  switch (reason) {
    case "chain-valid":
      return "No credential, root, or authority revocation nullifier exists";
    case "root-lineage-revoked-or-recovered":
      return "Root lineage was revoked or recovered on-chain";
    case "root-authority-superseded":
      return "Root authority was superseded on-chain";
    case "linked-credential-revoked":
      return "Credential was revoked on-chain";
    case "credential-expired":
      return "Credential expired at the checked chain timestamp";
    case "root-authority-expired":
      return "Root authority expired at the checked chain timestamp";
  }
}

function zkUserStatus(stage: string): "pending" | "success" | "failed" {
  if (stage === "issued" || stage === "renewed" || stage === "recovered") return "success";
  if (stage === "error" || stage === "rejected") return "failed";
  return "pending";
}

function zkStatusMessage(status: "pending" | "success" | "failed"): string {
  if (status === "success") return "Success. Credential issuance completed.";
  if (status === "failed") return "Failed. Check the error banner and browser console for details.";
  return "Pending. Credential issuance is being finalized.";
}

export function Issuance(props: {
  busy: string | null;
  walletReady: boolean;
  zkRequest: ActiveZkPassportRequest | null;
  zkStage: string;
  zkProofCount: number;
  zkPassportIssuanceKind: "a2";
  passportA2LocalWitnessAvailable: boolean;
  ageThreshold: string;
  setAgeThreshold: (value: string) => void;
  instagramHandle: string;
  setInstagramHandle: (value: string) => void;
  instagramEmailFileName: string;
  onInstagramEmailFile: (value: File | null) => void;
  onReconnect: () => void;
  onStartZkPassport: () => void;
  onIssueInstagram: () => void;
  initialOpenRail?: CredentialRailId;
}) {
  const [openRail, setOpenRail] = useState<CredentialRailId | null>(props.initialOpenRail ?? null);

  function railBody(rail: CredentialRail) {
    if (rail.id === "passport") {
      const status = zkUserStatus(props.zkStage);
      return (
        <>
          <label>
            Age threshold
            <input value={props.ageThreshold} onChange={event => props.setAgeThreshold(event.target.value)} inputMode="numeric" />
          </label>
          <button type="button" disabled={Boolean(props.busy || props.zkRequest || !props.walletReady)} onClick={props.onStartZkPassport}>
            Start zkPassport issuance
          </button>
          <div className={`zk-status-card ${status === "success" ? "success" : status === "failed" ? "danger" : ""}`}>
            <KeyValue label="Status" value={status} />
            <KeyValue label="zkPassport stage" value={props.zkStage} />
            <KeyValue label="Proofs generated" value={String(props.zkProofCount)} />
            <KeyValue
              label="A2 wrapper status"
              value="local recursive proving enabled"
            />
            <KeyValue
              label="A2 local witness"
              value={props.passportA2LocalWitnessAvailable ? "available locally" : "not retained"}
            />
            <p>{zkStatusMessage(status)}</p>
          </div>
          {props.zkRequest ? (
            <div className="qr-block">
              <QRCode value={props.zkRequest.url} size={168} />
              <a href={props.zkRequest.url} target="_blank" rel="noreferrer">Open request link</a>
            </div>
          ) : null}
          {!props.walletReady ? (
            <button className="secondary" type="button" disabled={Boolean(props.busy)} onClick={props.onReconnect}>
              Reopen passkey wallet
            </button>
          ) : null}
        </>
      );
    }
    if (rail.id === "instagram") {
      return (
        <>
          <label>
            Instagram handle
            <input
              value={props.instagramHandle}
              onChange={event => props.setInstagramHandle(event.target.value)}
              placeholder="@magnasocial"
            />
          </label>
          <label>
            Instagram .eml
            <input
              type="file"
              accept=".eml,message/rfc822,text/plain"
              onChange={event => props.onInstagramEmailFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {props.instagramEmailFileName ? <KeyValue label="Selected email" value={props.instagramEmailFileName} /> : null}
          <button type="button" disabled={Boolean(props.busy || !props.walletReady)} onClick={props.onIssueInstagram}>
            Issue Instagram credential
          </button>
          <p className="fine-print">
            Your browser verifies the .eml and generates the proof locally. Neither the email nor the Instagram
            handle leaves this device; Magna API receives only the proof and its proof-bound public fields, including
            the blinded handle commitment.
          </p>
        </>
      );
    }
    return (
      <div className="coming-soon-panel">
        <span>Coming Soon</span>
        <p>
          This credential rail is reserved, but the issuer inputs and verification handoff are not finalized yet.
        </p>
        <button className="secondary" type="button" disabled>
          Input contract pending
        </button>
      </div>
    );
  }

  return (
    <section className="issuance-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Credential issuance</p>
          <h2>Choose a credential rail</h2>
        </div>
      </div>
      {!props.walletReady ? <WalletBlockBanner onReconnect={props.onReconnect} /> : null}
      <div className="issue-rail-list">
        {ISSUANCE_RAILS.map(rail => {
          const isOpen = openRail === rail.id;
          const panelId = `issue-rail-${rail.id}`;
          return (
            <article className={`issue-card issue-rail ${isOpen ? "open" : ""}`} key={rail.id}>
              <button
                className="issue-rail-trigger"
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenRail(current => (current === rail.id ? null : rail.id))}
              >
                <span className="issue-rail-kicker">{rail.eyebrow}</span>
                <span className="issue-rail-main">
                  <span>
                    <strong>{rail.title}</strong>
                    <small>{rail.summary}</small>
                  </span>
                  <span className="issue-rail-proof">{rail.proofLabel}</span>
                </span>
                <span className={`issue-rail-status ${rail.status}`}>{rail.status === "live" ? "Live" : "Coming Soon"}</span>
                <span className="issue-rail-toggle" aria-hidden="true">{isOpen ? "Close" : "Issue"}</span>
              </button>
              {isOpen ? (
                <div className="issue-rail-body" id={panelId}>
                  {railBody(rail)}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Renewal(props: {
  credentials: StoredCredentialRef[];
  hints: Record<string, CredentialHintState>;
  busy: string | null;
  walletReady: boolean;
  zkRequest: ActiveZkPassportRequest | null;
  zkStage: string;
  zkProofCount: number;
  onRenew: (ref: StoredCredentialRef) => void;
}) {
  const rootedPassport = props.credentials.find(ref => ref.kind === "passport" && ref.mode === "rooted");
  const hintState = rootedPassport ? props.hints[rootedPassport.id] : undefined;
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Renewal</p>
          <h2>{rootedPassport ? "Renew rooted passport authority" : "No rooted passport credential found."}</h2>
        </div>
      </div>
      {!props.walletReady ? <WalletBlockBanner /> : null}
      {rootedPassport ? (
        <article className="credential-card">
          <KeyValue label="Claims hash" value={rootedPassport.claimsHash} />
          <KeyValue label="Root commitment" value={rootedPassport.rootCommitment ?? "missing"} />
          <KeyValue label="Ghost owner" value={rootedPassport.ghostOwner ?? "missing"} />
          <KeyValue label="Hinted notes" value={hintState?.message ?? hintState?.status ?? "not loaded"} />
          <KeyValue label="zkPassport stage" value={props.zkStage} />
          <KeyValue label="Proofs generated" value={String(props.zkProofCount)} />
          <button
            type="button"
            disabled={Boolean(
              props.busy ||
                !props.walletReady ||
                props.zkRequest ||
                hintState?.chainState?.status !== "active" ||
                !hintState?.hints ||
                !isRootedPassportHints(hintState.hints),
            )}
            onClick={() => props.onRenew(rootedPassport)}
          >
            Start zkPassport renewal
          </button>
        </article>
      ) : null}
    </section>
  );
}

export function Recovery(props: {
  busy: string | null;
  walletReady: boolean;
  recoveryTarget: WalletProfile | null;
  recoveryComplete?: boolean;
  recoveredCredentialChainState?: RootedCredentialChainState;
  recoveryTransactionChainState?: RecoveryTransactionChainState | null;
  passkeyName: string;
  setPasskeyName: (value: string) => void;
  localFundingEnabled?: boolean;
  targetFeeJuiceBalance?: string;
  pendingRecoveryFinalization?: PendingRecoveryV3Finalization | null;
  storedPublicKeyInput: string;
  setStoredPublicKeyInput: (value: string) => void;
  credentials: StoredCredentialRef[];
  hints: Record<string, CredentialHintState>;
  zkRequest: ActiveZkPassportRequest | null;
  zkStage: string;
  zkProofCount: number;
  onCreateTarget: () => void;
  onStoredTarget: () => void;
  onCopyTargetPublicKey: () => void;
  onFundTarget?: () => void;
  onFinalizePending?: () => void;
  onOpenTarget: () => void;
  onRecover: (ref: StoredCredentialRef) => void;
}) {
  const rootedPassport = props.credentials.find(ref => ref.kind === "passport" && ref.mode === "rooted");
  const hintState = rootedPassport ? props.hints[rootedPassport.id] : undefined;
  const recoveryComplete =
    props.recoveryComplete &&
    props.recoveredCredentialChainState?.status === "active" &&
    props.recoveryTransactionChainState?.status === "confirmed" &&
    Boolean(props.recoveryTarget);
  return (
    <section className="recovery-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Recovery</p>
          <h2>Create the new owner before rotating credentials</h2>
        </div>
      </div>
      {!props.walletReady ? <WalletBlockBanner /> : null}
      {recoveryComplete && props.recoveryTarget ? (
        <article className="recovery-complete-state recovery-complete-banner" role="status">
          <p className="eyebrow">Rotation complete</p>
          <h4>The passport credential now belongs to the new passkey.</h4>
          <p>
            The source wallet remains open only as the previous session. Its credential count is zero because the old
            root lineage was consumed on-chain.
          </p>
          <KeyValue
            label="Recovery transaction"
            value={`Successful at Aztec L2 block ${props.recoveryTransactionChainState?.blockNumber ?? "unknown"}`}
          />
          <KeyValue
            label="Chain verification"
            value={`Active at Aztec L2 block ${props.recoveredCredentialChainState?.checkedAtBlock ?? "unknown"}`}
          />
          <KeyValue label="Recovered owner" value={props.recoveryTarget.address} />
          <KeyValue label="Recovered wallet" value={props.recoveryTarget.label ?? "recovered passkey"} />
          {props.recoveryTarget.publicKey ? (
            <button type="button" disabled={Boolean(props.busy)} onClick={props.onOpenTarget}>
              Open recovered wallet
            </button>
          ) : (
            <p className="fine-print danger-text">
              Paste the target public key below and choose “Use stored passkey target” once. Magna will verify that it
              derives this exact recovered owner before enabling the wallet switch.
            </p>
          )}
        </article>
      ) : null}
      <div className="issue-grid">
        <article className="issue-card">
          <h3>New passkey target</h3>
          <PasskeyNameInput value={props.passkeyName} onChange={props.setPasskeyName} purpose="recovery" />
          <button
            type="button"
            disabled={Boolean(props.busy || !props.walletReady || !props.passkeyName.trim())}
            onClick={props.onCreateTarget}
          >
            Create new passkey target
          </button>
          <StoredPasskeyInput value={props.storedPublicKeyInput} onChange={props.setStoredPublicKeyInput} />
          <button className="secondary" type="button" disabled={Boolean(props.busy || !props.walletReady)} onClick={props.onStoredTarget}>
            Use stored passkey target
          </button>
          {props.recoveryTarget ? (
            <>
              <KeyValue label="Target address" value={props.recoveryTarget.address} />
              <KeyValue label="Target wallet name" value={props.recoveryTarget.label ?? "legacy unnamed passkey"} />
              <KeyValue label="Target deployment" value={props.recoveryTarget.deploymentStatus ?? "unknown"} />
              <KeyValue label="Target fee payer" value={props.recoveryTarget.feePayer ?? "not configured"} />
              {props.localFundingEnabled ? (
                <div className="local-funding-strip">
                  <div>
                    <span>Target Fee Juice</span>
                    <strong>{feeJuiceBalanceLabel(props.targetFeeJuiceBalance)}</strong>
                  </div>
                  <button
                    className="secondary"
                    type="button"
                    disabled={Boolean(props.busy || !props.onFundTarget)}
                    onClick={props.onFundTarget}
                  >
                    Fund recovery target
                  </button>
                </div>
              ) : null}
              {props.recoveryTarget.publicKey ? (
                <div className="recovery-bundle">
                  <label>
                    Target passkey public key
                    <textarea readOnly value={props.recoveryTarget.publicKey} />
                  </label>
                  <button className="secondary" type="button" onClick={props.onCopyTargetPublicKey}>
                    Copy target public key
                  </button>
                  <button type="button" disabled={Boolean(props.busy)} onClick={props.onOpenTarget}>
                    Open saved recovery target
                  </button>
                  <p className="fine-print">
                    The saved target identifies the passkey to open. Credential validity is independently checked from
                    Aztec after the wallet is opened.
                  </p>
                </div>
              ) : (
                <>
                  <KeyValue label="Target public key" value="not available" />
                  <p className="fine-print danger-text">
                    This browser does not have the target public-key bundle. Paste that target's bundle above; the
                    derived address must match before Magna will save or open it.
                  </p>
                </>
              )}
            </>
          ) : null}
        </article>
        <article className="issue-card">
          <h3>Root rotation</h3>
          {props.pendingRecoveryFinalization ? (
            <div className="recovery-bundle">
              <KeyValue label="Pending finalization" value={props.pendingRecoveryFinalization.phase} />
              <KeyValue label="Pending target" value={props.pendingRecoveryFinalization.target.address} />
              <KeyValue
                label="Recovery transaction"
                value={props.pendingRecoveryFinalization.recoveryTxHash ?? "submission status unknown"}
              />
              <button
                className="secondary"
                type="button"
                disabled={Boolean(props.busy || !props.walletReady)}
                onClick={props.onFinalizePending}
              >
                Resume destination note finalization
              </button>
            </div>
          ) : null}
          {!recoveryComplete ? (
            <>
              <KeyValue label="Rooted credential" value={rootedPassport?.claimsHash ?? "missing"} />
              <KeyValue label="Hinted notes" value={hintState?.message ?? hintState?.status ?? "not loaded"} />
              <KeyValue label="zkPassport stage" value={props.zkStage} />
              <KeyValue label="Proofs generated" value={String(props.zkProofCount)} />
              <button
                type="button"
                disabled={Boolean(
                  props.busy ||
                    !props.walletReady ||
                    props.zkRequest ||
                    !props.recoveryTarget ||
                    !isDeployedProfile(props.recoveryTarget) ||
                    !rootedPassport ||
                    hintState?.chainState?.status !== "active" ||
                    !hintState?.hints ||
                    !isRootedPassportHints(hintState.hints),
                )}
                onClick={() => rootedPassport && props.onRecover(rootedPassport)}
              >
                Recover root to target
              </button>
            </>
          ) : null}
          {props.zkRequest ? (
            <div className="qr-block">
              <QRCode value={props.zkRequest.url} size={168} />
              <a href={props.zkRequest.url} target="_blank" rel="noreferrer">Open request link</a>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}

function Settings(props: {
  env: ManagementEnv;
  busy: string | null;
  profile: WalletProfile | null;
  session: WalletSession | null;
  recoveryBundle: string;
  localFundingEnabled: boolean;
  feeJuiceBalance?: string;
  onFundActive: () => void;
  onCopyRecoveryBundle: () => void;
}) {
  const identityAddress = walletIdentityAddress(props.session, props.profile, props.env);
  return (
    <section className="settings-surface">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Wallet and derivation context</h2>
        </div>
      </div>
      <div className="settings-grid">
        <WalletStatusPanel
          env={props.env}
          session={props.session}
          profile={props.profile}
          recoveryBundle={props.recoveryBundle}
          onCopyRecoveryBundle={props.onCopyRecoveryBundle}
          localFundingEnabled={props.localFundingEnabled}
          feeJuiceBalance={props.feeJuiceBalance}
          onFund={props.onFundActive}
          busy={Boolean(props.busy)}
        />
        <article className="credential-card">
          <KeyValue label="Address" value={identityAddress ?? "not connected"} />
          <KeyValue label="Wallet kind" value={props.profile?.walletKind ?? "unknown"} />
          <KeyValue label="Created at" value={props.profile?.createdAt ?? "unknown"} />
          <KeyValue label="Deployment" value={identityAddress ? deploymentStatusFor(props.session, props.profile) : "not opened"} />
          <KeyValue label="Session origin" value={sessionOriginFor(props.session, props.profile)} />
          <KeyValue label="Fee payer" value={feePayerFor(props.session, props.profile)} />
          <KeyValue label="RP ID" value={props.profile?.rpId ?? "unknown"} />
          <KeyValue label="Origin" value={props.profile?.origin ?? window.location.origin} />
          <KeyValue label="Public key" value={props.profile?.publicKey ?? "not available"} />
        </article>
      </div>
    </section>
  );
}

function CompanyDashboard(props: {
  env: ReturnType<typeof getManagementEnv>;
  session: WalletSession | null;
  profile: WalletProfile | null;
  sponsorAddress: string;
  setSponsorAddress: (value: string) => void;
  snapshot: SponsorRightsSnapshot | null;
  statuses: SponsorRuntimeStatus[];
  topUpRightsAmount: string;
  setTopUpRightsAmount: (value: string) => void;
  topUpPackageId: string;
  setTopUpPackageId: (value: string) => void;
  gatewayCandidate: string;
  setGatewayCandidate: (value: string) => void;
  onReadRights: () => void;
  onInspectRuntime: () => void;
  onTopUpL1: () => void;
  onTopUpL2: () => void;
  onAddGateway: () => void;
  busy: string | null;
  go: (path: string) => void;
}) {
  if (!props.session) {
    return (
      <main className="empty-state">
        <p className="eyebrow">Company</p>
        <h2>Connect an operator wallet.</h2>
        <button type="button" onClick={() => props.go("/company/login")}>Company login</button>
      </main>
    );
  }
  const walletReady = isReadyWallet(props.session, props.profile, props.env);
  const identityAddress = walletIdentityAddress(props.session, props.profile, props.env);
  return (
    <main className="company-grid">
      <section className="section-heading wide-heading">
        <div>
          <p className="eyebrow">Sponsor operations</p>
          <h1>Company sponsorship dashboard</h1>
        </div>
      </section>
      <article className="credential-card">
        <h3>Sponsor identity</h3>
        <KeyValue label="Operator" value={identityAddress ?? "not connected"} />
        <KeyValue label="Deployment" value={identityAddress ? deploymentStatusFor(props.session, props.profile) : "not opened"} />
        <KeyValue label="Session origin" value={sessionOriginFor(props.session, props.profile)} />
        <KeyValue label="Fee payer" value={feePayerFor(props.session, props.profile)} />
        <KeyValue label="Active sponsor" value={props.env.activeCompanySponsorAddress ?? "not configured"} />
        <KeyValue label="Sponsor count" value={String(props.env.companySponsors.length)} />
        {!walletReady ? <WalletBlockBanner /> : null}
      </article>
      <article className="credential-card">
        <h3>Rights balance</h3>
        <label>
          Sponsor address
          <select value={props.sponsorAddress} onChange={event => props.setSponsorAddress(event.target.value)}>
            {props.env.companySponsors.length === 0 ? <option value="">No sponsor configured</option> : null}
            {props.env.companySponsors.map(sponsor => (
              <option key={sponsor.address} value={sponsor.address}>{sponsor.address}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={Boolean(props.busy || !walletReady || !props.sponsorAddress)} onClick={props.onReadRights}>
          Read sponsor rights
        </button>
        {props.snapshot ? (
          <>
            <KeyValue label="Remaining" value={props.snapshot.remainingVerifies.toString()} />
            <KeyValue label="Consumed" value={props.snapshot.consumedVerifies.toString()} />
            <KeyValue label="Next purchase id" value={props.snapshot.nextPurchaseId.toString()} />
            <KeyValue label="Price per verify" value={props.snapshot.l2PricePerVerify.toString()} />
          </>
        ) : null}
      </article>
      <article className="credential-card">
        <h3>Top-up</h3>
        <KeyValue label="Rights registry" value={props.env.rightsRegistryAddress ?? "not configured"} />
        <KeyValue label="Purchase contract" value={props.env.rightsPurchaseL2Address ?? "not configured"} />
        <label>
          Rights amount
          <input value={props.topUpRightsAmount} onChange={event => props.setTopUpRightsAmount(event.target.value)} inputMode="numeric" />
        </label>
        <label>
          Package id
          <input value={props.topUpPackageId} onChange={event => props.setTopUpPackageId(event.target.value)} placeholder="optional" />
        </label>
        <button type="button" disabled={Boolean(props.busy || !walletReady || !props.sponsorAddress)} onClick={props.onTopUpL1}>Top up via L1</button>
        <button className="secondary" type="button" disabled={Boolean(props.busy || !walletReady || !props.sponsorAddress)} onClick={props.onTopUpL2}>
          Top up via L2
        </button>
      </article>
      <article className="credential-card">
        <h3>Admin</h3>
        <KeyValue label="Real sends" value={props.env.requireRealSends ? "enabled" : "disabled"} />
        <button type="button" disabled={Boolean(props.busy || !walletReady)} onClick={props.onInspectRuntime}>Inspect compatibility</button>
        <label>
          Gateway address
          <input value={props.gatewayCandidate} onChange={event => props.setGatewayCandidate(event.target.value)} />
        </label>
        <button className="secondary" type="button" disabled={Boolean(props.busy || !walletReady || !props.gatewayCandidate)} onClick={props.onAddGateway}>
          Add sponsor gateway
        </button>
        {props.statuses.map(status => (
          <div key={status.sponsorAddress} className="runtime-row">
            <KeyValue label="Sponsor" value={status.sponsorAddress} />
            <KeyValue label="Issuer authorized" value={String(status.isIssuerAuthorized ?? "unknown")} />
            <KeyValue label="Active default" value={String(status.isActiveDefault)} />
          </div>
        ))}
      </article>
    </main>
  );
}

function KeyValue(props: { label: string; value: string }) {
  return (
    <div className="kv">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
