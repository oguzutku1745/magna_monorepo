import {
  ClaimId,
  ConstraintOp,
  CredentialType,
  instagramHandleEqConstraint,
  type LoginRequirement,
  type Policy,
} from "@magna/core";
import {
  computeInstagramHandleHash,
  createWebAuthnWalletSession,
  MagnaBrowserClient,
  runMagnaConsumerLogin,
  type DiscoveredMagnaCredentialRef,
  type MagnaConsumerLoginCredential,
  type MagnaConsumerLoginOutcome,
  type WalletSession,
} from "@magna/wallet";
import { getManagementEnv } from "./env";
import { hydratePassportA2Witness, refsForOwner, upsertCredentialRef, type StoredCredentialRef } from "./storage";

const A2_LOCAL_WITNESS_MISSING_MESSAGE =
  "Passport A2 credential is missing its local committed-claims witness. Re-issue this passport credential on this device.";
const ACCOUNT_AUTH_NOTE_MISSING_MESSAGE =
  "Login with Magna could not authorize the verification transaction: the passkey wallet's own signing-key " +
  "note is not present in this session's private state (PXE), so the account cannot sign. This is an " +
  "account/PXE sync issue, not a missing credential. Reopen the passkey wallet to resync its private state, " +
  "then try again.";

function loadPassportCredential(ownerAddress: string, issuerAddress?: string) {
  const passports = refsForOwner(ownerAddress, { issuerAddress }).filter(
    ref => ref.kind === "passport" && ref.status === "active",
  );
  const credential = passports.find(ref => ref.issuanceKind === "a2" && ref.passportCommittedClaimsV2Witness);
  if (!credential) {
    if (passports.length > 0) {
      throw new Error(A2_LOCAL_WITNESS_MISSING_MESSAGE);
    }
    throw new Error("No active Magna passport credential is available in this wallet session.");
  }
  return toConsumerCredential(credential);
}

function toConsumerCredential(ref: StoredCredentialRef): Partial<MagnaConsumerLoginCredential> {
  if (ref.kind !== "passport") return ref;
  return {
    ...ref,
    committedClaimsWitness: ref.passportCommittedClaimsV2Witness,
  };
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

function instagramHandleHashFromPolicy(policy: Policy): bigint {
  const constraint = policy.constraints.find(
    item => item.claimId === ClaimId.InstagramHandleHash && item.op === ConstraintOp.Eq,
  );
  if (!constraint) {
    throw new Error("Instagram login policy must include an Instagram handle equality constraint.");
  }
  return constraint.value;
}

function loadInstagramCredential(ownerAddress: string, handleHash: bigint, issuerAddress?: string, handle?: string) {
  const handleHashString = handleHash.toString();
  const credential = refsForOwner(ownerAddress, { issuerAddress }).find(
    ref =>
      ref.kind === "instagram" &&
      ref.status === "active" &&
      ref.handleHash === handleHashString &&
      (!handle || ref.instagramHandle === handle),
  );
  if (!credential) {
    throw new Error(
      handle
        ? `No active Magna Instagram credential for @${handle} is available in this wallet session.`
        : "No active Magna Instagram credential is available in this wallet session.",
    );
  }
  if (!credential.handleBlind) {
    throw new Error(
      "Instagram V2 credential is missing its local blinded-handle witness. Re-issue this Instagram credential on this device.",
    );
  }
  return credential;
}

function isMissingHintedNoteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // A missing issuer hint is identified by the client-side fetch wrappers (which wrap the issuer's
  // specific "<x> note not found" assertions / lookup timeouts) and by those specific messages
  // themselves. The generic aztec-nr "Failed to get a note" assertion on its OWN — i.e. NOT wrapped
  // by a hint fetch — comes from a singular note read such as the passkey account reading its
  // signing-key note in `is_valid_impl`, and must NOT be treated as a missing issuer hint
  // (see isAccountAuthNoteError). The previous code matched the bare "Failed to get a note" string,
  // which misclassified an account-auth failure as a missing credential note and produced a
  // misleading "reopen wallet to resync" message pointing at the credential notes.
  return (
    message.includes("Fetch rooted hinted notes failed") ||
    message.includes("Fetch hinted notes failed") ||
    message.includes("Fetch rooted hinted notes timed out") ||
    message.includes("Fetch hinted notes timed out") ||
    message.includes("credential note not found") ||
    message.includes("status note not found") ||
    message.includes("linked credential note not found") ||
    message.includes("linked status note not found") ||
    message.includes("root status note not found") ||
    message.includes("root authority note not found")
  );
}

function isAccountAuthNoteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Failed to get a note") && !isMissingHintedNoteError(error);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return String(error);
}

function verificationFailureLabel(verification: ReturnType<typeof resolveRequirementCredential>): string {
  const credential = verification.credential;
  const details = [
    `requirement ${verification.id}`,
    verification.kind,
    `${credential.kind ?? "credential"} claims hash ${credential.claimsHash}`,
  ];
  if (credential.kind === "passport" && "rootCommitment" in credential && credential.rootCommitment) {
    details.push(`root ${credential.rootCommitment}`);
  }
  if (credential.kind === "instagram" && "instagramHandle" in credential && credential.instagramHandle) {
    details.push(`@${credential.instagramHandle}`);
  }
  return details.join(", ");
}

function annotateMissingHintedNoteError(
  error: unknown,
  verification: ReturnType<typeof resolveRequirementCredential>,
): Error {
  return new Error(
    `PXE could not read private notes for ${verificationFailureLabel(verification)}. Cause: ${errorMessage(error)}`,
  );
}

function annotateAccountAuthNoteError(error: unknown): Error {
  return new Error(`${ACCOUNT_AUTH_NOTE_MISSING_MESSAGE} Cause: ${errorMessage(error)}`);
}

/**
 * Diagnostic only (no behavioral change to the verify path). Runs after a verify send fails with
 * the generic "Failed to get a note" assertion to determine whether the cause is the passkey
 * account's own signing-key note being absent from this session's PXE. Logs the note count plus
 * the PXE-registered senders/accounts so we can confirm the root cause from the console.
 */
async function logAccountAuthNoteDiagnostic(input: {
  wallet: Awaited<ReturnType<typeof createWebAuthnWalletSession>>["wallet"];
  ownerAddress: string;
  env: ReturnType<typeof getManagementEnv>;
  cause: unknown;
}): Promise<void> {
  try {
    const client = new MagnaBrowserClient(input.wallet, input.env, input.ownerAddress);
    const diagnostic = await client.diagnoseAccountAuthNote(input.ownerAddress);
    const interpretation =
      diagnostic.noteCount === 0
        ? "Account signing-key note is MISSING from PXE even after an on-demand account-contract sync -> the note is not discoverable in this session (delivery/decryption/anchor-block issue)."
        : diagnostic.noteCount > 0
          ? "Account signing-key note IS discoverable on demand -> the verify send did not have it populated in time; proactively warming the account's own note before the send should fix login."
          : "Account note enumeration unavailable in this PXE; cannot determine.";
    console.warn("[magna][login-diagnostic] passkey account signing-key note check", {
      ownerAddress: input.ownerAddress,
      signingKeyNoteCount: diagnostic.noteCount,
      diagnosticError: diagnostic.error,
      pxeRegisteredSenders: diagnostic.senders,
      pxeRegisteredAccounts: diagnostic.accounts,
      verifyFailureCause: errorMessage(input.cause),
      interpretation,
    });
  } catch (diagnosticError) {
    console.warn("[magna][login-diagnostic] failed to run account auth-note diagnostic", diagnosticError);
  }
}

function matchesDiscoveredRef(existing: StoredCredentialRef, discovered: DiscoveredMagnaCredentialRef): boolean {
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

function storedRefFromDiscovered(
  discovered: DiscoveredMagnaCredentialRef,
  issuerAddress: string | undefined,
  existing?: StoredCredentialRef,
): StoredCredentialRef {
  const now = new Date().toISOString();
  return hydratePassportA2Witness({
    ...existing,
    id: credentialId({
      ownerAddress: discovered.ownerAddress,
      kind: discovered.kind,
      claimsHash: discovered.claimsHash,
      issuerAddress: issuerAddress ?? existing?.issuerAddress,
      mode: discovered.mode,
      rootCommitment: discovered.rootCommitment,
    }),
    ownerAddress: discovered.ownerAddress,
    kind: discovered.kind,
    status: "active",
    claimsHash: discovered.claimsHash,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    issuerAddress: issuerAddress ?? existing?.issuerAddress,
    mode: discovered.mode,
    rootCommitment: discovered.rootCommitment ?? existing?.rootCommitment,
    issuanceTxHash: discovered.issuanceTxHash ?? existing?.issuanceTxHash,
  });
}

function normalizeAddress(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function sessionOwnerAddress(session: { activeAccount: { address: string }; metadata?: Record<string, string> }, env: ReturnType<typeof getManagementEnv>): string {
  const activeAddress = session.activeAccount.address;
  const normalizedActive = normalizeAddress(activeAddress);
  const isFeePayer =
    normalizedActive !== "" &&
    [session.metadata?.feePayer, env.orchestratorAddress].some(value => normalizeAddress(value) === normalizedActive);
  if (isFeePayer) {
    throw new Error(
      "Magna passkey session resolved to the local fee payer/orchestrator account, not the passkey wallet. Reopen the passkey wallet before Login with Magna.",
    );
  }
  return activeAddress;
}

function verificationRequirements(policy: Policy, requirements?: LoginRequirement[]): LoginRequirement[] {
  return requirements ?? [{ id: "default", kind: "policy", policy }];
}

function resolveRequirementCredential(input: {
  requirement: LoginRequirement;
  ownerAddress: string;
  issuerAddress?: string;
}) {
  if (input.requirement.kind === "instagram-handle") {
    const handleHash = computeInstagramHandleHash(input.requirement.handle);
    return {
      id: input.requirement.id,
      kind: input.requirement.kind,
      policy: {
        credentialType: CredentialType.Instagram,
        constraints: [instagramHandleEqConstraint(handleHash)],
      },
      credential: loadInstagramCredential(input.ownerAddress, handleHash, input.issuerAddress, input.requirement.handle),
    };
  }

  if (input.requirement.policy.credentialType === CredentialType.Passport) {
    return {
      id: input.requirement.id,
      kind: input.requirement.kind,
      policy: input.requirement.policy,
      credential: loadPassportCredential(input.ownerAddress, input.issuerAddress),
    };
  }

  if (input.requirement.policy.credentialType === CredentialType.Instagram) {
    const handleHash = instagramHandleHashFromPolicy(input.requirement.policy);
    return {
      id: input.requirement.id,
      kind: input.requirement.kind,
      policy: input.requirement.policy,
      credential: loadInstagramCredential(input.ownerAddress, handleHash, input.issuerAddress),
    };
  }

  throw new Error("Unsupported Magna credential type for wallet login.");
}

async function reconcileStoredRefsFromPxe(input: {
  session: Awaited<ReturnType<typeof createWebAuthnWalletSession>>;
  ownerAddress: string;
  env: ReturnType<typeof getManagementEnv>;
}): Promise<StoredCredentialRef[]> {
  const client = new MagnaBrowserClient(input.session.wallet, input.env, input.ownerAddress);
  const discovered = await client.discoverCredentialRefs(input.ownerAddress);
  const existingRefs = refsForOwner(input.ownerAddress, { issuerAddress: input.env.issuerAddress });
  const reconciled: StoredCredentialRef[] = [];

  for (const discoveredRef of discovered) {
    const existing =
      existingRefs.find(ref => matchesDiscoveredRef(ref, discoveredRef)) ??
      existingRefs.find(ref => hasSameCredentialClaims(ref, discoveredRef));
    const stored = storedRefFromDiscovered(discoveredRef, input.env.issuerAddress, existing);
    upsertCredentialRef(stored);
    reconciled.push(stored);
  }

  return reconciled;
}

export type WalletLoginRequestInput = {
  policy: Policy;
  requirements?: LoginRequirement[];
  consumerGatewayAddress: string;
  sessionRequestId: string;
  sessionChallenge: string;
  sessionExpiresAt: number;
  storedCredentialId?: string;
  onVerifying?: () => void;
};

async function runWalletLoginWithSession(
  input: WalletLoginRequestInput,
  session: WalletSession,
): Promise<MagnaConsumerLoginOutcome> {
  const env = getManagementEnv();
  try {
    if (session.metadata?.deploymentStatus !== "deployed") {
      throw new Error(
        `Magna wallet is ${session.metadata?.deploymentStatus ?? "not deployed"}. Deploy the passkey wallet before Login with Magna.`,
      );
    }
    const ownerAddress = sessionOwnerAddress(session, env);
    const requirements = verificationRequirements(input.policy, input.requirements);
    let reconciledBeforeVerification = false;
    try {
      await reconcileStoredRefsFromPxe({ session, ownerAddress, env });
      reconciledBeforeVerification = true;
    } catch (reconcileError) {
      console.warn("magna credential preflight discovery failed", reconcileError);
    }
    input.onVerifying?.();
    const receipts = [];
    let authorizationContract: string | undefined;
    for (const [requirementIndex, requirement] of requirements.entries()) {
      let reconciledFromPxe = false;
      let verification = resolveRequirementCredential({
        requirement,
        ownerAddress,
        issuerAddress: env.issuerAddress,
      });
      let outcome: MagnaConsumerLoginOutcome;
      try {
        outcome = await runMagnaConsumerLogin({
          env,
          wallet: session.wallet,
          activeAddress: ownerAddress,
          policy: verification.policy,
          consumerGatewayAddress: input.consumerGatewayAddress,
          sessionAuthorization: {
            requestId: input.sessionRequestId,
            sessionChallenge: input.sessionChallenge,
            expiresAt: input.sessionExpiresAt,
            requirementIndex,
          },
          credential: verification.credential,
        });
      } catch (error) {
        if (isAccountAuthNoteError(error)) {
          await logAccountAuthNoteDiagnostic({ wallet: session.wallet, ownerAddress, env, cause: error });
          throw annotateAccountAuthNoteError(error);
        }
        if (!isMissingHintedNoteError(error) || reconciledFromPxe || reconciledBeforeVerification) {
          throw isMissingHintedNoteError(error) ? annotateMissingHintedNoteError(error, verification) : error;
        }

        const reconciled = await reconcileStoredRefsFromPxe({ session, ownerAddress, env });
        reconciledFromPxe = true;
        if (reconciled.length === 0) {
          throw annotateMissingHintedNoteError(error, verification);
        }

        verification = resolveRequirementCredential({
          requirement,
          ownerAddress,
          issuerAddress: env.issuerAddress,
        });
        try {
          outcome = await runMagnaConsumerLogin({
            env,
            wallet: session.wallet,
            activeAddress: ownerAddress,
            policy: verification.policy,
            consumerGatewayAddress: input.consumerGatewayAddress,
            sessionAuthorization: {
              requestId: input.sessionRequestId,
              sessionChallenge: input.sessionChallenge,
              expiresAt: input.sessionExpiresAt,
              requirementIndex,
            },
            credential: verification.credential,
          });
        } catch (retryError) {
          if (isAccountAuthNoteError(retryError)) {
            await logAccountAuthNoteDiagnostic({ wallet: session.wallet, ownerAddress, env, cause: retryError });
            throw annotateAccountAuthNoteError(retryError);
          }
          throw isMissingHintedNoteError(retryError)
            ? annotateMissingHintedNoteError(retryError, verification)
            : retryError;
        }
      }
      if (!outcome.receipt) {
        throw new Error(`Aztec did not return a transaction hash for requirement ${verification.id}.`);
      }
      if (!outcome.authorizationContract) {
        throw new Error(`Aztec did not return a session authorization contract for requirement ${verification.id}.`);
      }
      if (authorizationContract && authorizationContract !== outcome.authorizationContract) {
        throw new Error("Login requirements were authorized by different sponsor contracts.");
      }
      authorizationContract = outcome.authorizationContract;
      receipts.push({
        id: verification.id,
        kind: verification.kind,
        receipt: outcome.receipt,
      });
    }
    return {
      verified: true,
      receipt: receipts[0]?.receipt ?? null,
      receipts,
      authorizationContract,
    };
  } catch (error) {
    console.warn("magna verification failed", error);
    if (isMissingHintedNoteError(error)) {
      throw new Error(
        "Stored Magna credential metadata exists, but PXE could not read the matching private notes for this wallet, issuer, and chain. " +
          "Reopen the wallet to resync PXE, then try Login with Magna again. " +
          `Last lookup failure: ${errorMessage(error)}`,
      );
    }
    throw error;
  }
}

export async function runWalletLoginForRequest(
  input: WalletLoginRequestInput,
): Promise<MagnaConsumerLoginOutcome> {
  const env = getManagementEnv();
  const session = await createWebAuthnWalletSession({
    nodeUrl: env.aztecNodeUrl,
    alias: "magna-user",
    userName: "magna-user",
    rpId: window.location.hostname || "localhost",
    storedCredentialId: input.storedCredentialId,
    deployWithLocalTestAccount: env.enableLocalTestBootstrap,
    localTestAccountIndex: env.localTestAccountIndex,
  });
  try {
    return await runWalletLoginWithSession(input, session);
  } finally {
    await session.disconnect();
  }
}

export async function runWalletLoginForRequestWithSession(
  input: WalletLoginRequestInput,
  session: WalletSession,
): Promise<MagnaConsumerLoginOutcome> {
  return await runWalletLoginWithSession(input, session);
}
