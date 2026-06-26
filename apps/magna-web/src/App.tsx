import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import {
  type ContractCompatibilityMatrix,
  CredentialType,
  createDefaultPassportClaimsForm,
  createDefaultPolicyForm,
  deriveGhostAccountPreview,
  issuePassportWithDevOrchestrator,
  type L1TopUpOutcome,
  type L2TopUpOutcome,
  MagnaBrowserClient,
  type PassportHints,
  type PassportClaimsForm,
  type PolicyForm,
  type RootedPassportHints,
  type SponsorRuntimeStatus,
  type SponsorRightsSnapshot,
  isRootedPassportHints,
} from "./lib/magna";
import {
  getPasskeyCapability,
  type PasskeyCapability,
  type PasskeyCredentialRecord,
} from "./lib/passkey";
import { getAppEnv } from "./lib/env";
import { getChainInfo } from "./lib/aztec";
import {
  bindExternalProviderDisconnect,
  beginExternalWalletConnection,
  confirmExternalWalletConnection,
  createTransientGhostWalletSession,
  createManagedWalletSession,
  createWebAuthnWalletSession,
  ensureGhostAccountLifecycle,
  startExternalWalletDiscovery,
  type ExternalWalletDiscovery,
  type GhostAccountLifecycleResult,
  type ManagedAccountFlavor,
  type PendingExternalWalletConnection,
  type WalletProvider,
  type WalletSession,
} from "./lib/wallet";
import {
  startPassportZkRequest,
  verifyAndRefreshRootAuthorityThroughBackend,
  verifyRootRecoveryPreflightThroughBackend,
  verifyAndIssuePassportPilotThroughBackend,
  verifyAndIssueThroughBackend,
  type ActiveZkPassportRequest,
  type VerifyAndIssuePassportPilotResponse as ZkPassportPilotIssueResponse,
  type VerifyAndIssueResponse as ZkPassportIssueResponse,
  type VerifyRootRecoveryPreflightResponse as ZkPassportRecoveryPreflightResponse,
  type VerifyAndRefreshRootAuthorityResponse as ZkPassportRenewalResponse,
  type ZkPassportLifecycleEvent,
} from "./lib/zkpassport";
import {
  issuePassportThroughConfiguredBackend,
  passportPilotCredentialUsageBlock,
  proofModeForPassportIssuanceKind,
  type PassportIssuanceKind,
} from "./lib/passport-issuance";

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function nowStamp(): string {
  return new Date().toLocaleTimeString();
}

function logExternalWalletUi(step: string, details?: Record<string, unknown>) {
  if (details) {
    console.info("[magna][external-wallet-ui]", step, details);
    return;
  }
  console.info("[magna][external-wallet-ui]", step);
}

function readReceiptValue(receipt: unknown, key: string): string | undefined {
  if (!receipt || typeof receipt !== "object") {
    return undefined;
  }
  const value = Reflect.get(receipt, key);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && "toString" in value) {
    return String(value.toString());
  }
  return undefined;
}

function describeTxOutcome(
  label: string,
  outcome: { txHash?: string; receipt: unknown },
): string {
  const parts = [`${label} succeeded.`];
  if (outcome.txHash) {
    parts.push(`Tx: ${outcome.txHash}`);
  }

  const blockNumber = readReceiptValue(outcome.receipt, "blockNumber");
  if (blockNumber) {
    parts.push(`Block: ${blockNumber}`);
  }

  const status = readReceiptValue(outcome.receipt, "status");
  if (status) {
    parts.push(`Status: ${status}`);
  }

  const executionResult = readReceiptValue(outcome.receipt, "executionResult");
  if (executionResult) {
    parts.push(`Execution: ${executionResult}`);
  }

  const transactionFee = readReceiptValue(outcome.receipt, "transactionFee");
  if (transactionFee) {
    parts.push(`Fee: ${transactionFee}`);
  }

  return parts.join(" ");
}

function formatHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function resolveGhostDerivationVersion(
  value: string | undefined,
  fallback: "v1_legacy_unscoped" | "v2_scoped",
): "v1_legacy_unscoped" | "v2_scoped" {
  if (value === "v1_legacy_unscoped" || value === "v2_scoped") {
    return value;
  }
  return fallback;
}

const CHAIN_FINGERPRINT_STORAGE_KEY = "magna-web:chain-fingerprint:v1";
const PASSKEY_RECORD_STORAGE_KEY = "magna-web:passkey-record:v1";
const WEB_AUTHN_ACCOUNT_STORAGE_KEY = "magna-webauthn-accounts-v1";
const LAST_ISSUED_PASSPORT_STORAGE_KEY = "magna-web:last-issued-passport:v1";
const TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS = [
  "Invalid tx: Invalid expiration timestamp",
  "Invalid tx: Block header not found",
  "Tx dropped by P2P node",
] as const;
const TRANSIENT_LOCAL_NETWORK_TX_RETRY_ATTEMPTS = 3;
const TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS = 250;

type ActivityLogEntry = {
  id: number;
  message: string;
};

type LastIssuedPassportRef = {
  ownerAddress: string;
  claimsHash: string;
  mode: "passport" | "rooted";
  issuanceKind?: PassportIssuanceKind;
  rootCommitment?: string;
  ghostOwner?: string;
  ghostDerivationVersion?: string;
  normalizedClaims?: ZkPassportIssueResponse["normalizedClaims"];
};

type ZkPassportIssueState =
  | (ZkPassportIssueResponse & { issuanceKind: "legacy" })
  | (ZkPassportPilotIssueResponse & { issuanceKind: "pilot" });

function fingerprintFromChainContext(
  chain: { chainId: string; version: string },
  env: ReturnType<typeof getAppEnv>,
): string {
  return JSON.stringify({
    chainId: chain.chainId,
    version: chain.version,
    nodeUrl: env.aztecNodeUrl,
    issuerAddress: env.issuerAddress ?? "",
    rightsRegistryAddress: env.rightsRegistryAddress ?? "",
    rightsPurchaseL2Address: env.rightsPurchaseL2Address ?? "",
    companySponsorAddresses: [...env.companySponsorAddresses].sort(),
  });
}

function loadStoredPasskeyRecord(): PasskeyCredentialRecord | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(PASSKEY_RECORD_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PasskeyCredentialRecord>;
    if (typeof parsed.credentialId !== "string" || !parsed.credentialId) {
      return null;
    }
    return {
      credentialId: parsed.credentialId,
      rpId: typeof parsed.rpId === "string" ? parsed.rpId : "unknown",
      userName: typeof parsed.userName === "string" ? parsed.userName : "magna-passkey-user",
      authenticatorAttachment:
        typeof parsed.authenticatorAttachment === "string" ? parsed.authenticatorAttachment : undefined,
      publicKeyAlgorithm: typeof parsed.publicKeyAlgorithm === "number" ? parsed.publicKeyAlgorithm : undefined,
      transports: Array.isArray(parsed.transports)
        ? parsed.transports.filter((entry): entry is string => typeof entry === "string")
        : [],
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function loadStoredLastIssuedPassportRef(): LastIssuedPassportRef | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LAST_ISSUED_PASSPORT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LastIssuedPassportRef>;
    if (
      typeof parsed.ownerAddress !== "string" ||
      !parsed.ownerAddress ||
      typeof parsed.claimsHash !== "string" ||
      !parsed.claimsHash ||
      (parsed.mode !== "passport" && parsed.mode !== "rooted")
    ) {
      return null;
    }
    return {
      ownerAddress: parsed.ownerAddress,
      claimsHash: parsed.claimsHash,
      mode: parsed.mode,
      issuanceKind:
        parsed.issuanceKind === "legacy" || parsed.issuanceKind === "pilot" || parsed.issuanceKind === "a1"
          ? parsed.issuanceKind
          : undefined,
      rootCommitment: typeof parsed.rootCommitment === "string" ? parsed.rootCommitment : undefined,
      ghostOwner: typeof parsed.ghostOwner === "string" ? parsed.ghostOwner : undefined,
      ghostDerivationVersion:
        typeof parsed.ghostDerivationVersion === "string" ? parsed.ghostDerivationVersion : undefined,
      normalizedClaims:
        parsed.normalizedClaims &&
        typeof parsed.normalizedClaims === "object" &&
        typeof parsed.normalizedClaims.nationalityAlpha3 === "string" &&
        typeof parsed.normalizedClaims.minAgeProven === "number" &&
        typeof parsed.normalizedClaims.passportExpiryDate === "string" &&
        typeof parsed.normalizedClaims.expiryTs === "string"
          ? parsed.normalizedClaims
          : undefined,
    };
  } catch {
    return null;
  }
}

function claimsFormFromNormalizedClaims(normalizedClaims: ZkPassportIssueResponse["normalizedClaims"]): PassportClaimsForm {
  return {
    nationalityAlpha3: normalizedClaims.nationalityAlpha3,
    ageThreshold: String(normalizedClaims.minAgeProven),
    passportExpiryDate: normalizedClaims.passportExpiryDate,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientLocalNetworkTxError(error: unknown): boolean {
  const details = error instanceof Error ? error.message : String(error);
  return TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS.some(marker => details.includes(marker));
}

export function App() {
  const env = useMemo(() => getAppEnv(), []);
  const configuredSponsors = useMemo(() => env.companySponsors, [env]);

  // Warm up the Schnorr WASM on mount so the first real ghost-address derivation
  // from user input is instant rather than blocked on a cold WASM initialisation.
  useEffect(() => {
    void deriveGhostAccountPreview({
      uniqueIdentifier: "__warmup__",
      credentialType: CredentialType.Passport,
    }).catch(() => {});
  }, []);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("App initialized.");
  const [error, setError] = useState<string | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [providers, setProviders] = useState<WalletProvider[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<PendingExternalWalletConnection | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [managedAlias, setManagedAlias] = useState<string>("magna-user");
  const [managedFlavor, setManagedFlavor] = useState<ManagedAccountFlavor>("schnorr");
  const [ghostOwner, setGhostOwner] = useState<string>("");
  const [claimsForm, setClaimsForm] = useState<PassportClaimsForm>(createDefaultPassportClaimsForm);
  const [policyForm, setPolicyForm] = useState<PolicyForm>(createDefaultPolicyForm);
  const [hints, setHints] = useState<PassportHints | RootedPassportHints | null>(null);
  const [selectedSponsorAddress, setSelectedSponsorAddress] = useState<string>(
    env.activeCompanySponsorAddress ?? env.companySponsors[0]?.address ?? "",
  );
  const [rightsSponsorAddress, setRightsSponsorAddress] = useState<string>(
    env.activeCompanySponsorAddress ?? env.companySponsors[0]?.address ?? "",
  );
  const [sponsorRuntimeStatuses, setSponsorRuntimeStatuses] = useState<SponsorRuntimeStatus[]>([]);
  const [gatewayCandidateAddress, setGatewayCandidateAddress] = useState<string>("");
  const [rightsTopUpAmount, setRightsTopUpAmount] = useState<string>("1");
  const [rightsPackageId, setRightsPackageId] = useState<string>("");
  const [rightsExtraPolicyHash, setRightsExtraPolicyHash] = useState<string>("");
  const [rightsSnapshot, setRightsSnapshot] = useState<SponsorRightsSnapshot | null>(null);
  const [lastL1TopUpOutcome, setLastL1TopUpOutcome] = useState<L1TopUpOutcome | null>(null);
  const [lastTopUpOutcome, setLastTopUpOutcome] = useState<L2TopUpOutcome | null>(null);
  const [compatibilityMatrix, setCompatibilityMatrix] = useState<ContractCompatibilityMatrix | null>(null);
  const [ghostIdentifierInput, setGhostIdentifierInput] = useState<string>("");
  const [ghostCredentialType, setGhostCredentialType] = useState<CredentialType>(CredentialType.Passport);
  const [ghostMaterialPreview, setGhostMaterialPreview] = useState<{
    address: string;
    scope: string;
    seedField: string;
    rootCommitment: string;
  } | null>(null);
  const [passkeyCapability, setPasskeyCapability] = useState<PasskeyCapability | null>(null);
  const [passkeyRecord, setPasskeyRecord] = useState<PasskeyCredentialRecord | null>(() => loadStoredPasskeyRecord());
  const [chainIdentityLabel, setChainIdentityLabel] = useState<string>("unknown");
  const [chainResetNotice, setChainResetNotice] = useState<string | null>(null);
  const [activeZkRequest, setActiveZkRequest] = useState<ActiveZkPassportRequest | null>(null);
  const [activeGhostContextRequest, setActiveGhostContextRequest] = useState<ActiveZkPassportRequest | null>(null);
  const [activeRenewalRequest, setActiveRenewalRequest] = useState<ActiveZkPassportRequest | null>(null);
  const [activeRecoveryRequest, setActiveRecoveryRequest] = useState<ActiveZkPassportRequest | null>(null);
  const [zkPassportStage, setZkPassportStage] = useState<string>("idle");
  const [zkPassportProofCount, setZkPassportProofCount] = useState<number>(0);
  const [ghostContextStage, setGhostContextStage] = useState<string>("idle");
  const [ghostContextProofCount, setGhostContextProofCount] = useState<number>(0);
  const [zkPassportLastIssue, setZkPassportLastIssue] = useState<ZkPassportIssueState | null>(null);
  const [renewalStage, setRenewalStage] = useState<string>("idle");
  const [renewalProofCount, setRenewalProofCount] = useState<number>(0);
  const [zkPassportLastRenewal, setZkPassportLastRenewal] = useState<ZkPassportRenewalResponse | null>(null);
  const [recoveryStage, setRecoveryStage] = useState<string>("idle");
  const [recoveryProofCount, setRecoveryProofCount] = useState<number>(0);
  const [zkPassportLastRecoveryPreflight, setZkPassportLastRecoveryPreflight] =
    useState<ZkPassportRecoveryPreflightResponse | null>(null);
  const [lastRootRecoveryTxHash, setLastRootRecoveryTxHash] = useState<string | null>(null);
  const [ghostLifecycle, setGhostLifecycle] = useState<GhostAccountLifecycleResult | null>(null);
  const [lastIssuedPassportRef, setLastIssuedPassportRef] = useState<LastIssuedPassportRef | null>(() =>
    loadStoredLastIssuedPassportRef(),
  );
  const discoveryRef = useRef<ExternalWalletDiscovery | null>(null);
  const providerDisconnectCleanupRef = useRef<(() => void) | null>(null);
  const nextActivityLogIdRef = useRef(0);

  useEffect(() => {
    void getPasskeyCapability().then(setPasskeyCapability).catch(() => {
      setPasskeyCapability({
        isSupported: false,
        hasConditionalUi: false,
        hasPlatformAuthenticator: false,
      });
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getChainInfo(env.aztecNodeUrl)
      .then(info => {
        if (cancelled) return;
        const chain = {
          chainId: info.chainId.toString(),
          version: info.version.toString(),
        };
        setChainIdentityLabel(`chainId=${chain.chainId} rollupVersion=${chain.version}`);
        if (typeof window === "undefined") {
          return;
        }
        const nextFingerprint = fingerprintFromChainContext(chain, env);
        const previousFingerprint = window.localStorage.getItem(CHAIN_FINGERPRINT_STORAGE_KEY);
        if (previousFingerprint && previousFingerprint !== nextFingerprint) {
          setChainResetNotice(
            "Detected a chain/deployment change since your previous session. Recreate the in-app wallet session to avoid stale PXE state.",
          );
          window.localStorage.removeItem(LAST_ISSUED_PASSPORT_STORAGE_KEY);
          setLastIssuedPassportRef(null);
          setGhostLifecycle(null);
          setZkPassportLastRenewal(null);
          setZkPassportLastRecoveryPreflight(null);
          setLastRootRecoveryTxHash(null);
        }
        window.localStorage.setItem(CHAIN_FINGERPRINT_STORAGE_KEY, nextFingerprint);
      })
      .catch(() => {
        if (!cancelled) {
          setChainIdentityLabel("unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [env]);

  useEffect(() => {
    if (!session) {
      setSelectedAccount("");
      setGhostLifecycle(null);
      return;
    }
    setSelectedAccount(session.activeAccount.address);
  }, [session]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!lastIssuedPassportRef) {
      window.localStorage.removeItem(LAST_ISSUED_PASSPORT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LAST_ISSUED_PASSPORT_STORAGE_KEY, JSON.stringify(lastIssuedPassportRef));
  }, [lastIssuedPassportRef]);

  useEffect(() => {
    if (!chainResetNotice || !session || session.kind === "external") {
      return;
    }
    void session.disconnect().catch(() => undefined).finally(() => {
      setSession(null);
      setHints(null);
      setGhostLifecycle(null);
      setLastIssuedPassportRef(null);
      setZkPassportLastRenewal(null);
      setZkPassportLastRecoveryPreflight(null);
      setLastRootRecoveryTxHash(null);
      setPendingConnection(null);
    });
  }, [chainResetNotice, session]);

  useEffect(() => {
    setHints(null);
  }, [selectedAccount, claimsForm.nationalityAlpha3, claimsForm.ageThreshold, claimsForm.passportExpiryDate]);

  useEffect(() => {
    if (!rightsSponsorAddress && selectedSponsorAddress) {
      setRightsSponsorAddress(selectedSponsorAddress);
    }
  }, [rightsSponsorAddress, selectedSponsorAddress]);

  useEffect(() => {
    if (configuredSponsors.length === 0) {
      return;
    }
    if (!selectedSponsorAddress) {
      setSelectedSponsorAddress(configuredSponsors[0].address);
    }
    if (!rightsSponsorAddress) {
      setRightsSponsorAddress(configuredSponsors[0].address);
    }
  }, [configuredSponsors, rightsSponsorAddress, selectedSponsorAddress]);

  useEffect(() => {
    return () => {
      discoveryRef.current?.cancel();
      providerDisconnectCleanupRef.current?.();
      pendingConnection?.pending.cancel();
    };
  }, [pendingConnection]);

  useEffect(() => {
    return () => {
      activeZkRequest?.cancel();
    };
  }, [activeZkRequest]);

  useEffect(() => {
    return () => {
      activeGhostContextRequest?.cancel();
    };
  }, [activeGhostContextRequest]);

  useEffect(() => {
    return () => {
      activeRenewalRequest?.cancel();
    };
  }, [activeRenewalRequest]);

  useEffect(() => {
    return () => {
      activeRecoveryRequest?.cancel();
    };
  }, [activeRecoveryRequest]);

  const activeAccount = useMemo(
    () => session?.accounts.find(account => account.address === selectedAccount) ?? session?.activeAccount ?? null,
    [selectedAccount, session],
  );
  const hasActiveZkPassportRequest =
    activeZkRequest !== null ||
    activeGhostContextRequest !== null ||
    activeRenewalRequest !== null ||
    activeRecoveryRequest !== null;
  const externalSession = session?.kind === "external" ? session : null;
  const connectedExternalProviderId = externalSession?.metadata?.providerId ?? null;
  const operatorFeePayerAddress = useMemo(() => {
    const feePayer = session?.metadata?.feePayer?.trim();
    return feePayer && feePayer.startsWith("0x") ? feePayer : null;
  }, [session]);
  const hasL1FundingConfig = useMemo(
    () =>
      Boolean(env.l1RpcUrl && env.l1RightsPortalAddress && env.l1PaymentTokenAddress && env.l1BuyerPrivateKey),
    [env],
  );
  useEffect(() => {
    let cancelled = false;
    const uniqueIdentifier = ghostIdentifierInput.trim();
    if (!uniqueIdentifier) {
      setGhostOwner("");
      return;
    }
    void deriveGhostAccountPreview({
      uniqueIdentifier,
      credentialType: CredentialType.Passport,
      derivationVersion: "v1_legacy_unscoped",
    })
      .then(preview => {
        if (!cancelled) {
          setGhostOwner(preview.address);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGhostOwner("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ghostIdentifierInput]);
  const userClient = useMemo(
    () => (session && activeAccount ? new MagnaBrowserClient(session.wallet, env, activeAccount.address) : null),
    [activeAccount, env, session],
  );
  const operatorClient = useMemo(
    () => (session && operatorFeePayerAddress ? new MagnaBrowserClient(session.wallet, env, operatorFeePayerAddress) : null),
    [env, operatorFeePayerAddress, session],
  );

  const appendLog = (message: string) => {
    const entry = {
      id: nextActivityLogIdRef.current,
      message: `[${nowStamp()}] ${message}`,
    };
    nextActivityLogIdRef.current += 1;
    setActivityLog(current => [entry, ...current].slice(0, 10));
  };

  const resolveCanonicalClaimsForm = (
    currentHints: PassportHints | RootedPassportHints | null,
  ): PassportClaimsForm => {
    if (
      currentHints &&
      zkPassportLastIssue?.issuanceKind === "legacy" &&
      zkPassportLastIssue.claimsHash === currentHints.claimsHash
    ) {
      return claimsFormFromNormalizedClaims(zkPassportLastIssue.normalizedClaims);
    }
    if (currentHints && lastIssuedPassportRef?.claimsHash === currentHints.claimsHash && lastIssuedPassportRef.normalizedClaims) {
      return claimsFormFromNormalizedClaims(lastIssuedPassportRef.normalizedClaims);
    }
    return claimsForm;
  };

  const blockPilotCredentialUsage = (
    credential: { issuanceKind?: PassportIssuanceKind } | null | undefined,
  ): boolean => {
    const message = passportPilotCredentialUsageBlock(credential);
    if (!message) {
      return false;
    }
    setError(message);
    setStatusMessage(message);
    return true;
  };

  const issuedCredentialForHints = (
    currentHints: PassportHints | RootedPassportHints,
  ): { issuanceKind?: PassportIssuanceKind } | null => {
    if (lastIssuedPassportRef?.claimsHash === currentHints.claimsHash) {
      return lastIssuedPassportRef;
    }
    if (zkPassportLastIssue?.claimsHash === currentHints.claimsHash) {
      return zkPassportLastIssue;
    }
    return null;
  };

  const runAction = async <T,>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
    setBusyAction(label);
    setError(null);
    setStatusMessage(`${label} started...`);
    appendLog(`${label} started`);
    try {
      const result = await work();
      setStatusMessage(`${label} completed.`);
      appendLog(`${label} completed`);
      return result;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(`${label}: ${message}`);
      setStatusMessage(`${label} failed: ${message}`);
      appendLog(`${label} failed: ${message}`);
      return undefined;
    } finally {
      setBusyAction(null);
    }
  };

  const runRetriedTxAction = async <T,>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
    return await runAction(label, async () => {
      let attempt = 1;
      while (true) {
        try {
          return await work();
        } catch (caught) {
          if (!isTransientLocalNetworkTxError(caught) || attempt >= TRANSIENT_LOCAL_NETWORK_TX_RETRY_ATTEMPTS) {
            throw caught;
          }
          appendLog(
            `${label} transient local-network tx error; retrying ` +
              `(attempt=${attempt} max_attempts=${TRANSIENT_LOCAL_NETWORK_TX_RETRY_ATTEMPTS} ` +
              `backoff_ms=${TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS}): ${errorMessage(caught)}`,
          );
          if (TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS > 0) {
            await sleep(TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS);
          }
          attempt += 1;
        }
      }
    });
  };

  const clearProviderDisconnectHandler = () => {
    providerDisconnectCleanupRef.current?.();
    providerDisconnectCleanupRef.current = null;
  };

  const cancelPendingConnection = () => {
    if (!pendingConnection) return;
    pendingConnection.pending.cancel();
    setPendingConnection(null);
  };

  const requireUserClient = (): MagnaBrowserClient => {
    if (!userClient) {
      throw new Error("Connect an Aztec wallet or create a managed account first.");
    }
    return userClient;
  };

  const requireTopUpClient = (): MagnaBrowserClient => {
    return operatorClient ?? requireUserClient();
  };

  const handleDiscoverWallets = async () => {
    logExternalWalletUi("discover:click");
    discoveryRef.current?.cancel();
    discoveryRef.current = null;
    cancelPendingConnection();
    setProviders([]);
    setIsDiscovering(true);
    setError(null);
    setStatusMessage("Discover external wallets started...");
    appendLog("Discover external wallets started");
    try {
      const discovery = await startExternalWalletDiscovery(env.aztecNodeUrl, env.appId, {
        timeoutMs: env.walletDiscoveryTimeoutMs,
        allowList: env.walletExtensionAllowList,
        blockList: env.walletExtensionBlockList,
        onWalletDiscovered: provider => {
          logExternalWalletUi("discover:providerDiscovered", {
            providerId: provider.id,
            providerName: provider.name,
            providerType: provider.type,
          });
          setProviders(current => {
            if (current.some(existing => existing.id === provider.id)) {
              return current;
            }
            return [...current, provider];
          });
          setStatusMessage(`Wallet discovered: ${provider.name}. You can connect immediately.`);
          appendLog(`Wallet discovered: ${provider.name}`);
        },
      });
      discoveryRef.current = discovery;
      void discovery.done
        .then(nextProviders => {
          logExternalWalletUi("discover:done", { providerCount: nextProviders.length });
          if (discoveryRef.current !== discovery) {
            return;
          }
          discoveryRef.current = null;
          setProviders(nextProviders);
          setIsDiscovering(false);
          if (nextProviders.length === 0) {
            setStatusMessage("No compatible extension wallet approved the discovery request.");
            appendLog("Discover external wallets completed with no providers");
            return;
          }
          const suffix = nextProviders.length === 1 ? "" : "s";
          setStatusMessage(`Wallet discovery completed with ${nextProviders.length} provider${suffix}.`);
          appendLog(`Discover external wallets completed with ${nextProviders.length} provider${suffix}`);
        })
        .catch(caught => {
          logExternalWalletUi("discover:error", { message: errorMessage(caught) });
          if (discoveryRef.current !== discovery) {
            return;
          }
          discoveryRef.current = null;
          setIsDiscovering(false);
          const message = errorMessage(caught);
          setError(`Discover external wallets: ${message}`);
          setStatusMessage(`Discover external wallets failed: ${message}`);
          appendLog(`Discover external wallets failed: ${message}`);
        });
    } catch (caught) {
      logExternalWalletUi("discover:setupError", { message: errorMessage(caught) });
      setIsDiscovering(false);
      const message = errorMessage(caught);
      setError(`Discover external wallets: ${message}`);
      setStatusMessage(`Discover external wallets failed: ${message}`);
      appendLog(`Discover external wallets failed: ${message}`);
    }
  };

  const handleBeginExternalConnection = async (providerIndex: number) => {
    const provider = providers[providerIndex];
    if (!provider) return;
    logExternalWalletUi("secureChannel:click", {
      providerIndex,
      providerId: provider.id,
      providerName: provider.name,
    });
    discoveryRef.current?.cancel();
    discoveryRef.current = null;
    setIsDiscovering(false);
    cancelPendingConnection();
    const connection = await runAction(`Open secure channel with ${provider.name}`, async () =>
      beginExternalWalletConnection(provider, env.appId),
    );
    if (connection) {
      logExternalWalletUi("secureChannel:ready", {
        providerId: provider.id,
        providerName: provider.name,
        emojiGrid: connection.emojiGrid,
      });
      setPendingConnection(connection);
      setStatusMessage(
        "Secure channel established. Compare the emoji grid with your wallet, then finish the connection here to request wallet permissions and load your granted accounts.",
      );
    }
  };

  const handleConfirmExternalConnection = async () => {
    if (!pendingConnection) return;
    const connection = pendingConnection;
    logExternalWalletUi("confirm:click", {
      providerId: connection.provider.id,
      providerName: connection.provider.name,
    });
    const connected = await runAction("Finish external wallet connection", async () =>
      confirmExternalWalletConnection(connection),
    );
    if (connected) {
      logExternalWalletUi("confirm:sessionReady", {
        providerId: connection.provider.id,
        providerName: connection.provider.name,
        activeAccount: connected.activeAccount.address,
        accountCount: connected.accounts.length,
      });
      clearProviderDisconnectHandler();
      providerDisconnectCleanupRef.current = bindExternalProviderDisconnect(connection.provider, () => {
        logExternalWalletUi("provider:disconnect", {
          providerId: connection.provider.id,
          providerName: connection.provider.name,
        });
        setSession(null);
        setHints(null);
        setGhostLifecycle(null);
        setPendingConnection(null);
        setStatusMessage("Wallet disconnected unexpectedly. Reconnect to continue.");
        appendLog("External wallet disconnected");
      });
      setSession(connected);
      setPendingConnection(null);
      setHints(null);
      setStatusMessage(`External wallet connected. Active account: ${connected.activeAccount.address}`);
      appendLog(`External wallet connected: ${connected.activeAccount.address}`);
    }
  };

  const handleCreateManagedWallet = async () => {
    const created = await runAction("Create managed embedded wallet", async () =>
      createManagedWalletSession({
        nodeUrl: env.aztecNodeUrl,
        alias: managedAlias.trim() || "magna-user",
        flavor: managedFlavor,
        ephemeral: false,
        localTestAccountIndex: env.localTestAccountIndex,
        bootstrapWithLocalTestAccount: env.enableLocalTestBootstrap,
        deployWithLocalTestAccount: env.enableLocalTestBootstrap,
      }),
    );
    if (created) {
      clearProviderDisconnectHandler();
      setChainResetNotice(null);
      setSession(created);
      setHints(null);
      setGhostLifecycle(null);
    }
  };

  const handleDisconnect = async () => {
    if (!session) return;
    await runAction("Disconnect wallet session", async () => {
      await session.disconnect();
      clearProviderDisconnectHandler();
      discoveryRef.current?.cancel();
      discoveryRef.current = null;
      setSession(null);
      setHints(null);
      setGhostLifecycle(null);
      setPendingConnection(null);
    });
  };

  const handleCreateOrUsePasskeyWallet = async (publicKeyRecoveryBundle?: string) => {
    if (!passkeyCapability?.isSupported) {
      setError("Passkeys are not supported in this browser.");
      return;
    }
    const result = await runAction("Create/use Magna passkey wallet", async () => {
      const userName = (managedAlias.trim() || passkeyRecord?.userName || "magna-user")
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .slice(0, 48);
      const rpId = window.location.hostname || "localhost";
      const session = await createWebAuthnWalletSession({
        nodeUrl: env.aztecNodeUrl,
        alias: managedAlias.trim() || "magna-user",
        userName,
        rpId,
        publicKeyRecoveryBundle,
        localTestAccountIndex: env.localTestAccountIndex,
        deployWithLocalTestAccount: env.enableLocalTestBootstrap,
      });
      const record: PasskeyCredentialRecord = {
        credentialId: session.metadata?.credentialId ?? passkeyRecord?.credentialId ?? "webauthn-account",
        rpId,
        userName,
        transports: [],
        createdAt: passkeyRecord?.createdAt ?? new Date().toISOString(),
      };
      return { record, session };
    });
    if (result) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PASSKEY_RECORD_STORAGE_KEY, JSON.stringify(result.record));
      }
      setPasskeyRecord(result.record);
      clearProviderDisconnectHandler();
      setChainResetNotice(null);
      setSession(result.session);
      setHints(null);
      setGhostLifecycle(null);
      const recoveryBundle = result.session.metadata?.publicKeyRecoveryBundle;
      if (
        recoveryBundle &&
        result.session.metadata?.sessionOrigin !== "reused" &&
        typeof window !== "undefined"
      ) {
        window.prompt(
          "Copy and keep this Magna passkey public key. It is not secret; paste it later to use this wallet if local browser storage is empty.",
          recoveryBundle,
        );
        appendLog("Displayed WebAuthn public key");
      }
    }
  };

  const handleUseStoredPasskeyWallet = async () => {
    if (!passkeyCapability?.isSupported) {
      setError("Passkeys are not supported in this browser.");
      return;
    }
    if (typeof window === "undefined") {
      setError("Stored passkey recovery is only available in the browser.");
      return;
    }
    const pasted = window.prompt("Paste your Magna passkey public key to use your stored passkey wallet.");
    if (pasted === null) {
      appendLog("Use stored passkey wallet cancelled before WebAuthn ceremony");
      return;
    }
    const publicKey = pasted.trim();
    if (!publicKey) {
      setError("Paste your Magna passkey public key to use a stored passkey wallet.");
      return;
    }
    await handleCreateOrUsePasskeyWallet(publicKey);
  };

  const handleForgetPasskeyWallet = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(PASSKEY_RECORD_STORAGE_KEY);
      window.localStorage.removeItem(WEB_AUTHN_ACCOUNT_STORAGE_KEY);
    }
    setPasskeyRecord(null);
    appendLog("Cleared stored passkey wallet binding");
  };

  const handleStartZkPassportIssuance = async () => {
    if (!activeAccount) {
      setError("Choose an active account before starting zkPassport issuance.");
      return;
    }
    if (!env.verificationApiUrl) {
      setError("Set VITE_MAGNA_VERIFICATION_API_URL to enable zkPassport issuance.");
      return;
    }
    const verificationApiUrl = env.verificationApiUrl;
    const ageThreshold = Number.parseInt(claimsForm.ageThreshold, 10);
    if (!Number.isFinite(ageThreshold)) {
      setError("zkPassport age threshold must be a valid integer.");
      return;
    }
    if (activeGhostContextRequest || activeRenewalRequest || activeRecoveryRequest) {
      setError("Finish or cancel the current zkPassport flow before starting issuance.");
      return;
    }
    if (activeZkRequest) {
      activeZkRequest.cancel();
      setActiveZkRequest(null);
    }
    let proofMode: ReturnType<typeof proofModeForPassportIssuanceKind>;
    try {
      proofMode = proofModeForPassportIssuanceKind(env.zkPassportIssuanceKind);
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      setStatusMessage(message);
      appendLog(`zkPassport issuance unavailable: ${message}`);
      return;
    }

    setError(null);
    setGhostLifecycle(null);
    setZkPassportProofCount(0);
    setZkPassportStage("creating_request");
    setStatusMessage("Creating zkPassport request...");
    appendLog("Create zkPassport request started");
    if (env.zkPassportDevMode) {
      appendLog("zkPassport dev mode enabled (mock proofs allowed)");
    }
    if (env.zkPassportIssuanceKind === "pilot") {
      appendLog("PII-blind pilot issuance enabled (non-production; not passport-authentic).");
    }

    try {
      const request = await startPassportZkRequest({
        ageThreshold,
        proofMode,
        metadata: {
          name: env.zkPassportRequestName,
          logo: env.zkPassportRequestLogo,
          purpose: env.zkPassportRequestPurpose,
          scope: env.zkPassportRequestScope,
        },
        devMode: env.zkPassportDevMode,
        onEvent: (event: ZkPassportLifecycleEvent) => {
          switch (event.type) {
            case "request_created":
              setZkPassportStage("awaiting_scan");
              setStatusMessage("zkPassport request created. Scan QR code or open the deep link.");
              appendLog(`zkPassport request created: ${event.requestId}`);
              break;
            case "bridge_connected":
              setStatusMessage("zkPassport bridge connected.");
              appendLog("zkPassport bridge connected");
              break;
            case "request_received":
              setZkPassportStage("request_received");
              setStatusMessage("zkPassport request received on mobile app.");
              appendLog("zkPassport request received on mobile app");
              break;
            case "generating_proof":
              setZkPassportStage("generating_proof");
              setStatusMessage("zkPassport is generating proof(s).");
              appendLog("zkPassport generating proof(s)");
              break;
            case "proof_generated":
              setZkPassportStage("proof_generated");
              setZkPassportProofCount(event.proofCount);
              setStatusMessage(`zkPassport proof generated (${event.proofCount}).`);
              appendLog(`zkPassport proof generated (${event.proofCount})`);
              break;
            case "result_received":
              setZkPassportStage("result_received");
              setStatusMessage("zkPassport returned results. Submitting to verification API.");
              appendLog(`zkPassport result received (verified=${event.verified})`);
              break;
          }
        },
      });
      setActiveZkRequest(request);

      void request.completion
        .then(async (completion) => {
          if (completion.status === "rejected") {
            setActiveZkRequest(null);
            setZkPassportStage("rejected");
            setStatusMessage("zkPassport request rejected by user.");
            appendLog("zkPassport request rejected");
            return;
          }

          const uniqueIdentifier = completion.uniqueIdentifier;
          let preparedGhost: GhostAccountLifecycleResult | null = null;
          if (env.zkPassportPrimaryIssuanceMode === "rooted" && uniqueIdentifier) {
            setZkPassportStage("preparing_rooted_ghost");
            const preparedGhostResult = await runAction("Prepare rooted ghost account", async () => {
              try {
                return await ensureGhostAccountLifecycle({
                  nodeUrl: env.aztecNodeUrl,
                  uniqueIdentifier,
                  credentialType: CredentialType.Passport,
                  derivationVersion: env.zkPassportGhostDerivationVersion,
                  deploymentFromAddress: operatorFeePayerAddress ?? activeAccount.address,
                });
              } catch (primaryError) {
                if (!env.enableLocalTestBootstrap) {
                  throw primaryError;
                }
                appendLog("Ghost account deploy with preferred payer failed, retrying with local test payer.");
                return await ensureGhostAccountLifecycle({
                  nodeUrl: env.aztecNodeUrl,
                  uniqueIdentifier,
                  credentialType: CredentialType.Passport,
                  derivationVersion: env.zkPassportGhostDerivationVersion,
                  deployWithLocalTestAccount: true,
                  localTestAccountIndex: env.localTestAccountIndex,
                });
              }
            });
            if (!preparedGhostResult) {
              setActiveZkRequest(null);
              setZkPassportStage("ghost_prepare_failed");
              return;
            }
            preparedGhost = preparedGhostResult;
            setGhostLifecycle(preparedGhost);
            appendLog(
              `Ghost account prepared (${preparedGhost.deploymentStatus}). address=${preparedGhost.address} derivation=${preparedGhost.derivationVersion}`,
            );
          }

          setZkPassportStage("submitting_to_backend");
          const issueResult = await runAction("Verify zkPassport + issue Magna passport", async () =>
            issuePassportThroughConfiguredBackend(
              {
                issuanceKind: env.zkPassportIssuanceKind,
                verificationApiUrl,
                completion,
                activeOwner: activeAccount.address,
                ageThreshold,
                mode: env.zkPassportPrimaryIssuanceMode,
                ghostDerivationVersion: env.zkPassportGhostDerivationVersion,
                preparedGhostOwner: preparedGhost?.address,
              },
              {
                verifyAndIssueThroughBackend,
                verifyAndIssuePassportPilotThroughBackend,
              },
            ),
          );
          if (!issueResult) {
            setZkPassportStage("backend_failed");
            return;
          }
          setActiveZkRequest(null);
          setZkPassportStage("issued");
          if (issueResult.issuanceKind === "legacy") {
            const issued = issueResult.response;
            setZkPassportLastIssue({ ...issued, issuanceKind: "legacy" });
            setLastIssuedPassportRef({
              ownerAddress: activeAccount.address,
              claimsHash: issued.claimsHash,
              mode: issued.mode,
              issuanceKind: "legacy",
              rootCommitment: issued.mode === "rooted" ? issued.rootCommitment : undefined,
              ghostOwner: issued.ghostOwner,
              ghostDerivationVersion: issued.ghostDerivationVersion,
              normalizedClaims: issued.normalizedClaims,
            });
            setGhostOwner(issued.ghostOwner);
            setClaimsForm(current => ({
              ...current,
              nationalityAlpha3: issued.normalizedClaims.nationalityAlpha3,
              ageThreshold: String(issued.normalizedClaims.minAgeProven),
              passportExpiryDate: issued.normalizedClaims.passportExpiryDate,
            }));
            setStatusMessage(`zkPassport verified and credential issued. Claims hash: ${issued.claimsHash}`);
            appendLog(`zkPassport issuance completed. Claims hash: ${issued.claimsHash}`);
            if (preparedGhost && preparedGhost.address !== issued.ghostOwner) {
              throw new Error(
                `Ghost derivation mismatch: backend=${issued.ghostOwner} frontend=${preparedGhost.address}`,
              );
            }
          } else {
            const issued = issueResult.response;
            setZkPassportLastIssue({ ...issued, issuanceKind: "pilot" });
            setLastIssuedPassportRef({
              ownerAddress: activeAccount.address,
              claimsHash: issued.claimsHash,
              mode: issued.mode,
              issuanceKind: "pilot",
              rootCommitment: issued.mode === "rooted" ? issued.rootCommitment : undefined,
              ghostOwner: issued.ghostOwner,
              ghostDerivationVersion: issued.ghostDerivationVersion,
            });
            setGhostOwner(issued.ghostOwner);
            setStatusMessage(
              `PII-blind pilot credential issued (non-production; not passport-authentic). Claims hash: ${issued.claimsHash}`,
            );
            appendLog(
              `PII-blind pilot issuance completed (non-production; not passport-authentic). Claims hash: ${issued.claimsHash}`,
            );
            if (preparedGhost && preparedGhost.address !== issued.ghostOwner) {
              throw new Error(
                `Ghost derivation mismatch: backend=${issued.ghostOwner} frontend=${preparedGhost.address}`,
              );
            }
          }
        })
        .catch((caught) => {
          const message = errorMessage(caught);
          setActiveZkRequest(null);
          setZkPassportStage("error");
          setError(`zkPassport flow failed: ${message}`);
          setStatusMessage(`zkPassport flow failed: ${message}`);
          appendLog(`zkPassport flow failed: ${message}`);
        });
    } catch (caught) {
      const message = errorMessage(caught);
      setActiveZkRequest(null);
      setZkPassportStage("error");
      setError(`Create zkPassport request failed: ${message}`);
      setStatusMessage(`Create zkPassport request failed: ${message}`);
      appendLog(`Create zkPassport request failed: ${message}`);
    }
  };

  const handleCancelZkPassportRequest = () => {
    if (!activeZkRequest) {
      return;
    }
    activeZkRequest.cancel();
    setActiveZkRequest(null);
    setZkPassportStage("cancelled");
    setStatusMessage("Cancelled zkPassport request.");
    appendLog("Cancelled zkPassport request");
  };

  const handleIssuePassport = async () => {
    if (!activeAccount) {
      setError("Choose an active account before issuing a credential.");
      return;
    }
    if (activeGhostContextRequest || activeRenewalRequest || activeRecoveryRequest) {
      setError("Finish or cancel the current zkPassport flow before issuing via the dev fallback.");
      return;
    }
    const uniqueIdentifier = ghostIdentifierInput.trim();
    if (!uniqueIdentifier) {
      const message = "Provide a scoped unique identifier so the ghost wallet address can be derived.";
      setError(message);
      setStatusMessage(`Issue passport credential via dev orchestrator blocked: ${message}`);
      appendLog(`Issue passport credential via dev orchestrator blocked: ${message}`);
      return;
    }
    if (ghostOwner && ghostOwner === activeAccount.address) {
      const message = "Derived ghost wallet address must differ from the active owner address.";
      setError(message);
      setStatusMessage(`Issue passport credential via dev orchestrator blocked: ${message}`);
      appendLog(`Issue passport credential via dev orchestrator blocked: ${message}`);
      return;
    }
    const result = await runAction("Issue passport credential via dev orchestrator", async () =>
      issuePassportWithDevOrchestrator(
        env,
        {
          activeOwner: activeAccount.address,
          ghostUniqueIdentifier: uniqueIdentifier,
          claimsForm,
        },
        session ? { wallet: session.wallet } : undefined,
      ),
    );
    if (result) {
      setLastIssuedPassportRef({
        ownerAddress: activeAccount.address,
        claimsHash: result.claimsHash,
        mode: "passport",
        ghostOwner: ghostOwner || undefined,
        ghostDerivationVersion: "v1_legacy_unscoped",
      });
      setStatusMessage(`Issued credential. Claims hash: ${result.claimsHash}`);
    }
  };

  const isAwaitingReissue = recoveryStage === "completed" && !lastIssuedPassportRef;

  const handleFetchHints = async () => {
    if (!activeAccount) {
      setError("Choose an active account before fetching hinted notes.");
      return;
    }
    if (isAwaitingReissue) {
      setStatusMessage("Recovery complete — re-issue your rooted passport (scan again) before fetching hints.");
      return;
    }
    if (activeZkRequest || activeGhostContextRequest || activeRenewalRequest || activeRecoveryRequest) {
      setError("Wait for the current zkPassport request to finish before fetching hinted notes.");
      return;
    }
    const issuedRef =
      lastIssuedPassportRef && lastIssuedPassportRef.ownerAddress === activeAccount.address ? lastIssuedPassportRef : null;
    if (blockPilotCredentialUsage(issuedRef)) {
      return;
    }
    const result = await runAction("Fetch Magna hinted notes", async () => {
      const client = requireUserClient();
      await client.syncOrchestratorSender();
      const rootedIssue =
        issuedRef?.mode === "rooted" && issuedRef.rootCommitment
          ? { ...issuedRef, rootCommitment: issuedRef.rootCommitment }
          : null;
      const nextHints =
        rootedIssue
          ? await client.fetchRootedPassportHintsByClaimsHash(
              activeAccount.address,
              rootedIssue.rootCommitment,
              rootedIssue.claimsHash,
            )
          : issuedRef
            ? await client.fetchPassportHintsByClaimsHash(activeAccount.address, issuedRef.claimsHash)
            : await client.fetchPassportHints(activeAccount.address, claimsForm);
      if (issuedRef?.normalizedClaims) {
        setClaimsForm(current => {
          const canonicalForm = claimsFormFromNormalizedClaims(issuedRef.normalizedClaims!);
          if (
            current.nationalityAlpha3 === canonicalForm.nationalityAlpha3 &&
            current.ageThreshold === canonicalForm.ageThreshold &&
            current.passportExpiryDate === canonicalForm.passportExpiryDate
          ) {
            return current;
          }
          return canonicalForm;
        });
      }
      setHints(nextHints);
      return nextHints;
    });
    if (result) {
      setStatusMessage(`Hinted notes synced for claims hash ${result.claimsHash}.`);
    }
  };

  const handleVerify = async () => {
    if (!hints) {
      setError("Fetch hinted notes before calling verify.");
      return;
    }
    if (blockPilotCredentialUsage(issuedCredentialForHints(hints))) {
      return;
    }
    const result = await runAction("Run Magna verify", async () => {
      const client = requireUserClient();
      const verificationClaimsForm = resolveCanonicalClaimsForm(hints);
      if (isRootedPassportHints(hints)) {
        return await client.verifyRootedPassport(verificationClaimsForm, policyForm, hints);
      }
      return await client.verifyPassport(verificationClaimsForm, policyForm, hints);
    });
    if (result) {
      setStatusMessage(describeTxOutcome("Verify transaction", result));
    }
  };

  const handleSponsoredVerify = async () => {
    if (!hints) {
      setError("Fetch hinted notes before calling sponsored verify.");
      return;
    }
    if (!selectedSponsorAddress) {
      setError("Select a configured sponsor gateway before calling sponsored verify.");
      return;
    }
    if (blockPilotCredentialUsage(issuedCredentialForHints(hints))) {
      return;
    }
    const result = await runRetriedTxAction("Run Magna sponsored verify", async () => {
      const client = requireUserClient();
      const verificationClaimsForm = resolveCanonicalClaimsForm(hints);
      if (isRootedPassportHints(hints)) {
        return await client.verifyRootedPassportWithCompanySponsor(
          verificationClaimsForm,
          policyForm,
          hints,
          selectedSponsorAddress,
        );
      }
      return await client.verifyPassportWithCompanySponsor(
        verificationClaimsForm,
        policyForm,
        hints,
        selectedSponsorAddress,
      );
    });
    if (result) {
      setStatusMessage(describeTxOutcome("Sponsored verify transaction", result));
    }
  };

  const handleRefreshRootAuthority = async () => {
    if (!activeAccount) {
      setError("Choose an active account before starting renewal.");
      return;
    }
    if (!env.verificationApiUrl) {
      setError("Set VITE_MAGNA_VERIFICATION_API_URL to enable rooted passport renewal.");
      return;
    }
    if (!hints || !isRootedPassportHints(hints)) {
      setError("Fetch rooted hinted notes before renewing passport authority under the existing root.");
      return;
    }
    if (blockPilotCredentialUsage(issuedCredentialForHints(hints))) {
      return;
    }
    const ghostOwnerAddress = zkPassportLastIssue?.ghostOwner ?? lastIssuedPassportRef?.ghostOwner ?? ghostLifecycle?.address;
    if (!ghostOwnerAddress) {
      setError("Passport authority renewal requires a known ghost owner address.");
      return;
    }
    if (activeZkRequest || activeGhostContextRequest || activeRecoveryRequest) {
      setError("Wait for the current zkPassport request to finish before starting renewal.");
      return;
    }

    const verificationApiUrl = env.verificationApiUrl;
    const ageThreshold = Number.parseInt(resolveCanonicalClaimsForm(hints).ageThreshold, 10);
    if (!Number.isFinite(ageThreshold)) {
      setError("Renewal age threshold must be a valid integer.");
      return;
    }

    if (activeRenewalRequest) {
      activeRenewalRequest.cancel();
      setActiveRenewalRequest(null);
    }

    setError(null);
    setRenewalProofCount(0);
    setRenewalStage("creating_request");
    setStatusMessage("Creating zkPassport renewal request...");
    appendLog("Create zkPassport renewal request started");
    if (env.zkPassportDevMode) {
      appendLog("zkPassport dev mode enabled (mock proofs allowed) for renewal");
    }

    try {
      const request = await startPassportZkRequest({
        ageThreshold,
        metadata: {
          name: env.zkPassportRequestName,
          logo: env.zkPassportRequestLogo,
          purpose: env.zkPassportRequestPurpose,
          scope: env.zkPassportRequestScope,
        },
        devMode: env.zkPassportDevMode,
        onEvent: (event: ZkPassportLifecycleEvent) => {
          switch (event.type) {
            case "request_created":
              setRenewalStage("awaiting_scan");
              setStatusMessage("zkPassport renewal request created. Scan QR code or open the deep link.");
              appendLog(`zkPassport renewal request created: ${event.requestId}`);
              break;
            case "bridge_connected":
              setStatusMessage("zkPassport renewal bridge connected.");
              appendLog("zkPassport renewal bridge connected");
              break;
            case "request_received":
              setRenewalStage("request_received");
              setStatusMessage("zkPassport renewal request received on mobile app.");
              appendLog("zkPassport renewal request received on mobile app");
              break;
            case "generating_proof":
              setRenewalStage("generating_proof");
              setStatusMessage("zkPassport is generating proof(s) for renewal.");
              appendLog("zkPassport generating proof(s) for renewal");
              break;
            case "proof_generated":
              setRenewalStage("proof_generated");
              setRenewalProofCount(event.proofCount);
              setStatusMessage(`zkPassport proof generated for renewal (${event.proofCount}).`);
              appendLog(`zkPassport proof generated for renewal (${event.proofCount})`);
              break;
            case "result_received":
              setRenewalStage("result_received");
              setStatusMessage("zkPassport returned renewal results. Submitting to verification API.");
              appendLog(`zkPassport renewal result received (verified=${event.verified})`);
              break;
          }
        },
      });
      setActiveRenewalRequest(request);

      void request.completion
        .then(async (completion) => {
          if (completion.status === "rejected") {
            setActiveRenewalRequest(null);
            setRenewalStage("rejected");
            setStatusMessage("zkPassport renewal request rejected by user.");
            appendLog("zkPassport renewal request rejected");
            return;
          }

          setRenewalStage("submitting_to_backend");
          const renewed = await runAction("Verify zkPassport proofs + renew rooted passport authority", async () =>
            verifyAndRefreshRootAuthorityThroughBackend(verificationApiUrl, {
              proofs: completion.proofs,
              originalQuery: completion.originalQuery,
              queryResult: completion.queryResult,
              ghostOwner: ghostOwnerAddress,
              hintedRootStatusNote: hints.hintedRootStatusNote,
              hintedRootAuthorityNote: hints.hintedRootAuthorityNote,
              ageThreshold,
            }),
          );
          if (!renewed) {
            setActiveRenewalRequest(null);
            setRenewalStage("backend_refresh_failed");
            return;
          }

          setActiveRenewalRequest(null);
          setRenewalStage("completed");
          setZkPassportLastRenewal(renewed);
          setClaimsForm(claimsFormFromNormalizedClaims(renewed.normalizedClaims));
          setLastIssuedPassportRef({
            ownerAddress: activeAccount.address,
            claimsHash: renewed.claimsHash,
            mode: "rooted",
            issuanceKind: "legacy",
            rootCommitment: renewed.rootCommitment,
            ghostOwner: renewed.ghostOwner,
            ghostDerivationVersion:
              zkPassportLastIssue?.ghostDerivationVersion ??
              lastIssuedPassportRef?.ghostDerivationVersion ??
              env.zkPassportGhostDerivationVersion,
            normalizedClaims: renewed.normalizedClaims,
          });
          setHints(null);
          setStatusMessage(`Rooted passport renewal completed. Claims hash: ${renewed.claimsHash}`);
          appendLog(`Rooted passport renewal completed. Claims hash: ${renewed.claimsHash}`);
        })
        .catch((caught) => {
          const message = errorMessage(caught);
          setActiveRenewalRequest(null);
          setRenewalStage("error");
          setError(`zkPassport renewal flow failed: ${message}`);
          setStatusMessage(`zkPassport renewal flow failed: ${message}`);
          appendLog(`zkPassport renewal flow failed: ${message}`);
        });
    } catch (caught) {
      const message = errorMessage(caught);
      setActiveRenewalRequest(null);
      setRenewalStage("error");
      setError(`Create zkPassport renewal request failed: ${message}`);
      setStatusMessage(`Create zkPassport renewal request failed: ${message}`);
      appendLog(`Create zkPassport renewal request failed: ${message}`);
    }
  };

  const handleRecoverRoot = async () => {
    if (!activeAccount) {
      setError("Choose an active account before starting rooted recovery.");
      return;
    }
    if (!session || session.kind === "external") {
      setError("Rooted recovery currently supports in-app passkey/managed sessions only.");
      return;
    }
    if (!env.verificationApiUrl) {
      setError("Set VITE_MAGNA_VERIFICATION_API_URL to enable rooted recovery preflight verification.");
      return;
    }
    if (!hints || !isRootedPassportHints(hints)) {
      setError("Fetch rooted hinted notes before starting rooted recovery.");
      return;
    }
    if (blockPilotCredentialUsage(issuedCredentialForHints(hints))) {
      return;
    }
    const ghostOwnerAddress =
      zkPassportLastIssue?.ghostOwner ?? lastIssuedPassportRef?.ghostOwner ?? ghostLifecycle?.address;
    if (!ghostOwnerAddress) {
      setError("Root recovery requires a known ghost owner address.");
      return;
    }
    if (activeZkRequest || activeGhostContextRequest || activeRenewalRequest) {
      setError("Wait for the current zkPassport request to finish before starting rooted recovery.");
      return;
    }

    const verificationApiUrl = env.verificationApiUrl;
    const canonicalClaims = resolveCanonicalClaimsForm(hints);
    const ageThreshold = Number.parseInt(canonicalClaims.ageThreshold, 10);
    if (!Number.isFinite(ageThreshold)) {
      setError("Recovery age threshold must be a valid integer.");
      return;
    }
    const recoveryDerivationVersion = resolveGhostDerivationVersion(
      zkPassportLastIssue?.ghostDerivationVersion ?? lastIssuedPassportRef?.ghostDerivationVersion,
      env.zkPassportGhostDerivationVersion,
    );

    if (activeRecoveryRequest) {
      activeRecoveryRequest.cancel();
      setActiveRecoveryRequest(null);
    }

    setError(null);
    setRecoveryProofCount(0);
    setRecoveryStage("creating_request");
    setStatusMessage("Creating zkPassport root recovery request...");
    appendLog("Create zkPassport root recovery request started");
    if (env.zkPassportDevMode) {
      appendLog("zkPassport dev mode enabled (mock proofs allowed) for root recovery");
    }

    try {
      const request = await startPassportZkRequest({
        ageThreshold,
        metadata: {
          name: env.zkPassportRequestName,
          logo: env.zkPassportRequestLogo,
          purpose: env.zkPassportRequestPurpose,
          scope: env.zkPassportRequestScope,
        },
        devMode: env.zkPassportDevMode,
        onEvent: (event: ZkPassportLifecycleEvent) => {
          switch (event.type) {
            case "request_created":
              setRecoveryStage("awaiting_scan");
              setStatusMessage("zkPassport root recovery request created. Scan QR code or open the deep link.");
              appendLog(`zkPassport root recovery request created: ${event.requestId}`);
              break;
            case "bridge_connected":
              setStatusMessage("zkPassport root recovery bridge connected.");
              appendLog("zkPassport root recovery bridge connected");
              break;
            case "request_received":
              setRecoveryStage("request_received");
              setStatusMessage("zkPassport root recovery request received on mobile app.");
              appendLog("zkPassport root recovery request received on mobile app");
              break;
            case "generating_proof":
              setRecoveryStage("generating_proof");
              setStatusMessage("zkPassport is generating proof(s) for root recovery.");
              appendLog("zkPassport generating proof(s) for root recovery");
              break;
            case "proof_generated":
              setRecoveryStage("proof_generated");
              setRecoveryProofCount(event.proofCount);
              setStatusMessage(`zkPassport proof generated for root recovery (${event.proofCount}).`);
              appendLog(`zkPassport proof generated for root recovery (${event.proofCount})`);
              break;
            case "result_received":
              setRecoveryStage("result_received");
              setStatusMessage("zkPassport returned root recovery results. Running server preflight.");
              appendLog(`zkPassport root recovery result received (verified=${event.verified})`);
              break;
          }
        },
      });
      setActiveRecoveryRequest(request);

      void request.completion
        .then(async (completion) => {
          if (completion.status === "rejected") {
            setActiveRecoveryRequest(null);
            setRecoveryStage("rejected");
            setStatusMessage("zkPassport root recovery request rejected by user.");
            appendLog("zkPassport root recovery request rejected");
            return;
          }
          if (!completion.uniqueIdentifier) {
            throw new Error("zkPassport verification succeeded but uniqueIdentifier is missing for rooted recovery.");
          }

          setRecoveryStage("submitting_preflight");
          const preflight = await runAction("Verify zkPassport proofs for rooted recovery", async () =>
            verifyRootRecoveryPreflightThroughBackend(verificationApiUrl, {
              proofs: completion.proofs,
              originalQuery: completion.originalQuery,
              queryResult: completion.queryResult,
              expectedGhostOwner: ghostOwnerAddress,
              expectedRootCommitment: hints.rootCommitment,
              ghostDerivationVersion: recoveryDerivationVersion,
              ageThreshold,
            }),
          );
          if (!preflight) {
            setActiveRecoveryRequest(null);
            setRecoveryStage("preflight_failed");
            return;
          }
          setZkPassportLastRecoveryPreflight(preflight);
          setClaimsForm(claimsFormFromNormalizedClaims(preflight.normalizedClaims));

          setRecoveryStage("recovering_root");
          const recovered = await runAction("Recover rooted passport lineage", async () => {
            const runRecoveryAttempt = async (attempt: {
              deploymentFromAddress?: string;
              deployWithLocalTestAccount?: boolean;
              localTestAccountIndex?: number;
            }) => {
              const transientGhost = await createTransientGhostWalletSession({
                nodeUrl: env.aztecNodeUrl,
                uniqueIdentifier: completion.uniqueIdentifier!,
                credentialType: CredentialType.Passport,
                derivationVersion: recoveryDerivationVersion,
                ...attempt,
              });
              try {
                if (transientGhost.ghostAddress !== preflight.derivedGhostOwner) {
                  throw new Error(
                    `Ghost derivation mismatch during rooted recovery. preflight=${preflight.derivedGhostOwner} local=${transientGhost.ghostAddress}`,
                  );
                }
                const ghostClient = new MagnaBrowserClient(transientGhost.wallet, env, transientGhost.ghostAddress);
                const hintedRootRecovery = await ghostClient.fetchRootRecoveryHint(
                  transientGhost.ghostAddress,
                  hints.rootCommitment,
                );
                const outcome = await ghostClient.recoverRoot(hintedRootRecovery, activeAccount.address);
                return {
                  outcome,
                  ghostAddress: transientGhost.ghostAddress,
                };
              } finally {
                await transientGhost.dispose();
              }
            };

            try {
              return await runRecoveryAttempt({
                deploymentFromAddress: operatorFeePayerAddress ?? activeAccount.address,
              });
            } catch (primaryError) {
              if (!env.enableLocalTestBootstrap) {
                throw primaryError;
              }
              appendLog(
                "Rooted recovery ghost deployment with preferred payer failed, retrying with local test payer.",
              );
              return await runRecoveryAttempt({
                deployWithLocalTestAccount: true,
                localTestAccountIndex: env.localTestAccountIndex,
              });
            }
          });
          if (!recovered) {
            setActiveRecoveryRequest(null);
            setRecoveryStage("recover_failed");
            return;
          }

          setActiveRecoveryRequest(null);
          setRecoveryStage("completed");
          setLastRootRecoveryTxHash(recovered.outcome.txHash ?? null);
          setHints(null);
          setGhostLifecycle(null);
          setLastIssuedPassportRef(null);
          setZkPassportLastIssue(null);
          setZkPassportLastRenewal(null);
          setStatusMessage(
            `${describeTxOutcome("Root recovery transaction", recovered.outcome)} ` +
              "Old linked lineage is now invalidated; re-issue rooted passport lineage before verifying again.",
          );
          appendLog(
            `Rooted recovery completed from ghost ${recovered.ghostAddress}. Re-issue rooted lineage before next verify.`,
          );
        })
        .catch((caught) => {
          const message = errorMessage(caught);
          setActiveRecoveryRequest(null);
          setRecoveryStage("error");
          setError(`zkPassport root recovery flow failed: ${message}`);
          setStatusMessage(`zkPassport root recovery flow failed: ${message}`);
          appendLog(`zkPassport root recovery flow failed: ${message}`);
        });
    } catch (caught) {
      const message = errorMessage(caught);
      setActiveRecoveryRequest(null);
      setRecoveryStage("error");
      setError(`Create zkPassport root recovery request failed: ${message}`);
      setStatusMessage(`Create zkPassport root recovery request failed: ${message}`);
      appendLog(`Create zkPassport root recovery request failed: ${message}`);
    }
  };

  const handleReadSponsorRights = async () => {
    if (!rightsSponsorAddress) {
      setError("Select a sponsor address before reading rights state.");
      return;
    }
    const result = await runAction("Read sponsor rights state", async () => {
      const client = requireUserClient();
      return await client.readSponsorRightsSnapshot(rightsSponsorAddress);
    });
    if (result) {
      setRightsSnapshot(result);
      setStatusMessage(
        `Sponsor rights loaded. Remaining=${result.remainingVerifies.toString()} ` +
          `Consumed=${result.consumedVerifies.toString()}.`,
      );
    }
  };

  const handleTopUpSponsorRightsFromL1 = async () => {
    if (!rightsSponsorAddress) {
      setError("Select a sponsor address before topping up rights.");
      return;
    }
    const result = await runAction("Top up sponsor rights via L1 purchase + L2 claim", async () => {
      const client = requireTopUpClient();
      return await client.topUpSponsorRightsFromL1Purchase({
        sponsorAddress: rightsSponsorAddress,
        rightsAmount: rightsTopUpAmount,
        packageId: rightsPackageId.trim() || undefined,
        extraPolicyHash: rightsExtraPolicyHash.trim() || undefined,
      });
    });
    if (result) {
      setLastL1TopUpOutcome(result);
      const client = requireTopUpClient();
      const snapshot = await client.waitForSponsorRightsSnapshotPurchaseSync(rightsSponsorAddress, result.purchaseId);
      setRightsSnapshot(snapshot);
      setStatusMessage(
        `${describeTxOutcome("L1 top-up claim transaction", result)} ` +
          `Updated rights snapshot. Remaining=${snapshot.remainingVerifies.toString()} ` +
          `Consumed=${snapshot.consumedVerifies.toString()}.`,
      );
    }
  };

  const handleTopUpSponsorRights = async () => {
    if (!rightsSponsorAddress) {
      setError("Select a sponsor address before topping up rights.");
      return;
    }
    const result = await runAction("Top up sponsor rights via L2 purchase", async () => {
      const client = requireTopUpClient();
      return await client.topUpSponsorRightsFromL2Payment({
        sponsorAddress: rightsSponsorAddress,
        rightsAmount: rightsTopUpAmount,
        packageId: rightsPackageId.trim() || undefined,
      });
    });
    if (result) {
      setLastTopUpOutcome(result);
      const client = requireTopUpClient();
      const snapshot = await client.waitForSponsorRightsSnapshotPurchaseSync(rightsSponsorAddress, result.purchaseId);
      setRightsSnapshot(snapshot);
      setStatusMessage(
        `${describeTxOutcome("L2 top-up transaction", result)} ` +
          `Updated rights snapshot. Remaining=${snapshot.remainingVerifies.toString()} ` +
          `Consumed=${snapshot.consumedVerifies.toString()}.`,
      );
    }
  };

  const handleInspectContractCompatibility = async () => {
    const result = await runAction("Inspect contract compatibility", async () => {
      const client = requireUserClient();
      const compatibilityMatrix = client.getContractCompatibilityMatrix();
      const runtimeStatuses = await client.getSponsorRuntimeStatuses();
      return { compatibilityMatrix, runtimeStatuses };
    });
    if (result) {
      setCompatibilityMatrix(result.compatibilityMatrix);
      setSponsorRuntimeStatuses(result.runtimeStatuses);
    }
  };

  const handleAddSponsorGateway = async () => {
    const candidate = gatewayCandidateAddress.trim();
    if (!candidate) {
      setError("Provide a sponsor gateway address to add.");
      return;
    }
    const result = await runAction("Add sponsor gateway on issuer", async () => {
      const client = requireUserClient();
      return await client.addCompanySponsorGateway(candidate);
    });
    if (result) {
      setStatusMessage(describeTxOutcome("Add sponsor gateway transaction", result));
      setGatewayCandidateAddress("");
      const client = requireUserClient();
      const statuses = await client.getSponsorRuntimeStatuses();
      setSponsorRuntimeStatuses(statuses);
    }
  };

  const handleCancelGhostContextRequest = () => {
    if (!activeGhostContextRequest) {
      return;
    }
    activeGhostContextRequest.cancel();
    setActiveGhostContextRequest(null);
    setGhostContextStage("cancelled");
    setStatusMessage("Cancelled ghost derivation zkPassport request.");
    appendLog("Cancelled ghost derivation zkPassport request");
  };

  const handleCancelRenewalRequest = () => {
    if (!activeRenewalRequest) {
      return;
    }
    activeRenewalRequest.cancel();
    setActiveRenewalRequest(null);
    setRenewalStage("cancelled");
    setStatusMessage("Cancelled zkPassport renewal request.");
    appendLog("Cancelled zkPassport renewal request");
  };

  const handleCancelRecoveryRequest = () => {
    if (!activeRecoveryRequest) {
      return;
    }
    activeRecoveryRequest.cancel();
    setActiveRecoveryRequest(null);
    setRecoveryStage("cancelled");
    setStatusMessage("Cancelled zkPassport root recovery request.");
    appendLog("Cancelled zkPassport root recovery request");
  };

  const handleDeriveGhostContext = async () => {
    if (activeZkRequest || activeRenewalRequest || activeRecoveryRequest) {
      setError("Wait for the current zkPassport flow to finish before deriving ghost context.");
      return;
    }
    const ageThreshold = Number.parseInt(claimsForm.ageThreshold, 10);
    if (!Number.isFinite(ageThreshold)) {
      setError("zkPassport age threshold must be a valid integer before deriving ghost context.");
      return;
    }
    if (activeGhostContextRequest) {
      activeGhostContextRequest.cancel();
      setActiveGhostContextRequest(null);
    }

    setError(null);
    setGhostMaterialPreview(null);
    setGhostContextProofCount(0);
    setGhostContextStage("creating_request");
    setStatusMessage("Creating zkPassport request for ghost derivation...");
    appendLog("Create zkPassport request for ghost derivation started");
    if (env.zkPassportDevMode) {
      appendLog("zkPassport dev mode enabled (mock proofs allowed) for ghost derivation");
    }

    try {
      const request = await startPassportZkRequest({
        ageThreshold,
        metadata: {
          name: env.zkPassportRequestName,
          logo: env.zkPassportRequestLogo,
          purpose: env.zkPassportRequestPurpose,
          scope: env.zkPassportRequestScope,
        },
        devMode: env.zkPassportDevMode,
        onEvent: (event: ZkPassportLifecycleEvent) => {
          switch (event.type) {
            case "request_created":
              setGhostContextStage("awaiting_scan");
              setStatusMessage("Ghost derivation zkPassport request created. Scan QR code or open the deep link.");
              appendLog(`Ghost derivation zkPassport request created: ${event.requestId}`);
              break;
            case "bridge_connected":
              setStatusMessage("Ghost derivation zkPassport bridge connected.");
              appendLog("Ghost derivation zkPassport bridge connected");
              break;
            case "request_received":
              setGhostContextStage("request_received");
              setStatusMessage("Ghost derivation zkPassport request received on mobile app.");
              appendLog("Ghost derivation zkPassport request received on mobile app");
              break;
            case "generating_proof":
              setGhostContextStage("generating_proof");
              setStatusMessage("zkPassport is generating proof(s) for ghost derivation.");
              appendLog("zkPassport generating proof(s) for ghost derivation");
              break;
            case "proof_generated":
              setGhostContextStage("proof_generated");
              setGhostContextProofCount(event.proofCount);
              setStatusMessage(`zkPassport proof generated for ghost derivation (${event.proofCount}).`);
              appendLog(`zkPassport proof generated for ghost derivation (${event.proofCount})`);
              break;
            case "result_received":
              setGhostContextStage("result_received");
              setStatusMessage("zkPassport returned results. Deriving ghost recovery context locally.");
              appendLog(`Ghost derivation zkPassport result received (verified=${event.verified})`);
              break;
          }
        },
      });
      setActiveGhostContextRequest(request);

      void request.completion
        .then(async (completion) => {
          if (completion.status === "rejected") {
            setActiveGhostContextRequest(null);
            setGhostContextStage("rejected");
            setStatusMessage("Ghost derivation zkPassport request rejected by user.");
            appendLog("Ghost derivation zkPassport request rejected");
            return;
          }

          if (!completion.uniqueIdentifier) {
            throw new Error("zkPassport result did not include uniqueIdentifier for ghost derivation.");
          }

          const result = await deriveGhostAccountPreview({
            uniqueIdentifier: completion.uniqueIdentifier,
            credentialType: ghostCredentialType,
            derivationVersion: env.zkPassportGhostDerivationVersion,
          });
          setGhostMaterialPreview({
            address: result.address,
            scope: result.material.scope,
            seedField: formatHex(result.material.seedField),
            rootCommitment: formatHex(result.rootCommitment),
          });
          setActiveGhostContextRequest(null);
          setGhostContextStage("derived");
          setStatusMessage("Derived ghost recovery context from fresh zkPassport proof.");
          appendLog("Derived ghost recovery context from fresh zkPassport proof");
        })
        .catch((caught) => {
          const message = errorMessage(caught);
          setActiveGhostContextRequest(null);
          setGhostContextStage("error");
          setError(`Ghost derivation zkPassport flow failed: ${message}`);
          setStatusMessage(`Ghost derivation zkPassport flow failed: ${message}`);
          appendLog(`Ghost derivation zkPassport flow failed: ${message}`);
        });
    } catch (caught) {
      const message = errorMessage(caught);
      setActiveGhostContextRequest(null);
      setGhostContextStage("error");
      setError(`Create zkPassport request for ghost derivation failed: ${message}`);
      setStatusMessage(`Create zkPassport request for ghost derivation failed: ${message}`);
      appendLog(`Create zkPassport request for ghost derivation failed: ${message}`);
    }
  };

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Magna x Aztec</p>
        <h1>Magna Browser Console</h1>
        <p className="body-copy">
          This screen combines wallet onboarding, local-dev issuance, user verification, operator sponsorship tools,
          and admin diagnostics. Nothing below is a single linear user journey, so the layout is grouped by role and
          workflow instead of presenting everything as one flat dashboard.
        </p>
        <div className="hero-map">
          <div className="hero-map-card">
            <p className="label">1. Setup</p>
            <p className="muted-text">Inspect runtime wiring, connect an external wallet, or create/use the passkey in-app wallet.</p>
          </div>
          <div className="hero-map-card">
            <p className="label">2. User Verification</p>
            <p className="muted-text">Issue a dev credential, sync hinted notes, then run plain or sponsored verify.</p>
          </div>
          <div className="hero-map-card">
            <p className="label">3. Operator Funding</p>
            <p className="muted-text">Inspect sponsor rights, fund primarily through L1 portal purchase + L2 claim, or use L2 fallback.</p>
          </div>
          <div className="hero-map-card">
            <p className="label">4. Diagnostics</p>
            <p className="muted-text">Inspect contract surface, derive ghost context, and use issuer admin helpers.</p>
          </div>
        </div>
        <div className="status-banner" data-testid="status-banner">
          {statusMessage}
        </div>
        {error ? (
          <div className="error-banner" data-testid="error-banner">
            {error}
          </div>
        ) : null}
      </section>

      <WorkflowSection
        eyebrow="Setup"
        title="Network And Session Setup"
        description="Use this group first. It answers three questions: what contracts the app is pointed at, whether chain/deployment state changed, and which wallet/account mode is currently active."
      >
        <Panel
          testId="panel-runtime"
          title="Runtime"
          badge="Wiring"
          description="Read-only env wiring for the current frontend instance. If something behaves strangely, confirm these addresses and flags before debugging anything else."
        >
          <KeyValue label="Aztec node" value={env.aztecNodeUrl} />
          <KeyValue label="Detected chain identity" value={chainIdentityLabel} />
          <KeyValue label="App id" value={env.appId} />
          <KeyValue label="Verification API" value={env.verificationApiUrl ?? "not configured"} />
          <KeyValue label="zkPassport request scope" value={env.zkPassportRequestScope} />
          <KeyValue label="zkPassport primary issuance mode" value={env.zkPassportPrimaryIssuanceMode} />
          <KeyValue label="Ghost derivation version" value={env.zkPassportGhostDerivationVersion} />
          <KeyValue label="Issuer" value={env.issuerAddress ?? "not configured"} />
          <KeyValue label="Company sponsor count" value={String(env.companySponsors.length)} />
          <KeyValue label="Active sponsor" value={env.activeCompanySponsorAddress ?? "not configured"} />
          {env.companySponsors.length > 0 ? (
            <div className="sub-card">
              <p className="label">Configured sponsor catalog</p>
              {env.companySponsors.map((sponsor, index) => (
                <KeyValue
                  key={`catalog-${sponsor.address}`}
                  label={`Sponsor ${index + 1}${sponsor.isActiveDefault ? " (active)" : ""}`}
                  value={sponsor.address}
                />
              ))}
            </div>
          ) : (
            <p className="muted-text">No configured company sponsors.</p>
          )}
          <KeyValue label="Rights registry" value={env.rightsRegistryAddress ?? "not configured"} />
          <KeyValue label="L2 purchase adapter" value={env.rightsPurchaseL2Address ?? "not configured"} />
          <KeyValue label="L2 payment token" value={env.l2PaymentTokenAddress ?? "not configured"} />
          <KeyValue label="L1 RPC" value={env.l1RpcUrl ?? "not configured"} />
          <KeyValue label="L1 rights portal" value={env.l1RightsPortalAddress ?? "not configured"} />
          <KeyValue label="L1 payment token" value={env.l1PaymentTokenAddress ?? "not configured"} />
          <KeyValue label="Orchestrator" value={env.orchestratorAddress ?? "local test bootstrap"} />
          <KeyValue label="Sponsor profile" value={env.sponsorProfileName} />
          <KeyValue label="Discovery timeout" value={`${env.walletDiscoveryTimeoutMs}ms`} />
          <KeyValue label="Real sends required" value={env.requireRealSends ? "yes" : "no"} />
          <KeyValue
            label="Extension allow-list"
            value={env.walletExtensionAllowList.length > 0 ? env.walletExtensionAllowList.join(", ") : "none"}
          />
          <KeyValue
            label="Extension block-list"
            value={env.walletExtensionBlockList.length > 0 ? env.walletExtensionBlockList.join(", ") : "none"}
          />
          <KeyValue label="Managed wallets" value={env.enableManagedWallets ? "enabled" : "disabled"} />
          <KeyValue label="Dev orchestrator" value={env.enableDevOrchestrator ? "enabled" : "disabled"} />
          {chainResetNotice ? (
            <div className="sub-card">
              <p className="label">Chain reset guard</p>
              <p className="muted-text">{chainResetNotice}</p>
            </div>
          ) : null}
          <p className="muted-text">
            External wallet is the extension path. In-app wallet uses passkey-authenticated secp256r1 derivation; managed fallback stays local-dev only.
          </p>
        </Panel>

        <Panel
          testId="panel-external-wallets"
          title="External Wallets"
          badge="User Path"
          description="Canonical browser wallet onboarding path. Discover extension wallets, open a secure channel, and confirm the emoji handshake before a session is created."
        >
          {externalSession ? (
            <div className="sub-card">
              <p className="label">Connection status</p>
              <KeyValue label="State" value="Connected" />
              <KeyValue label="Wallet" value={externalSession.label} />
              <KeyValue label="Provider id" value={externalSession.metadata?.providerId ?? "unknown"} />
              <KeyValue label="Wallet version" value={externalSession.metadata?.walletVersion ?? "unknown"} />
              <KeyValue label="Granted capabilities" value={externalSession.metadata?.grantedCapabilities ?? "unknown"} />
              <KeyValue label="Active account" value={activeAccount?.address ?? externalSession.activeAccount.address} />
              <div className="button-row">
                <button className="secondary-button" disabled={busyAction !== null} onClick={() => void handleDisconnect()}>
                  Disconnect external wallet
                </button>
              </div>
            </div>
          ) : null}
          <div className="button-row">
            <button
              data-testid="discover-wallets"
              disabled={busyAction !== null || isDiscovering || externalSession !== null}
              onClick={() => void handleDiscoverWallets()}
            >
              {externalSession ? "External wallet connected" : isDiscovering ? "Discovering..." : "Discover extension wallets"}
            </button>
            <button
              data-testid="cancel-discovery"
              className="secondary-button"
              disabled={busyAction !== null || !isDiscovering}
              onClick={() => {
                discoveryRef.current?.cancel();
                discoveryRef.current = null;
                setIsDiscovering(false);
                setStatusMessage("External wallet discovery cancelled.");
                appendLog("External wallet discovery cancelled");
              }}
            >
              Cancel discovery
            </button>
          </div>
          {providers.length === 0 ? (
            <p className="muted-text">
              {isDiscovering ? "Waiting for an approved wallet provider..." : "No wallet providers discovered yet."}
            </p>
          ) : null}
          <div className="stack-list">
            {providers.map((provider, index) => {
              const isConnectedProvider = connectedExternalProviderId === provider.id;
              return (
                <button
                  key={provider.id}
                  data-testid={`connect-provider-${index}`}
                  className="secondary-button"
                  disabled={busyAction !== null || isConnectedProvider}
                  onClick={() => void handleBeginExternalConnection(index)}
                >
                  {isConnectedProvider ? `Connected to ${provider.name}` : `Connect ${provider.name}`}
                </button>
              );
            })}
          </div>
          {pendingConnection ? (
            <div className="sub-card">
              <p className="label">Compare these wallet-sdk emojis with your wallet UI</p>
              <p className="emoji-grid">{pendingConnection.emojiGrid}</p>
              <p className="muted-text">
                The wallet should already have shown its own emoji grid during secure-channel setup. After you verify
                the emojis match, finishing here finalizes the encrypted session and may ask the wallet to approve the
                Aztec capabilities Magna needs, starting with account access.
              </p>
              <div className="button-row">
                <button data-testid="confirm-secure-channel" disabled={busyAction !== null} onClick={() => void handleConfirmExternalConnection()}>
                  Finish wallet connection
                </button>
                <button
                  data-testid="cancel-secure-channel"
                  className="secondary-button"
                  disabled={busyAction !== null}
                  onClick={() => {
                    pendingConnection.pending.cancel();
                    setPendingConnection(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel
          testId="panel-managed-wallet"
          title="Magna Passkey Wallet"
          badge="In-App Path"
          description="Primary in-app wallet path: authenticate with passkey, deterministically derive secp256r1 account material, and open an embedded wallet session. Local managed bootstrap remains available as fallback."
        >
          <Field label="Wallet alias">
            <input value={managedAlias} onChange={event => setManagedAlias(event.target.value)} />
          </Field>
          <KeyValue label="WebAuthn support" value={passkeyCapability?.isSupported ? "yes" : "no"} />
          <KeyValue label="Conditional UI" value={passkeyCapability?.hasConditionalUi ? "yes" : "no"} />
          <KeyValue label="Platform authenticator" value={passkeyCapability?.hasPlatformAuthenticator ? "yes" : "no"} />
          <div className="button-row">
            <button
              data-testid="create-passkey-wallet"
              disabled={busyAction !== null || !passkeyCapability?.isSupported}
              onClick={() => void handleCreateOrUsePasskeyWallet()}
            >
              {passkeyRecord ? "Use saved passkey wallet" : "Create Magna passkey wallet"}
            </button>
            <button
              data-testid="use-stored-passkey-wallet"
              className="secondary-button"
              disabled={busyAction !== null || !passkeyCapability?.isSupported}
              onClick={() => void handleUseStoredPasskeyWallet()}
            >
              Use stored passkey wallet
            </button>
            <button
              className="secondary-button"
              disabled={busyAction !== null || !passkeyRecord}
              onClick={() => handleForgetPasskeyWallet()}
            >
              Forget stored passkey
            </button>
          </div>
          {passkeyRecord ? (
            <div className="sub-card">
              <KeyValue label="Stored credential id" value={passkeyRecord.credentialId} />
              <KeyValue label="Passkey RP id" value={passkeyRecord.rpId} />
              <KeyValue label="Stored user label" value={passkeyRecord.userName} />
              <KeyValue label="Created at" value={passkeyRecord.createdAt} />
            </div>
          ) : (
            <p className="muted-text">No passkey record saved yet for this browser profile.</p>
          )}

          <Field label="Fallback account flavor">
            <select value={managedFlavor} onChange={event => setManagedFlavor(event.target.value as ManagedAccountFlavor)}>
              <option value="schnorr">Schnorr</option>
              <option value="secp256r1">secp256r1 / P-256</option>
            </select>
          </Field>
          <p className="muted-text">
            Bootstrap source: {env.enableLocalTestBootstrap ? `local test account #${env.localTestAccountIndex}` : "disabled"}
          </p>
          <button
            data-testid="create-managed-wallet"
            disabled={!env.enableManagedWallets || busyAction !== null}
            onClick={() => void handleCreateManagedWallet()}
          >
            Create managed fallback wallet
          </button>
        </Panel>

        <Panel
          testId="panel-session"
          title="Session"
          badge="Current User"
          description="The selected active account becomes the user identity for note sync and verify actions. Session metadata also exposes fee-payer and recovery details when available."
        >
          {session ? (
            <>
              <KeyValue label="Session kind" value={session.kind} />
              <KeyValue label="Wallet label" value={session.label} />
              {session.metadata
                ? Object.entries(session.metadata).map(([key, value]) => <KeyValue key={key} label={key} value={value} />)
                : null}
              <Field label="Active account">
                <select value={selectedAccount} onChange={event => setSelectedAccount(event.target.value)}>
                  {session.accounts.map(account => (
                    <option key={account.address} value={account.address}>
                      {account.alias || "unnamed"} - {account.address}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="secondary-button" disabled={busyAction !== null} onClick={() => void handleDisconnect()}>
                Disconnect
              </button>
            </>
          ) : (
            <p className="muted-text">No wallet session connected yet.</p>
          )}
        </Panel>
      </WorkflowSection>

      <WorkflowSection
        eyebrow="User Flow"
        title="Credential Readiness And Verification"
        description="The sequence is: choose a session account, start zkPassport rooted onboarding with an age threshold, let zkPassport disclose canonical passport claims, prepare the ghost recovery authority without retaining local ghost state, then fetch hints and verify. A separate dev-only legacy issuance fallback remains below for debugging."
      >
        <Panel
          testId="panel-credential-issuance"
          title="Credential Issuance"
          badge="zkPassport Primary"
          description="Primary path: start a zkPassport request, complete proof generation on mobile, verify on the dedicated backend, and issue rooted passport lineage through the orchestrator. Nationality and passport expiry come from zkPassport, not manual entry."
        >
          <ZkPassportRequestEditor
            ageThreshold={claimsForm.ageThreshold}
            onAgeThresholdChange={ageThreshold =>
              setClaimsForm(current => ({
                ...current,
                ageThreshold,
              }))
            }
            lastIssue={zkPassportLastIssue}
          />
          <div className="button-row">
            <button
              data-testid="start-zkpassport-request"
              disabled={busyAction !== null || !activeAccount || hasActiveZkPassportRequest}
              onClick={() => void handleStartZkPassportIssuance()}
            >
              {hasActiveZkPassportRequest ? "zkPassport request in progress" : "Start zkPassport issuance"}
            </button>
            <button
              data-testid="cancel-zkpassport-request"
              className="secondary-button"
              disabled={busyAction !== null || activeZkRequest === null}
              onClick={() => handleCancelZkPassportRequest()}
            >
              Cancel zkPassport request
            </button>
          </div>
          <div className="sub-card">
            <KeyValue label="zkPassport stage" value={zkPassportStage} />
            <KeyValue label="Proofs generated" value={String(zkPassportProofCount)} />
            <KeyValue label="Verification API" value={env.verificationApiUrl ?? "not configured"} />
            <KeyValue label="Request scope" value={env.zkPassportRequestScope} />
            <KeyValue label="Issuance mode" value={env.zkPassportPrimaryIssuanceMode} />
            <KeyValue label="Ghost derivation version" value={env.zkPassportGhostDerivationVersion} />
            <KeyValue
              label="Proof mode"
              value={env.zkPassportDevMode ? "dev mode (mock proofs allowed)" : "strict mode (real proofs only)"}
            />
            {activeZkRequest ? <KeyValue label="Request id" value={activeZkRequest.requestId} /> : null}
          </div>
          {activeZkRequest ? (
            <div className="sub-card">
              <p className="label">Scan with zkPassport mobile app</p>
              <div style={{ background: "white", borderRadius: "12px", padding: "12px", width: "fit-content" }}>
                <QRCode value={activeZkRequest.url} size={180} />
              </div>
              <p className="muted-text">
                If you are on mobile, open directly:{" "}
                <a href={activeZkRequest.url} target="_blank" rel="noreferrer">
                  Open zkPassport request link
                </a>
              </p>
            </div>
          ) : null}
          {zkPassportLastIssue ? (
            <div className="sub-card">
              <KeyValue label="Latest issuance tx" value={zkPassportLastIssue.issuanceTxHash ?? "pending"} />
              <KeyValue label="Claims hash" value={zkPassportLastIssue.claimsHash} />
              <KeyValue
                label="Authenticity"
                value={
                  zkPassportLastIssue.issuanceKind === "pilot"
                    ? "PII-blind pilot (non-production; not passport-authentic)"
                    : "legacy zkPassport backend verification"
                }
              />
              <KeyValue label="Derived ghost wallet address (zkPassport flow)" value={zkPassportLastIssue.ghostOwner} />
              <KeyValue label="Root commitment" value={zkPassportLastIssue.rootCommitment} />
              <KeyValue label="Issuer mode" value={zkPassportLastIssue.mode} />
              <KeyValue label="Ghost derivation version" value={zkPassportLastIssue.ghostDerivationVersion} />
            </div>
          ) : null}
          {ghostLifecycle ? (
            <div className="sub-card">
              <p className="label">Ghost recovery authority preparation</p>
              <KeyValue label="Ghost address" value={ghostLifecycle.address} />
              <KeyValue label="Derivation version" value={ghostLifecycle.derivationVersion} />
              <KeyValue label="Derivation scope" value={ghostLifecycle.scope} />
              <KeyValue label="Deployment status" value={ghostLifecycle.deploymentStatus} />
              <KeyValue label="Local state handling" value={ghostLifecycle.localState} />
              <KeyValue label="Deployment payer" value={ghostLifecycle.feePayer} />
            </div>
          ) : null}

          {env.enableDevOrchestrator ? (
            <div className="sub-card">
              <p className="label">Dev fallback (local only)</p>
              <p className="muted-text">
                This path is separate from zkPassport-backed issuance. Use it only for local debugging when zkPassport or
                the verification API is unavailable.
              </p>
              <ClaimsFormEditor form={claimsForm} onChange={setClaimsForm} />
              <Field label="Scoped unique identifier field">
                <input
                  value={ghostIdentifierInput}
                  onChange={event => setGhostIdentifierInput(event.target.value)}
                  placeholder="decimal or 0x field value"
                />
              </Field>
              {ghostOwner ? (
                <div className="sub-card">
                  <KeyValue testId="issuance-derived-ghost-address" label="Derived ghost wallet address" value={ghostOwner} />
                </div>
              ) : (
                <p className="muted-text">Enter a scoped unique identifier to derive the ghost wallet address used for issuance.</p>
              )}
              <button
                data-testid="issue-passport"
                disabled={busyAction !== null || !activeAccount || hasActiveZkPassportRequest}
                onClick={() => void handleIssuePassport()}
              >
                Issue passport credential (dev fallback)
              </button>
            </div>
          ) : null}
        </Panel>

        <Panel
          testId="panel-readiness"
          title="Readiness"
          badge="Private Notes"
          description="Registers the orchestrator sender in the wallet, then fetches hinted notes for the selected account and current claims hash. Rooted lineage also loads root-status and root-authority hints."
        >
          <button
            data-testid="fetch-hints"
            disabled={busyAction !== null || !activeAccount || !env.issuerAddress || hasActiveZkPassportRequest || isAwaitingReissue}
            onClick={() => void handleFetchHints()}
          >
            {isAwaitingReissue ? "Re-issue required before fetching hints" : "Fetch hinted notes"}
          </button>
          {hints ? (
            <div className="sub-card">
              <KeyValue testId="readiness-claims-hash" label="Claims hash" value={hints.claimsHash} />
              <KeyValue label="Issuance lineage" value={isRootedPassportHints(hints) ? "rooted" : "legacy-rootless"} />
              <KeyValue label="Credential note" value="loaded" />
              <KeyValue label="Status note" value="loaded" />
              {isRootedPassportHints(hints) ? (
                <>
                  <KeyValue label="Root commitment" value={hints.rootCommitment} />
                  <KeyValue label="Root status note" value="loaded" />
                  <KeyValue label="Root authority note" value="loaded" />
                  <KeyValue label="Linked recovery note" value={hints.hintedLinkedRecoveryNote ? "loaded" : "not loaded"} />
                </>
              ) : null}
            </div>
          ) : (
            <p className="muted-text">Fetch hinted notes after issuance or when pointing at an already-issued credential.</p>
          )}
        </Panel>

        <Panel
          testId="panel-verify"
          title="Verify"
          badge="Real Sends"
          description="Runs the user-facing proof path with real sends only. Ghost state is recovery-only and is not retained locally for routine verify actions."
        >
          <PolicyFormEditor form={policyForm} onChange={setPolicyForm} />
          <Field label="Sponsor gateway">
            <select
              data-testid="sponsor-select-verify"
              value={selectedSponsorAddress}
              onChange={event => setSelectedSponsorAddress(event.target.value)}
              disabled={configuredSponsors.length === 0}
            >
              {configuredSponsors.length === 0 ? <option value="">No sponsor configured</option> : null}
              {configuredSponsors.map(sponsor => (
                <option key={`verify-${sponsor.address}`} value={sponsor.address}>
                  {sponsor.isActiveDefault ? "[active] " : ""}
                  {sponsor.address}
                </option>
              ))}
            </select>
          </Field>
          <div className="button-row">
            <button
              data-testid="verify"
              disabled={busyAction !== null || !hints || !activeAccount || !env.requireRealSends}
              onClick={() => void handleVerify()}
            >
              Verify with Magna
            </button>
            <button
              data-testid="sponsored-verify"
              className="secondary-button"
              disabled={busyAction !== null || !hints || !activeAccount || !selectedSponsorAddress || !env.requireRealSends}
              onClick={() => void handleSponsoredVerify()}
            >
              Sponsored verify
            </button>
          </div>
          <p className="muted-text">
            Ghost recovery is recovery-only. This screen does not keep local ghost account state; fresh zkPassport
            reproving is required before ghost-side recovery actions are re-established.
          </p>
          {!env.requireRealSends ? (
            <p className="muted-text">
              This app forbids fake success paths. Set <code>VITE_MAGNA_REQUIRE_REAL_SENDS=true</code> to run critical flows.
            </p>
          ) : null}
        </Panel>
      </WorkflowSection>

      <WorkflowSection
        eyebrow="User Flow"
        title="Renewal"
        description="Renewal is separate from verify. It is the rooted passport renewal path that keeps the same `root_commitment` while rotating the renewable passport-backed authority note and reminting the linked passport lineage."
      >
        <Panel
          testId="panel-renewal"
          title="Renewal"
          badge="Rooted Passport"
          description="Use this when the passport-backed rooted authority needs to be renewed under the existing root. This starts a fresh zkPassport proof flow, then asks the backend orchestrator to refresh rooted authority on-chain."
        >
          <div className="button-row">
            <button
              data-testid="refresh-root-authority"
              className="secondary-button"
              disabled={busyAction !== null || !hints || !isRootedPassportHints(hints) || !env.requireRealSends || hasActiveZkPassportRequest}
              onClick={() => void handleRefreshRootAuthority()}
            >
              Start zkPassport renewal
            </button>
            <button
              className="secondary-button"
              disabled={busyAction !== null || activeRenewalRequest === null}
              onClick={() => handleCancelRenewalRequest()}
            >
              Cancel renewal request
            </button>
          </div>
          <div className="sub-card">
            <KeyValue label="zkPassport stage" value={renewalStage} />
            <KeyValue label="Proofs generated" value={String(renewalProofCount)} />
            <KeyValue label="Verification API" value={env.verificationApiUrl ?? "not configured"} />
            <KeyValue label="Request scope" value={env.zkPassportRequestScope} />
            <KeyValue
              label="Proof mode"
              value={env.zkPassportDevMode ? "dev mode (mock proofs allowed)" : "strict mode (real proofs only)"}
            />
            {activeRenewalRequest ? <KeyValue label="Request id" value={activeRenewalRequest.requestId} /> : null}
          </div>
          {activeRenewalRequest ? (
            <div className="sub-card">
              <p className="label">Scan with zkPassport mobile app</p>
              <div style={{ background: "white", borderRadius: "12px", padding: "12px", width: "fit-content" }}>
                <QRCode value={activeRenewalRequest.url} size={180} />
              </div>
              <p className="muted-text">
                If you are on mobile, open directly:{" "}
                <a href={activeRenewalRequest.url} target="_blank" rel="noreferrer">
                  Open zkPassport request link
                </a>
              </p>
            </div>
          ) : null}
          {zkPassportLastRenewal ? (
            <div className="sub-card">
              <KeyValue label="Latest renewal tx" value={zkPassportLastRenewal.renewalTxHash ?? "pending"} />
              <KeyValue label="Claims hash" value={zkPassportLastRenewal.claimsHash} />
              <KeyValue label="Ghost owner used" value={zkPassportLastRenewal.ghostOwner} />
              <KeyValue label="Root commitment" value={zkPassportLastRenewal.rootCommitment} />
            </div>
          ) : null}
          <p className="muted-text">
            "Passport authority" is the renewable rooted note that keeps linked passport verifies valid under the same
            `root_commitment` after passport renewal or replacement. It is not the root itself and it is not the ghost
            wallet.
          </p>
          <p className="muted-text">
            This renewal flow now requires a fresh zkPassport proof before the backend orchestrator sends the on-chain
            `refresh_root_authority(...)` call.
          </p>
          {!env.requireRealSends ? (
            <p className="muted-text">
              This app forbids fake success paths. Set <code>VITE_MAGNA_REQUIRE_REAL_SENDS=true</code> to run critical flows.
            </p>
          ) : null}
        </Panel>
      </WorkflowSection>

      <WorkflowSection
        eyebrow="User Flow"
        title="Recovery"
        description="Recovery is root-wide authority rotation. It requires a fresh zkPassport proof, server preflight verification, deterministic ghost re-derivation, and an on-chain `recover_root(...)` send from the ghost account."
      >
        <Panel
          testId="panel-recovery"
          title="Rooted Recovery"
          badge="Root Kill-Switch"
          description="Use this only when rooted lineage authority must be rotated to a new active owner account. This is not daily verify and not renewal."
        >
          <div className="button-row">
            <button
              data-testid="recover-root"
              className="secondary-button"
              disabled={
                busyAction !== null ||
                !activeAccount ||
                !hints ||
                !isRootedPassportHints(hints) ||
                !env.verificationApiUrl ||
                !env.requireRealSends ||
                !session ||
                session.kind === "external" ||
                hasActiveZkPassportRequest
              }
              onClick={() => void handleRecoverRoot()}
            >
              Start rooted recovery
            </button>
            <button
              className="secondary-button"
              disabled={busyAction !== null || activeRecoveryRequest === null}
              onClick={() => handleCancelRecoveryRequest()}
            >
              Cancel recovery request
            </button>
          </div>
          <div className="sub-card">
            <KeyValue label="zkPassport stage" value={recoveryStage} />
            <KeyValue label="Proofs generated" value={String(recoveryProofCount)} />
            <KeyValue label="Verification API" value={env.verificationApiUrl ?? "not configured"} />
            <KeyValue label="Request scope" value={env.zkPassportRequestScope} />
            <KeyValue
              label="Proof mode"
              value={env.zkPassportDevMode ? "dev mode (mock proofs allowed)" : "strict mode (real proofs only)"}
            />
            {activeRecoveryRequest ? <KeyValue label="Request id" value={activeRecoveryRequest.requestId} /> : null}
          </div>
          {activeRecoveryRequest ? (
            <div className="sub-card">
              <p className="label">Scan with zkPassport mobile app</p>
              <div style={{ background: "white", borderRadius: "12px", padding: "12px", width: "fit-content" }}>
                <QRCode value={activeRecoveryRequest.url} size={180} />
              </div>
              <p className="muted-text">
                If you are on mobile, open directly:{" "}
                <a href={activeRecoveryRequest.url} target="_blank" rel="noreferrer">
                  Open zkPassport request link
                </a>
              </p>
            </div>
          ) : null}
          {zkPassportLastRecoveryPreflight ? (
            <div className="sub-card">
              <KeyValue label="Preflight expected ghost owner" value={zkPassportLastRecoveryPreflight.expectedGhostOwner} />
              <KeyValue label="Preflight derived ghost owner" value={zkPassportLastRecoveryPreflight.derivedGhostOwner} />
              <KeyValue label="Ghost derivation version" value={zkPassportLastRecoveryPreflight.ghostDerivationVersion} />
              <KeyValue label="Latest recovery tx" value={lastRootRecoveryTxHash ?? "not yet sent"} />
            </div>
          ) : null}
          <p className="muted-text">
            Recovery runs from ghost authority and emits a root nullifier, so old linked descendants become unusable until
            rooted lineage is re-issued and re-linked from supported flows.
          </p>
          <p className="muted-text">
            After successful recovery, fetch rooted hints again only after re-issuing rooted passport lineage.
          </p>
          {!env.requireRealSends ? (
            <p className="muted-text">
              This app forbids fake success paths. Set <code>VITE_MAGNA_REQUIRE_REAL_SENDS=true</code> to run critical flows.
            </p>
          ) : null}
        </Panel>
      </WorkflowSection>

      <WorkflowSection
        eyebrow="Operator"
        title="Sponsor Budget Operations"
        description="These panels are not normal end-user actions. They are for inspecting sponsorship state and funding more rights for a selected sponsor gateway."
      >
        <Panel
          testId="panel-sponsor-rights"
          title="Sponsor Rights (Operator)"
          badge="Funding"
          description="Reads sponsor rights state from the rights registry. Primary path buys rights from L1 through the rights portal, then claims on L2. L2 purchase remains as a local fallback."
        >
          <Field label="Sponsor address (Aztec)">
            <select
              data-testid="sponsor-select-rights"
              value={rightsSponsorAddress}
              onChange={event => setRightsSponsorAddress(event.target.value)}
              disabled={configuredSponsors.length === 0}
            >
              {configuredSponsors.length === 0 ? <option value="">No sponsor configured</option> : null}
              {configuredSponsors.map(sponsor => (
                <option key={`rights-${sponsor.address}`} value={sponsor.address}>
                  {sponsor.isActiveDefault ? "[active] " : ""}
                  {sponsor.address}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Top-up rights amount">
            <input value={rightsTopUpAmount} onChange={event => setRightsTopUpAmount(event.target.value)} />
          </Field>
          <Field label="Top-up package id (optional bigint)">
            <input value={rightsPackageId} onChange={event => setRightsPackageId(event.target.value)} placeholder="random when empty" />
          </Field>
          <Field label="L1 extra policy hash (optional 0x hex)">
            <input
              value={rightsExtraPolicyHash}
              onChange={event => setRightsExtraPolicyHash(event.target.value)}
              placeholder="random 32-byte value when empty"
            />
          </Field>
          <div className="button-row">
            <button
              data-testid="read-rights-state"
              disabled={busyAction !== null || !activeAccount || !rightsSponsorAddress}
              onClick={() => void handleReadSponsorRights()}
            >
              Read rights state
            </button>
            <button
              data-testid="topup-rights-l1"
              disabled={
                busyAction !== null || !activeAccount || !rightsSponsorAddress || !env.requireRealSends || !hasL1FundingConfig
              }
              onClick={() => void handleTopUpSponsorRightsFromL1()}
            >
              Top up rights (L1 primary)
            </button>
            <button
              data-testid="topup-rights-l2"
              className="secondary-button"
              disabled={busyAction !== null || !activeAccount || !rightsSponsorAddress || !env.requireRealSends}
              onClick={() => void handleTopUpSponsorRights()}
            >
              Top up rights (L2 fallback)
            </button>
          </div>
          {!hasL1FundingConfig ? (
            <p className="muted-text">
              Configure <code>VITE_MAGNA_L1_RPC_URL</code>, <code>VITE_MAGNA_L1_RIGHTS_PORTAL_ADDRESS</code>,{" "}
              <code>VITE_MAGNA_L1_PAYMENT_TOKEN_ADDRESS</code>, and <code>VITE_MAGNA_L1_BUYER_PRIVATE_KEY</code> to use the
              primary L1 funding path.
            </p>
          ) : null}
          {rightsSnapshot ? (
            <div className="sub-card">
              <KeyValue testId="rights-remaining-verifies" label="Remaining verifies" value={rightsSnapshot.remainingVerifies.toString()} />
              <KeyValue testId="rights-consumed-verifies" label="Consumed verifies" value={rightsSnapshot.consumedVerifies.toString()} />
              <KeyValue label="Last credit nonce" value={rightsSnapshot.lastCreditNonce.toString()} />
              <KeyValue label="Latest package id" value={rightsSnapshot.latestPackageId.toString()} />
              <KeyValue testId="rights-next-purchase-id" label="Next purchase id" value={rightsSnapshot.nextPurchaseId.toString()} />
              <KeyValue label="L2 price per verify" value={rightsSnapshot.l2PricePerVerify.toString()} />
              <KeyValue label="Rights registry" value={rightsSnapshot.rightsRegistryAddress} />
              <KeyValue label="L2 purchase adapter" value={rightsSnapshot.rightsPurchaseAddress} />
              <KeyValue label="L2 payment token" value={rightsSnapshot.paymentTokenAddress} />
              <KeyValue label="Purchase treasury" value={rightsSnapshot.purchaseTreasuryAddress} />
            </div>
          ) : (
            <p className="muted-text">No sponsor rights snapshot loaded yet.</p>
          )}
          {lastTopUpOutcome ? (
            <div className="sub-card">
              <KeyValue testId="rights-last-topup-tx-hash" label="Last top-up tx hash" value={lastTopUpOutcome.txHash ?? "unknown"} />
              <KeyValue testId="rights-last-topup-purchase-id" label="Purchase id" value={lastTopUpOutcome.purchaseId.toString()} />
              <KeyValue testId="rights-last-topup-rights-amount" label="Rights amount" value={lastTopUpOutcome.rightsAmount.toString()} />
              <KeyValue label="Payment amount" value={lastTopUpOutcome.paymentAmount.toString()} />
              <KeyValue label="Package id" value={lastTopUpOutcome.packageId.toString()} />
            </div>
          ) : null}
          {lastL1TopUpOutcome ? (
            <div className="sub-card">
              <KeyValue label="Last L1 purchase tx hash" value={lastL1TopUpOutcome.purchaseTxHash} />
              <KeyValue label="Last L1 approve tx hash" value={lastL1TopUpOutcome.approveTxHash} />
              <KeyValue label="Last L2 claim tx hash" value={lastL1TopUpOutcome.claimTxHash} />
              <KeyValue label="L1 purchase id" value={lastL1TopUpOutcome.purchaseId.toString()} />
              <KeyValue label="L1 credit nonce" value={lastL1TopUpOutcome.creditNonce} />
              <KeyValue label="L1 message leaf index" value={lastL1TopUpOutcome.messageLeafIndex.toString()} />
              <KeyValue label="Rights amount (L1)" value={lastL1TopUpOutcome.rightsAmount.toString()} />
              <KeyValue label="Payment amount (L1)" value={lastL1TopUpOutcome.paymentAmount.toString()} />
            </div>
          ) : null}
        </Panel>
      </WorkflowSection>

      <WorkflowSection
        eyebrow="Diagnostics"
        title="Recovery-Only Ghost Diagnostics, Compatibility, And Admin Helpers"
        description="These panels explain or inspect recovery-oriented ghost derivation and deployment details. They are debug/admin helpers and are not part of the normal verification flow."
      >
        <Panel
          testId="panel-ghost-context"
          title="Ghost Recovery Derivation Context"
          badge="Derived Data"
          description="Debug-only helper for inspecting ghost recovery derivation from a fresh zkPassport proof. This does not ask for raw uniqueIdentifier input; it derives locally from zkPassport exactly like rooted issuance does."
        >
          <Field label="Credential type for scope">
            <select value={String(ghostCredentialType)} onChange={event => setGhostCredentialType(Number(event.target.value) as CredentialType)}>
              <option value={String(CredentialType.Passport)}>Passport</option>
              <option value={String(CredentialType.Instagram)}>Instagram</option>
            </select>
          </Field>
          <div className="button-row">
            <button
              data-testid="derive-ghost-context"
              disabled={busyAction !== null || hasActiveZkPassportRequest}
              onClick={() => void handleDeriveGhostContext()}
            >
              Derive from fresh zkPassport proof
            </button>
            <button
              className="secondary-button"
              disabled={busyAction !== null || activeGhostContextRequest === null}
              onClick={() => handleCancelGhostContextRequest()}
            >
              Cancel ghost derivation request
            </button>
          </div>
          <div className="sub-card">
            <KeyValue label="zkPassport stage" value={ghostContextStage} />
            <KeyValue label="Proofs generated" value={String(ghostContextProofCount)} />
            <KeyValue label="Request scope" value={env.zkPassportRequestScope} />
            {activeGhostContextRequest ? <KeyValue label="Request id" value={activeGhostContextRequest.requestId} /> : null}
          </div>
          {activeGhostContextRequest ? (
            <div className="sub-card">
              <p className="label">Scan with zkPassport mobile app</p>
              <div style={{ background: "white", borderRadius: "12px", padding: "12px", width: "fit-content" }}>
                <QRCode value={activeGhostContextRequest.url} size={180} />
              </div>
              <p className="muted-text">
                If you are on mobile, open directly:{" "}
                <a href={activeGhostContextRequest.url} target="_blank" rel="noreferrer">
                  Open zkPassport request link
                </a>
              </p>
            </div>
          ) : null}
          {ghostMaterialPreview ? (
            <div className="sub-card">
              <KeyValue label="Derivation source" value="fresh zkPassport proof" />
              <KeyValue label="Derived ghost wallet address" value={ghostMaterialPreview.address} />
              <KeyValue label="Configured derivation version" value={env.zkPassportGhostDerivationVersion} />
              <KeyValue label="Recovery scope" value={ghostMaterialPreview.scope} />
              <KeyValue label="Ghost seed field" value={ghostMaterialPreview.seedField} />
              <KeyValue testId="ghost-context-root-commitment" label="Root commitment" value={ghostMaterialPreview.rootCommitment} />
            </div>
          ) : (
            <p className="muted-text">Start a fresh zkPassport proof to derive context locally without exposing raw identifiers.</p>
          )}
        </Panel>

        <Panel
          testId="panel-contract-compatibility"
          title="Contract Compatibility"
          badge="Inspection"
          description="Shows which expected contract methods are available to the frontend and whether configured sponsors are currently authorized by the issuer."
        >
          <button data-testid="inspect-compatibility" disabled={busyAction !== null || !activeAccount} onClick={() => void handleInspectContractCompatibility()}>
            Inspect compatibility matrix
          </button>
          {compatibilityMatrix ? (
            <div className="sub-card">
              <CompatibilityGroup label="Issuer" map={compatibilityMatrix.issuer} />
              <CompatibilityGroup
                label={`Default sponsor${compatibilityMatrix.defaultSponsorAddress ? ` (${compatibilityMatrix.defaultSponsorAddress})` : ""}`}
                map={compatibilityMatrix.sponsor}
              />
              {Object.entries(compatibilityMatrix.sponsorByAddress).map(([address, map]) => (
                <CompatibilityGroup key={`sponsor-${address}`} label={`Sponsor ${address}`} map={map} />
              ))}
              <CompatibilityGroup label="Rights registry" map={compatibilityMatrix.rightsRegistry} />
              <CompatibilityGroup label="Rights purchase" map={compatibilityMatrix.rightsPurchase} />
            </div>
          ) : (
            <p className="muted-text">Run inspection after connecting an account session.</p>
          )}
          {sponsorRuntimeStatuses.length > 0 ? (
            <div className="sub-card">
              <p className="label">Issuer authorization status</p>
              {sponsorRuntimeStatuses.map(status => (
                <KeyValue
                  key={`issuer-auth-${status.sponsorAddress}`}
                  label={`${status.sponsorAddress}${status.isActiveDefault ? " (active)" : ""}`}
                  value={
                    status.isIssuerAuthorized === null
                      ? "unknown (method unavailable)"
                      : status.isIssuerAuthorized
                        ? "authorized"
                        : "not authorized"
                  }
                />
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel
          testId="panel-issuer-sponsor-admin"
          title="Issuer Sponsor Admin"
          badge="Admin"
          description="Issuer admin helper for onboarding sponsor gateways on the currently configured issuer deployment."
        >
          <Field label="Gateway candidate address">
            <input
              data-testid="gateway-candidate-address"
              value={gatewayCandidateAddress}
              onChange={event => setGatewayCandidateAddress(event.target.value)}
              placeholder="0x..."
            />
          </Field>
          <div className="button-row">
            <button
              data-testid="add-sponsor-gateway"
              disabled={busyAction !== null || !activeAccount || !gatewayCandidateAddress.trim() || !env.requireRealSends}
              onClick={() => void handleAddSponsorGateway()}
            >
              Add sponsor gateway
            </button>
            <button
              className="secondary-button"
              disabled={busyAction !== null || !activeAccount}
              onClick={() => void handleInspectContractCompatibility()}
            >
              Refresh sponsor status
            </button>
          </div>
          <p className="muted-text">
            This action succeeds only when the connected account is authorized to call issuer admin entrypoints.
          </p>
        </Panel>

      </WorkflowSection>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Activity Log</h2>
            <p className="panel-copy">Latest app actions, limited to the most recent ten entries.</p>
          </div>
        </div>
        {activityLog.length === 0 ? (
          <p className="muted-text">No actions recorded yet.</p>
        ) : (
          <div className="log-list">
            {activityLog.map(entry => (
              <code key={entry.id}>{entry.message}</code>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function WorkflowSection(props: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="workflow-section">
      <div className="workflow-section-header">
        <p className="eyebrow">{props.eyebrow}</p>
        <h2>{props.title}</h2>
        <p className="panel-copy">{props.description}</p>
      </div>
      <div className="grid-layout">{props.children}</div>
    </section>
  );
}

function Panel(props: { title: string; description: string; badge?: string; testId?: string; children: React.ReactNode }) {
  return (
    <section className="panel" data-testid={props.testId}>
      <div className="panel-header">
        <div>
          <div className="panel-title-row">
            <h2>{props.title}</h2>
            {props.badge ? <span className="panel-badge">{props.badge}</span> : null}
          </div>
          <p className="panel-copy">{props.description}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function KeyValue(props: { label: string; value: string; testId?: string }) {
  return (
    <div className="key-value" data-testid={props.testId}>
      <span>{props.label}</span>
      <code>{props.value}</code>
    </div>
  );
}

function CompatibilityGroup(props: { label: string; map: Record<string, boolean> }) {
  return (
    <>
      <p className="label">{props.label}</p>
      {Object.entries(props.map).map(([key, supported]) => (
        <KeyValue key={`${props.label}:${key}`} label={key} value={supported ? "supported" : "missing"} />
      ))}
    </>
  );
}

function ZkPassportRequestEditor(props: {
  ageThreshold: string;
  onAgeThresholdChange: (ageThreshold: string) => void;
  lastIssue: ZkPassportIssueState | null;
}) {
  const { ageThreshold, onAgeThresholdChange, lastIssue } = props;
  return (
    <>
      <p className="muted-text">
        The primary flow only asks for the age threshold up front. Nationality and passport expiry are derived from the
        verified zkPassport disclosure on the backend, not from manual form inputs. The default issuance lineage is
        rooted; legacy rootless mode should only be used as an explicit compatibility path.
      </p>
      <div className="field-grid">
        <Field label="zkPassport age proof threshold">
          <input value={ageThreshold} onChange={event => onAgeThresholdChange(event.target.value)} placeholder="18" />
        </Field>
      </div>
      {lastIssue?.issuanceKind === "legacy" ? (
        <div className="sub-card">
          <p className="label">Latest verified zkPassport claims</p>
          <KeyValue label="Nationality (alpha-3)" value={lastIssue.normalizedClaims.nationalityAlpha3} />
          <KeyValue label="Age threshold proven" value={String(lastIssue.normalizedClaims.minAgeProven)} />
          <KeyValue label="Passport expiry date" value={lastIssue.normalizedClaims.passportExpiryDate} />
        </div>
      ) : lastIssue?.issuanceKind === "pilot" ? (
        <div className="sub-card">
          <p className="label">Latest PII-blind pilot credential</p>
          <p className="muted-text">
            Pilot credentials are non-production and not passport-authentic. The pilot response intentionally omits
            normalized passport claims.
          </p>
        </div>
      ) : (
        <p className="muted-text">
          After a successful zkPassport issuance, the verified nationality and passport expiry will appear here and drive
          the later hint and verify steps.
        </p>
      )}
    </>
  );
}

function ClaimsFormEditor(props: { form: PassportClaimsForm; onChange: (form: PassportClaimsForm) => void }) {
  const { form, onChange } = props;
  return (
    <>
      <p className="muted-text">
        Local-only manual claims editor for the dev fallback path. The real zkPassport path does not trust manual
        nationality or passport expiry entry. The older upper-age placeholder is fixed internally.
      </p>
      <div className="field-grid">
        <Field label="Manual nationality (alpha-3)">
          <input
            value={form.nationalityAlpha3}
            onChange={event => onChange({ ...form, nationalityAlpha3: event.target.value })}
            placeholder="TUR"
          />
        </Field>
        <Field label="Manual age threshold">
          <input
            value={form.ageThreshold}
            onChange={event => onChange({ ...form, ageThreshold: event.target.value })}
            placeholder="18"
          />
        </Field>
        <Field label="Manual passport expiry date">
          <input
            type="date"
            value={form.passportExpiryDate}
            onChange={event => onChange({ ...form, passportExpiryDate: event.target.value })}
          />
        </Field>
      </div>
    </>
  );
}

function PolicyFormEditor(props: { form: PolicyForm; onChange: (form: PolicyForm) => void }) {
  const { form, onChange } = props;
  return (
    <>
      <p className="muted-text">
        Current passport verification policy checks the disclosed age threshold plus an optional single-country
        nationality rule. You can require a country, exclude a country, or leave nationality unconstrained.
      </p>
      <div className="field-grid">
        <Field label="Minimum age required">
          <input value={form.minimumAge} onChange={event => onChange({ ...form, minimumAge: event.target.value })} />
        </Field>
        <Field label="Nationality rule">
          <select
            value={form.nationalityMode}
            onChange={event =>
              onChange({
                ...form,
                nationalityMode: event.target.value as PolicyForm["nationalityMode"],
              })
            }
          >
            <option value="any">Any nationality</option>
            <option value="must_be">Must be</option>
            <option value="must_not_be">Must not be</option>
          </select>
        </Field>
        <Field label="Nationality country (alpha-3, optional)">
          <input
            value={form.nationalityAlpha3}
            onChange={event => onChange({ ...form, nationalityAlpha3: event.target.value })}
            placeholder="USA"
          />
        </Field>
        <Field label="Sponsor slot (dev / rate-limit test)">
          <input value={form.sponsorSlot} onChange={event => onChange({ ...form, sponsorSlot: event.target.value })} />
        </Field>
      </div>
    </>
  );
}
