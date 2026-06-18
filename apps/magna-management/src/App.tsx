import { useMemo, useState } from "react";
import QRCode from "react-qr-code";
import {
  CredentialType,
  createTransientGhostWalletSession,
  createWebAuthnWalletSession,
  loadStoredWebAuthnAccounts,
  MagnaBrowserClient,
  isRootedPassportHints,
  type PassportClaimsForm,
  type PassportHints,
  type RootedPassportHints,
  type SponsorRightsSnapshot,
  type SponsorRuntimeStatus,
  type WalletSession,
} from "@magna/wallet";
import { AuthorizePage } from "./AuthorizePage";
import { Threads } from "./components/Threads";
import { getManagementEnv } from "./lib/env";
import { navigate, useRoute } from "./lib/router";
import {
  loadCredentialRefs,
  loadWalletProfile,
  refsForOwner,
  saveWalletProfile,
  upsertCredentialRef,
  type StoredCredentialRef,
  type WalletProfile,
} from "./lib/storage";
import {
  startPassportZkRequest,
  verifyAndRefreshRootAuthorityThroughBackend,
  verifyAndIssueInstagramThroughBackend,
  verifyAndIssueThroughBackend,
  verifyRootRecoveryPreflightThroughBackend,
  type ActiveZkPassportRequest,
  type ZkPassportLifecycleEvent,
} from "./lib/zkpassport";

type Role = "user" | "company";

type Notice = {
  tone: "info" | "success" | "warning" | "danger";
  text: string;
};

type CredentialHintState = {
  status: "loading" | "loaded" | "error";
  hints?: PassportHints | RootedPassportHints;
  message?: string;
};

const DEFAULT_ALIAS = "magna-user";
const DEFAULT_COMPANY_ALIAS = "magna-company";
const WALLET_OPEN_MINIMUM_MS = 2_500;

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function passkeysSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

function canonicalInstagramHandle(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function credentialId(ref: Pick<StoredCredentialRef, "ownerAddress" | "kind" | "claimsHash">): string {
  return `${ref.ownerAddress}:${ref.kind}:${ref.claimsHash}`;
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

function isDeployedSession(session: WalletSession | null): boolean {
  return session?.metadata?.deploymentStatus === "deployed";
}

function isDeployedProfile(profile: WalletProfile | null): boolean {
  return profile?.deploymentStatus === "deployed";
}

function claimsFormFromRef(ref: StoredCredentialRef): PassportClaimsForm {
  if (!ref.normalizedClaims) {
    throw new Error("Credential reference is missing normalized passport claims.");
  }
  return {
    nationalityAlpha3: ref.normalizedClaims.nationalityAlpha3,
    ageThreshold: String(ref.normalizedClaims.minAgeProven),
    passportExpiryDate: ref.normalizedClaims.passportExpiryDate,
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read Instagram email file."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read Instagram email file as base64."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function App() {
  const env = useMemo(() => getManagementEnv(), []);
  const route = useRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [session, setSession] = useState<WalletSession | null>(null);
  const [walletProfile, setWalletProfile] = useState<WalletProfile | null>(() => loadWalletProfile());
  const [credentials, setCredentials] = useState<StoredCredentialRef[]>(() => loadCredentialRefs());
  const [credentialHints, setCredentialHints] = useState<Record<string, CredentialHintState>>({});
  const [zkRequest, setZkRequest] = useState<ActiveZkPassportRequest | null>(null);
  const [zkStage, setZkStage] = useState("idle");
  const [zkProofCount, setZkProofCount] = useState(0);
  const [ageThreshold, setAgeThreshold] = useState("18");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [instagramEmailFile, setInstagramEmailFile] = useState<File | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<WalletProfile | null>(null);
  const [latestRecoveryBundle, setLatestRecoveryBundle] = useState(() => walletProfile?.publicKey ?? "");
  const [storedPublicKeyInput, setStoredPublicKeyInput] = useState("");
  const [companySponsorAddress, setCompanySponsorAddress] = useState(env.activeCompanySponsorAddress ?? "");
  const [sponsorSnapshot, setSponsorSnapshot] = useState<SponsorRightsSnapshot | null>(null);
  const [sponsorStatuses, setSponsorStatuses] = useState<SponsorRuntimeStatus[]>([]);
  const [topUpRightsAmount, setTopUpRightsAmount] = useState("10");
  const [topUpPackageId, setTopUpPackageId] = useState("");
  const [gatewayCandidate, setGatewayCandidate] = useState(env.activeCompanySponsorAddress ?? "");

  const activeAddress = session?.activeAccount.address ?? walletProfile?.address;
  const activeCredentialRefs = useMemo(() => refsForOwner(activeAddress), [activeAddress, credentials]);
  const hasCredentials = activeCredentialRefs.length > 0;
  const storedPasskeyCount = useMemo(() => {
    if (typeof window === "undefined") return 0;
    return loadStoredWebAuthnAccounts(window.localStorage).length;
  }, [session]);

  async function runAction<T>(label: string, action: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    setNotice({ tone: "info", text: label });
    try {
      const result = await action();
      setNotice({ tone: "success", text: `${label} completed.` });
      return result;
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  function createClient(nextSession: WalletSession = session!): MagnaBrowserClient {
    if (!nextSession) throw new Error("Open a wallet session first.");
    if (!isDeployedSession(nextSession)) {
      throw new Error("This passkey wallet is counterfactual. Deploy it before running sponsor or credential actions.");
    }
    return new MagnaBrowserClient(nextSession.wallet, env, nextSession.activeAccount.address);
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
    return session;
  }

  async function loadHintsForCredentialRefs(nextSession: WalletSession, refs: StoredCredentialRef[]) {
    const passportRefs = refs.filter(ref => ref.kind === "passport" && ref.status === "active");
    if (passportRefs.length === 0 || !env.issuerAddress) return;

    const client = new MagnaBrowserClient(nextSession.wallet, env, nextSession.activeAccount.address);
    await client.syncOrchestratorSender();
    for (const ref of passportRefs) {
      setCredentialHints(current => ({
        ...current,
        [ref.id]: { status: "loading", message: "Fetching hinted notes" },
      }));
      try {
        const hints =
          ref.mode === "rooted" && ref.rootCommitment
            ? await client.fetchRootedPassportHintsByClaimsHash(ref.ownerAddress, ref.rootCommitment, ref.claimsHash)
            : await client.fetchPassportHintsByClaimsHash(ref.ownerAddress, ref.claimsHash);
        setCredentialHints(current => ({
          ...current,
          [ref.id]: { status: "loaded", hints, message: "Hinted notes loaded" },
        }));
      } catch (error) {
        setCredentialHints(current => ({
          ...current,
          [ref.id]: { status: "error", message: errorMessage(error) },
        }));
      }
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
    const refs = refsForOwner(nextSession.activeAccount.address);
    setCredentials(loadCredentialRefs());
    await loadHintsForCredentialRefs(nextSession, refs);
    setNotice({
      tone: refs.length > 0 ? "success" : "warning",
      text:
        refs.length > 0
          ? `Loaded ${refs.length} stored credential reference${refs.length === 1 ? "" : "s"} and started hinted-note sync.`
          : "No stored credential references found for this wallet. Start issuance next.",
    });
    if (role === "company") {
      route.go("/company");
    } else {
      route.go(refs.length > 0 ? "/user" : "/user/issue");
    }
  }

  async function openPasskeyWallet(role: Role, publicKeyRecoveryBundle?: string, captureRecoveryTarget = false) {
    if (!passkeysSupported()) {
      setNotice({ tone: "danger", text: "Passkeys are not supported in this browser." });
      return;
    }
    const label = publicKeyRecoveryBundle ? "Use stored passkey wallet" : "Open passkey wallet";
    const next = await runAction(label, async () => {
      const alias = role === "company" ? DEFAULT_COMPANY_ALIAS : DEFAULT_ALIAS;
      const [nextSession] = await Promise.all([
        createWebAuthnWalletSession({
          nodeUrl: env.aztecNodeUrl,
          alias,
          userName: alias,
          rpId: window.location.hostname || "localhost",
          publicKeyRecoveryBundle,
          localTestAccountIndex: env.localTestAccountIndex,
          deployWithLocalTestAccount: env.enableLocalTestBootstrap,
        }),
        sleep(WALLET_OPEN_MINIMUM_MS),
      ]);
      const profile: WalletProfile = {
        address: nextSession.activeAccount.address,
        walletKind: nextSession.kind,
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
    if (captureRecoveryTarget) {
      if (!isDeployedSession(next.nextSession)) {
        setNotice({
          tone: "danger",
          text: "Recovery target is counterfactual. Deploy the new passkey wallet before rotating credentials to it.",
        });
        return;
      }
      setRecoveryTarget(next.profile);
      route.go("/user/recovery");
      return;
    }
    if (!isDeployedSession(next.nextSession)) {
      setNotice({
        tone: "danger",
        text:
          "Passkey wallet opened but is counterfactual, not deployed. Keep the recovery bundle, then fix funding/node state before issuing credentials.",
      });
      return;
    }
    await syncAfterLogin(next.nextSession, role);
  }

  async function useStoredPasskey(role: Role, captureRecoveryTarget = false) {
    const publicKey = storedPublicKeyInput.trim();
    if (!publicKey) {
      setNotice({ tone: "danger", text: "Paste a public key to use a stored passkey wallet." });
      return;
    }
    await openPasskeyWallet(role, publicKey, captureRecoveryTarget);
  }

  async function copyRecoveryBundle() {
    if (!latestRecoveryBundle) {
      setNotice({ tone: "warning", text: "No passkey public key recovery bundle is available yet." });
      return;
    }
    try {
      await navigator.clipboard.writeText(latestRecoveryBundle);
      setNotice({ tone: "success", text: "Passkey public key recovery bundle copied." });
    } catch {
      setNotice({ tone: "warning", text: "Copy failed. Select the recovery bundle text and copy it manually." });
    }
  }

  function handleZkEvent(event: ZkPassportLifecycleEvent) {
    if (event.type === "proof_generated") {
      setZkProofCount(event.proofCount);
    }
    setZkStage(event.type);
  }

  async function startZkPassportIssuance() {
    const activeSession = requireDeployedWallet("issuance");
    if (!activeSession) return;
    const parsedAge = Number.parseInt(ageThreshold, 10);
    if (!Number.isFinite(parsedAge)) {
      setNotice({ tone: "danger", text: "Age threshold must be a valid number." });
      return;
    }
    if (!env.verificationApiUrl) {
      setNotice({ tone: "danger", text: "VITE_MAGNA_VERIFICATION_API_URL is required for zkPassport issuance." });
      return;
    }

    const request = await runAction("Create zkPassport request", async () =>
      startPassportZkRequest({
        ageThreshold: parsedAge,
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
          setNotice({ tone: "warning", text: "zkPassport request was rejected." });
          setZkStage("rejected");
          return;
        }
        setZkStage("submitting_to_backend");
        const issued = await verifyAndIssueThroughBackend(env.verificationApiUrl!, {
          proofs: completion.proofs,
          originalQuery: completion.originalQuery,
          queryResult: completion.queryResult,
          activeOwner: activeSession.activeAccount.address,
          ageThreshold: parsedAge,
          mode: env.zkPassportPrimaryIssuanceMode,
          ghostDerivationVersion: env.zkPassportGhostDerivationVersion,
        });
        const ref: StoredCredentialRef = {
          id: credentialId({
            ownerAddress: activeSession.activeAccount.address,
            kind: "passport",
            claimsHash: issued.claimsHash,
          }),
          ownerAddress: activeSession.activeAccount.address,
          kind: "passport",
          status: "active",
          claimsHash: issued.claimsHash,
          createdAt: new Date().toISOString(),
          issuanceTxHash: issued.issuanceTxHash,
          mode: issued.mode,
          rootCommitment: issued.rootCommitment,
          ghostOwner: issued.ghostOwner,
          ghostDerivationVersion: issued.ghostDerivationVersion,
          normalizedClaims: issued.normalizedClaims,
        };
        setCredentials(upsertCredentialRef(ref));
        await loadHintsForCredentialRefs(activeSession, [ref]);
        setNotice({ tone: "success", text: "zkPassport credential issued and stored for this wallet." });
        setZkStage("issued");
        navigate("/user");
      })
      .catch(error => {
        setNotice({ tone: "danger", text: errorMessage(error) });
        setZkStage("error");
      })
      .finally(() => setZkRequest(null));
  }

  async function issueInstagramCredential() {
    const activeSession = requireDeployedWallet("collecting Instagram");
    if (!activeSession) return;
    if (!env.verificationApiUrl) {
      setNotice({ tone: "danger", text: "VITE_MAGNA_VERIFICATION_API_URL is required for Instagram issuance." });
      return;
    }
    const handle = canonicalInstagramHandle(instagramHandle);
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
      setNotice({ tone: "danger", text: "Enter a valid Instagram handle without @." });
      return;
    }
    if (!instagramEmailFile) {
      setNotice({ tone: "danger", text: "Choose the Instagram security email .eml file." });
      return;
    }
    await runAction("Issuing Instagram credential", async () => {
      const emlBase64 = await readFileAsBase64(instagramEmailFile);
      const issued = await verifyAndIssueInstagramThroughBackend(env.verificationApiUrl!, {
        emlBase64,
        claimedHandle: handle,
        activeOwner: activeSession.activeAccount.address,
      });
      const ref: StoredCredentialRef = {
        id: credentialId({
          ownerAddress: activeSession.activeAccount.address,
          kind: "instagram",
          claimsHash: issued.claimsHash,
        }),
        ownerAddress: activeSession.activeAccount.address,
        kind: "instagram",
        status: "active",
        claimsHash: issued.claimsHash,
        createdAt: new Date().toISOString(),
        issuanceTxHash: issued.issuanceTxHash,
        ghostOwner: issued.ghostOwner,
        ghostDerivationVersion: issued.ghostDerivationVersion,
        instagramHandle: issued.normalizedClaims.instagramHandle,
        handleHash: issued.normalizedClaims.handleHash,
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
    const age = ref.normalizedClaims?.minAgeProven ?? 18;
    const request = await runAction("Create zkPassport renewal request", async () =>
      startPassportZkRequest({
        ageThreshold: age,
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
        const renewed = await verifyAndRefreshRootAuthorityThroughBackend(env.verificationApiUrl!, {
          proofs: completion.proofs,
          originalQuery: completion.originalQuery,
          queryResult: completion.queryResult,
          ghostOwner: ref.ghostOwner!,
          hintedRootStatusNote: rootedHints.hintedRootStatusNote,
          hintedRootAuthorityNote: rootedHints.hintedRootAuthorityNote,
          ageThreshold: age,
        });
        const renewedRef: StoredCredentialRef = {
          ...ref,
          id: credentialId({ ownerAddress: ref.ownerAddress, kind: "passport", claimsHash: renewed.claimsHash }),
          claimsHash: renewed.claimsHash,
          rootCommitment: renewed.rootCommitment,
          ghostOwner: renewed.ghostOwner,
          normalizedClaims: renewed.normalizedClaims,
          renewalTxHash: renewed.renewalTxHash,
          updatedAt: new Date().toISOString(),
        };
        setCredentials(upsertCredentialRef(renewedRef));
        await loadHintsForCredentialRefs(activeSession, [renewedRef]);
        setNotice({ tone: "success", text: "Rooted passport authority renewed." });
        setZkStage("renewed");
      })
      .catch(error => {
        setNotice({ tone: "danger", text: errorMessage(error) });
        setZkStage("error");
      })
      .finally(() => setZkRequest(null));
  }

  async function startRootRecovery(ref: StoredCredentialRef) {
    if (!requireDeployedWallet("recovery")) return;
    if (!recoveryTarget) {
      setNotice({ tone: "danger", text: "Create or open the new passkey target before recovering root lineage." });
      return;
    }
    if (!isDeployedProfile(recoveryTarget)) {
      setNotice({ tone: "danger", text: "The recovery target is counterfactual. Deploy the target wallet before root recovery." });
      return;
    }
    if (!env.verificationApiUrl) {
      setNotice({ tone: "danger", text: "VITE_MAGNA_VERIFICATION_API_URL is required for rooted recovery." });
      return;
    }
    const hintState = credentialHints[ref.id];
    if (!hintState?.hints || !isRootedPassportHints(hintState.hints)) {
      setNotice({ tone: "danger", text: "Rooted hinted notes must load before recovery." });
      return;
    }
    if (!ref.ghostOwner || !ref.rootCommitment) {
      setNotice({ tone: "danger", text: "Root recovery requires ghost owner and root commitment." });
      return;
    }
    const age = ref.normalizedClaims?.minAgeProven ?? 18;
    const derivationVersion = ref.ghostDerivationVersion ?? env.zkPassportGhostDerivationVersion;
    const request = await runAction("Create zkPassport root recovery request", async () =>
      startPassportZkRequest({
        ageThreshold: age,
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
          setNotice({ tone: "warning", text: "zkPassport recovery request was rejected." });
          setZkStage("rejected");
          return;
        }
        if (!completion.uniqueIdentifier) {
          throw new Error("zkPassport verification succeeded but uniqueIdentifier is missing.");
        }
        setZkStage("submitting_recovery_preflight");
        const preflight = await verifyRootRecoveryPreflightThroughBackend(env.verificationApiUrl!, {
          proofs: completion.proofs,
          originalQuery: completion.originalQuery,
          queryResult: completion.queryResult,
          expectedGhostOwner: ref.ghostOwner!,
          expectedRootCommitment: ref.rootCommitment!,
          ghostDerivationVersion: derivationVersion,
          ageThreshold: age,
        });

        setZkStage("recovering_root");
        const transientGhost = await createTransientGhostWalletSession({
          nodeUrl: env.aztecNodeUrl,
          uniqueIdentifier: completion.uniqueIdentifier,
          credentialType: CredentialType.Passport,
          derivationVersion: preflight.ghostDerivationVersion,
          deployWithLocalTestAccount: env.enableLocalTestBootstrap,
          localTestAccountIndex: env.localTestAccountIndex,
        });
        try {
          if (transientGhost.ghostAddress !== preflight.derivedGhostOwner) {
            throw new Error(
              `Ghost derivation mismatch. preflight=${preflight.derivedGhostOwner} local=${transientGhost.ghostAddress}`,
            );
          }
          const ghostClient = new MagnaBrowserClient(transientGhost.wallet, env, transientGhost.ghostAddress);
          const hintedRootRecovery = await ghostClient.fetchRootRecoveryHint(
            transientGhost.ghostAddress,
            ref.rootCommitment!,
          );
          const recovered = await ghostClient.recoverRoot(hintedRootRecovery, recoveryTarget.address);
          const recoveredRef: StoredCredentialRef = {
            ...ref,
            ownerAddress: recoveryTarget.address,
            status: "recovery_pending",
            updatedAt: new Date().toISOString(),
            renewalTxHash: recovered.txHash ?? ref.renewalTxHash,
          };
          setCredentials(upsertCredentialRef(recoveredRef));
          setNotice({
            tone: "success",
            text: "Root recovery sent to the new passkey wallet. Re-issue credentials on the new wallet before verify.",
          });
          setZkStage("recovered");
          navigate("/user/issue");
        } finally {
          await transientGhost.dispose();
        }
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
          go={route.go}
        />
      );
    }
    if (route.path === "/user/login") {
      return (
        <UserLogin
          busy={busy}
          onCreate={() => openPasskeyWallet("user")}
          onExisting={() => openPasskeyWallet("user")}
          onRecovery={() => route.go("/user/recovery")}
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
          go={route.go}
        >
          <Issuance
            busy={busy}
            walletReady={isDeployedSession(session)}
            zkRequest={zkRequest}
            zkStage={zkStage}
            zkProofCount={zkProofCount}
            ageThreshold={ageThreshold}
            setAgeThreshold={setAgeThreshold}
            instagramHandle={instagramHandle}
            setInstagramHandle={setInstagramHandle}
            instagramEmailFileName={instagramEmailFile?.name ?? ""}
            onInstagramEmailFile={setInstagramEmailFile}
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
          go={route.go}
        >
          <Renewal
            credentials={activeCredentialRefs}
            hints={credentialHints}
            busy={busy}
            walletReady={isDeployedSession(session)}
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
          go={route.go}
        >
          <Recovery
            busy={busy}
            walletReady={isDeployedSession(session)}
            recoveryTarget={recoveryTarget}
            storedPublicKeyInput={storedPublicKeyInput}
            setStoredPublicKeyInput={setStoredPublicKeyInput}
            credentials={activeCredentialRefs}
            hints={credentialHints}
            zkRequest={zkRequest}
            zkStage={zkStage}
            zkProofCount={zkProofCount}
            onCreateTarget={() => openPasskeyWallet("user", undefined, true)}
            onStoredTarget={() => useStoredPasskey("user", true)}
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
          go={route.go}
        >
          <Settings
            profile={walletProfile}
            session={session}
            env={env}
            recoveryBundle={latestRecoveryBundle}
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
          go={route.go}
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
        <button className="brand-mark" type="button" onClick={() => route.go("/")}>
          MAGNA
        </button>
        <div className="topbar-state">
          {session ? (
            <button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => void disconnect()}>
              Disconnect
            </button>
          ) : null}
        </div>
      </header>
      {notice ? <div className={`notice ${notice.tone}`}>{notice.text}</div> : null}
      {page}
    </div>
  );
}

function WalletStatusPanel(props: {
  session: WalletSession | null;
  profile: WalletProfile | null;
  recoveryBundle: string;
  onCopyRecoveryBundle: () => void;
}) {
  const status = deploymentStatusFor(props.session, props.profile);
  const isReady = status === "deployed";
  return (
    <article className={`wallet-status-panel ${isReady ? "ready" : "blocked"}`}>
      <div className="card-head">
        <span>Wallet readiness</span>
        <strong>{status}</strong>
      </div>
      <KeyValue label="Address" value={props.session?.activeAccount.address ?? props.profile?.address ?? "not opened"} />
      <KeyValue label="Session origin" value={sessionOriginFor(props.session, props.profile)} />
      <KeyValue label="Fee payer" value={feePayerFor(props.session, props.profile)} />
      <KeyValue label="Last opened" value={props.profile?.lastOpenedAt ?? "unknown"} />
      {!isReady ? (
        <p className="fine-print danger-text">
          This wallet is not ready for issuance, recovery, sponsor actions, or Login with Magna until deployment is confirmed.
        </p>
      ) : null}
      {props.recoveryBundle ? (
        <div className="recovery-bundle">
          <label>
            Passkey public key recovery bundle
            <textarea readOnly value={props.recoveryBundle} />
          </label>
          <button className="secondary" type="button" onClick={props.onCopyRecoveryBundle}>
            Copy recovery bundle
          </button>
        </div>
      ) : null}
    </article>
  );
}

function StoredPasskeyInput(props: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="stored-passkey-input">
      Stored passkey public key recovery bundle
      <textarea
        value={props.value}
        onChange={event => props.onChange(event.target.value)}
        placeholder='Paste {"kind":"magna-webauthn-public-key",...}'
      />
    </label>
  );
}

function WalletBlockBanner() {
  return (
    <div className="wallet-block-banner" role="alert">
      Wallet is counterfactual or not opened. Deployment must be confirmed before this action can run.
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

function UserLogin(props: {
  busy: string | null;
  onCreate: () => void;
  onExisting: () => void;
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
          Use the passkey on this device, or create a new wallet to get started. Your face or fingerprint unlocks it,
          nothing leaves your device.
        </p>
        <div className="auth-actions">
          <button type="button" disabled={busy} onClick={props.onCreate}>
            {busy ? "Opening wallet\u2026" : "Create new passkey wallet"}
          </button>
          <button className="secondary" type="button" disabled={busy} onClick={props.onExisting}>
            Use existing wallet
          </button>
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
        <span>{props.credentials.length} credential{props.credentials.length === 1 ? "" : "s"} stored</span>
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
      <section className="empty-state">
        <p className="eyebrow">No credentials</p>
        <h2>Issue zkPassport or collect Instagram next.</h2>
        <button type="button" onClick={() => props.go("/user/issue")}>Go to issuance</button>
      </section>
    );
  }
  return (
    <section>
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
  return (
    <article className="credential-card">
      <div className="card-head">
        <span>{ref.kind}</span>
        <strong>{ref.status.replace(/_/g, " ")}</strong>
      </div>
      <KeyValue label="Claims hash" value={ref.claimsHash} />
      {props.hintState ? <KeyValue label="Hinted notes" value={props.hintState.message ?? props.hintState.status} /> : null}
      {ref.mode ? <KeyValue label="Mode" value={ref.mode} /> : null}
      {ref.rootCommitment ? <KeyValue label="Root commitment" value={ref.rootCommitment} /> : null}
      {ref.ghostOwner ? <KeyValue label="Ghost owner" value={ref.ghostOwner} /> : null}
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

function Issuance(props: {
  busy: string | null;
  walletReady: boolean;
  zkRequest: ActiveZkPassportRequest | null;
  zkStage: string;
  zkProofCount: number;
  ageThreshold: string;
  setAgeThreshold: (value: string) => void;
  instagramHandle: string;
  setInstagramHandle: (value: string) => void;
  instagramEmailFileName: string;
  onInstagramEmailFile: (value: File | null) => void;
  onStartZkPassport: () => void;
  onIssueInstagram: () => void;
}) {
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Credential issuance</p>
          <h2>Choose a credential rail</h2>
        </div>
      </div>
      {!props.walletReady ? <WalletBlockBanner /> : null}
      <div className="issue-grid">
        <article className="issue-card">
          <p className="eyebrow">zkPassport</p>
          <h3>Passport-backed private credential</h3>
          <label>
            Age threshold
            <input value={props.ageThreshold} onChange={event => props.setAgeThreshold(event.target.value)} inputMode="numeric" />
          </label>
          <button type="button" disabled={Boolean(props.busy || props.zkRequest || !props.walletReady)} onClick={props.onStartZkPassport}>
            Start zkPassport issuance
          </button>
          <KeyValue label="Stage" value={props.zkStage} />
          <KeyValue label="Proof count" value={String(props.zkProofCount)} />
          {props.zkRequest ? (
            <div className="qr-block">
              <QRCode value={props.zkRequest.url} size={168} />
              <a href={props.zkRequest.url} target="_blank" rel="noreferrer">Open request link</a>
            </div>
          ) : null}
        </article>
        <article className="issue-card">
          <p className="eyebrow">Instagram</p>
          <h3>Signed security email proof</h3>
          <label>
            Instagram handle
            <input
              value={props.instagramHandle}
              onChange={event => props.setInstagramHandle(event.target.value)}
              placeholder="magnasocial"
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
          <p className="fine-print">We privately verify your Instagram security email to confirm the handle is yours. Nothing is posted or shared.</p>
        </article>
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

function Recovery(props: {
  busy: string | null;
  walletReady: boolean;
  recoveryTarget: WalletProfile | null;
  storedPublicKeyInput: string;
  setStoredPublicKeyInput: (value: string) => void;
  credentials: StoredCredentialRef[];
  hints: Record<string, CredentialHintState>;
  zkRequest: ActiveZkPassportRequest | null;
  zkStage: string;
  zkProofCount: number;
  onCreateTarget: () => void;
  onStoredTarget: () => void;
  onRecover: (ref: StoredCredentialRef) => void;
}) {
  const rootedPassport = props.credentials.find(ref => ref.kind === "passport" && ref.mode === "rooted");
  const hintState = rootedPassport ? props.hints[rootedPassport.id] : undefined;
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Recovery</p>
          <h2>Create the new owner before rotating credentials</h2>
        </div>
      </div>
      {!props.walletReady ? <WalletBlockBanner /> : null}
      <div className="issue-grid">
        <article className="issue-card">
          <h3>New passkey target</h3>
          <button type="button" disabled={Boolean(props.busy)} onClick={props.onCreateTarget}>Create new passkey target</button>
          <StoredPasskeyInput value={props.storedPublicKeyInput} onChange={props.setStoredPublicKeyInput} />
          <button className="secondary" type="button" disabled={Boolean(props.busy)} onClick={props.onStoredTarget}>
            Use stored passkey target
          </button>
          {props.recoveryTarget ? (
            <>
              <KeyValue label="Target address" value={props.recoveryTarget.address} />
              <KeyValue label="Target deployment" value={props.recoveryTarget.deploymentStatus ?? "unknown"} />
              <KeyValue label="Target fee payer" value={props.recoveryTarget.feePayer ?? "not configured"} />
            </>
          ) : null}
        </article>
        <article className="issue-card">
          <h3>Root rotation</h3>
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
                !hintState?.hints ||
                !isRootedPassportHints(hintState.hints),
            )}
            onClick={() => rootedPassport && props.onRecover(rootedPassport)}
          >
            Recover root to target
          </button>
        </article>
      </div>
    </section>
  );
}

function Settings(props: {
  profile: WalletProfile | null;
  session: WalletSession | null;
  env: ReturnType<typeof getManagementEnv>;
  recoveryBundle: string;
  onCopyRecoveryBundle: () => void;
}) {
  return (
    <section>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Wallet and derivation context</h2>
        </div>
      </div>
      <div className="settings-grid">
        <WalletStatusPanel
          session={props.session}
          profile={props.profile}
          recoveryBundle={props.recoveryBundle}
          onCopyRecoveryBundle={props.onCopyRecoveryBundle}
        />
        <article className="credential-card">
          <KeyValue label="Address" value={props.profile?.address ?? "not connected"} />
          <KeyValue label="Wallet kind" value={props.profile?.walletKind ?? "unknown"} />
          <KeyValue label="Created at" value={props.profile?.createdAt ?? "unknown"} />
          <KeyValue label="Deployment" value={deploymentStatusFor(props.session, props.profile)} />
          <KeyValue label="Session origin" value={sessionOriginFor(props.session, props.profile)} />
          <KeyValue label="Fee payer" value={feePayerFor(props.session, props.profile)} />
          <KeyValue label="RP ID" value={props.profile?.rpId ?? "unknown"} />
          <KeyValue label="Origin" value={props.profile?.origin ?? window.location.origin} />
          <KeyValue label="Public key" value={props.profile?.publicKey ?? "not available"} />
        </article>
        <article className="credential-card">
          <KeyValue label="Issuer" value={props.env.issuerAddress ?? "not configured"} />
          <KeyValue label="Orchestrator" value={props.env.orchestratorAddress ?? "not configured"} />
          <KeyValue label="zkPassport scope" value={props.env.zkPassportRequestScope} />
          <KeyValue label="Ghost derivation" value={props.env.zkPassportGhostDerivationVersion} />
          <button className="secondary" type="button" disabled>
            Derive from fresh zkPassport proof
          </button>
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
  const walletReady = isDeployedSession(props.session);
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
        <KeyValue label="Operator" value={props.session.activeAccount.address} />
        <KeyValue label="Deployment" value={deploymentStatusFor(props.session, props.profile)} />
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
