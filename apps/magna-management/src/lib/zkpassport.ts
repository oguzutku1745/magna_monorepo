import {
  type ProofResult,
  type Query,
  type QueryResult,
  type QueryResultErrors,
  ZKPassport,
} from "@zkpassport/sdk";
import type { GhostDerivationVersion } from "@magna/wallet";

type ZkPassportProofMode = "fast" | "compressed" | "compressed-evm";

export type ZkPassportLifecycleEvent =
  | { type: "request_created"; requestId: string; url: string }
  | { type: "bridge_connected" }
  | { type: "request_received" }
  | { type: "generating_proof" }
  | { type: "proof_generated"; proofCount: number; proofTotal?: number }
  | { type: "query_result_received" }
  | { type: "result_received"; verified: boolean };

export type ZkPassportCompletion =
  | {
      status: "verified";
      uniqueIdentifier?: string;
      proofs: ProofResult[];
      queryResult: QueryResult;
      originalQuery: Query;
      queryResultErrors?: Partial<QueryResultErrors>;
    }
  | { status: "rejected" };

export type ActiveZkPassportRequest = {
  requestId: string;
  url: string;
  cancel: () => void;
  completion: Promise<ZkPassportCompletion>;
};

export type VerifyAndIssueResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  mode: "passport" | "rooted";
  ghostDerivationVersion: GhostDerivationVersion;
  issuerAddress: string;
  orchestratorAddress: string;
  normalizedClaims: {
    nationalityAlpha3: string;
    minAgeProven: number;
    passportExpiryDate: string;
    expiryTs: string;
  };
};

export type VerifyAndIssuePassportPilotPayload = {
  pilotSchema: "passport-pii-blind-v0";
  activeOwner: string;
  claimsHash: string;
  ghostOwner: string;
  rootCommitment: string;
  credentialValidUntil: string;
  mode?: "passport" | "rooted";
  ghostDerivationVersion?: GhostDerivationVersion;
};

export type VerifyAndIssuePassportPilotResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  mode: "passport" | "rooted";
  ghostDerivationVersion: GhostDerivationVersion;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    pilot: true;
    piiBlind: true;
  };
};

export type VerifyAndRefreshRootAuthorityPayload = {
  proofs: ProofResult[];
  originalQuery: Query;
  queryResult: QueryResult;
  ghostOwner: string;
  hintedRootStatusNote: unknown;
  hintedRootAuthorityNote: unknown;
  ageThreshold: number;
};

export type VerifyRootRecoveryPreflightPayload = {
  proofs: ProofResult[];
  originalQuery: Query;
  queryResult: QueryResult;
  expectedGhostOwner: string;
  expectedRootCommitment: string;
  ghostDerivationVersion?: GhostDerivationVersion;
  ageThreshold: number;
};

export type VerifyAndRefreshRootAuthorityResponse = {
  renewalTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    uniqueIdentifierPresent: true;
  };
  normalizedClaims: {
    nationalityAlpha3: string;
    minAgeProven: number;
    passportExpiryDate: string;
    expiryTs: string;
  };
};

export type VerifyRootRecoveryPreflightResponse = {
  expectedGhostOwner: string;
  derivedGhostOwner: string;
  expectedRootCommitment: string;
  derivedRootCommitment: string;
  ghostDerivationVersion: GhostDerivationVersion;
  matchesExpectedGhostOwner: true;
  matchesExpectedRootCommitment: true;
  verificationSummary: {
    verified: true;
    uniqueIdentifierPresent: true;
  };
  normalizedClaims: {
    nationalityAlpha3: string;
    minAgeProven: number;
    passportExpiryDate: string;
    expiryTs: string;
  };
};

export type VerifyAndIssueInstagramPayload = {
  emlBase64: string;
  claimedHandle: string;
  activeOwner: string;
};

export type VerifyAndIssueInstagramResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  claimsHash: string;
  ghostDerivationVersion: GhostDerivationVersion;
  issuerAddress: string;
  orchestratorAddress: string;
  verificationSummary: {
    verified: true;
    dkimPubkeyHash: string;
    emailNullifier: string;
  };
  normalizedClaims: {
    instagramHandle: string;
    handleHash: string;
    handleLen: number;
    handlePacked: string;
    expiryTs: string;
  };
};

type VerifyAndIssuePayload = {
  proofs: ProofResult[];
  originalQuery: Query;
  queryResult: QueryResult;
  activeOwner: string;
  ageThreshold: number;
  mode?: "passport" | "rooted";
  ghostDerivationVersion?: GhostDerivationVersion;
};

type ZkPassportInternalMessage = {
  method?: string;
  params?: unknown;
};

type ZkPassportMessageHookTarget = {
  handleEncryptedMessage?: (topic: string, message: ZkPassportInternalMessage) => Promise<void>;
};

let singleton: ZKPassport | null = null;

function zkPassport(): ZKPassport {
  singleton ??= new ZKPassport();
  return singleton;
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function summarizeQueryResultErrors(errors?: Partial<QueryResultErrors>): string | undefined {
  if (!errors) return undefined;
  const messages: string[] = [];
  for (const [section, operations] of Object.entries(errors)) {
    if (!operations || typeof operations !== "object") continue;
    for (const [operation, detail] of Object.entries(operations)) {
      if (!detail || typeof detail !== "object") continue;
      const message = Reflect.get(detail, "message");
      if (typeof message === "string" && message.trim()) {
        messages.push(`${section}.${operation}: ${message.trim()}`);
      }
    }
  }
  return messages.length > 0 ? messages.join(" | ") : undefined;
}

function sanitizeForJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(entry => sanitizeForJson(entry));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).map(key => [key, sanitizeForJson(record[key])]));
}

async function postVerificationApi<TResponse>(
  verificationApiUrl: string,
  path: string,
  payload: unknown,
): Promise<TResponse> {
  const response = await fetch(`${verificationApiUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sanitizeForJson(payload)),
  });

  if (!response.ok) {
    let serverMessage = `status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) serverMessage = body.error;
    } catch {
      // Preserve the HTTP status message.
    }
    throw new Error(`Verification API request failed: ${serverMessage}`);
  }
  return (await response.json()) as TResponse;
}

export async function startPassportZkRequest(options: {
  ageThreshold: number;
  metadata: { name: string; logo: string; purpose: string; scope?: string };
  proofMode?: ZkPassportProofMode;
  devMode?: boolean;
  onEvent?: (event: ZkPassportLifecycleEvent) => void;
}): Promise<ActiveZkPassportRequest> {
  const queryBuilder = await zkPassport().request({
    name: options.metadata.name,
    logo: options.metadata.logo,
    purpose: options.metadata.purpose,
    scope: options.metadata.scope,
    mode: options.proofMode,
    devMode: options.devMode,
  });

  const built = queryBuilder
    .gte("age", options.ageThreshold)
    .disclose("nationality")
    .disclose("expiry_date")
    .done();

  options.onEvent?.({ type: "request_created", requestId: built.requestId, url: built.url });

  const proofs: ProofResult[] = [];
  let settled = false;
  const sdk = zkPassport() as unknown as ZkPassportMessageHookTarget;
  const originalHandleEncryptedMessage = sdk.handleEncryptedMessage?.bind(sdk);
  let hookedHandleEncryptedMessage: ZkPassportMessageHookTarget["handleEncryptedMessage"];

  const cleanupMessageHook = () => {
    if (hookedHandleEncryptedMessage && sdk.handleEncryptedMessage === hookedHandleEncryptedMessage) {
      sdk.handleEncryptedMessage = originalHandleEncryptedMessage;
    }
  };

  const completion = new Promise<ZkPassportCompletion>((resolve, reject) => {
    if (originalHandleEncryptedMessage) {
      hookedHandleEncryptedMessage = async (topic, message) => {
        if (topic === built.requestId && message.method === "done") {
          options.onEvent?.({ type: "query_result_received" });
        }
        try {
          await originalHandleEncryptedMessage(topic, message);
        } catch (error) {
          if (settled) {
            console.warn("zkPassport SDK local verification failed after backend handoff.", error);
            return;
          }
          settled = true;
          cleanupMessageHook();
          reject(new Error(errorMessage(error)));
        }
      };
      sdk.handleEncryptedMessage = hookedHandleEncryptedMessage;
    }

    built.onBridgeConnect(() => options.onEvent?.({ type: "bridge_connected" }));
    built.onRequestReceived(() => options.onEvent?.({ type: "request_received" }));
    built.onGeneratingProof(() => options.onEvent?.({ type: "generating_proof" }));
    built.onProofGenerated(proof => {
      proofs.push(proof);
      options.onEvent?.({ type: "proof_generated", proofCount: proofs.length, proofTotal: proof.total });
    });
    built.onReject(() => {
      if (settled) return;
      settled = true;
      cleanupMessageHook();
      resolve({ status: "rejected" });
    });
    built.onError(error => {
      if (settled) return;
      settled = true;
      cleanupMessageHook();
      reject(new Error(errorMessage(error)));
    });
    built.onResult(response => {
      if (settled) return;
      options.onEvent?.({ type: "result_received", verified: response.verified });
      if (!response.verified) {
        const detail = summarizeQueryResultErrors(response.queryResultErrors);
        settled = true;
        cleanupMessageHook();
        reject(new Error(detail ? `zkPassport returned verified=false. ${detail}` : "zkPassport returned verified=false."));
        return;
      }
      settled = true;
      cleanupMessageHook();
      resolve({
        status: "verified",
        uniqueIdentifier: response.uniqueIdentifier,
        proofs: proofs.length > 0 ? [...proofs] : response.proofs,
        queryResult: response.result,
        originalQuery: built.query,
        queryResultErrors: response.queryResultErrors,
      });
    });
  });

  return {
    requestId: built.requestId,
    url: built.url,
    cancel: () => {
      cleanupMessageHook();
      zkPassport().cancelRequest(built.requestId);
    },
    completion,
  };
}

export async function verifyAndIssueThroughBackend(
  verificationApiUrl: string,
  payload: VerifyAndIssuePayload,
): Promise<VerifyAndIssueResponse> {
  return await postVerificationApi<VerifyAndIssueResponse>(
    verificationApiUrl,
    "/zkpassport/verify-and-issue",
    payload,
  );
}

export async function verifyAndIssuePassportPilotThroughBackend(
  verificationApiUrl: string,
  payload: VerifyAndIssuePassportPilotPayload,
): Promise<VerifyAndIssuePassportPilotResponse> {
  return await postVerificationApi<VerifyAndIssuePassportPilotResponse>(
    verificationApiUrl,
    "/zkpassport/verify-and-issue",
    payload,
  );
}

export async function verifyAndRefreshRootAuthorityThroughBackend(
  verificationApiUrl: string,
  payload: VerifyAndRefreshRootAuthorityPayload,
): Promise<VerifyAndRefreshRootAuthorityResponse> {
  return await postVerificationApi<VerifyAndRefreshRootAuthorityResponse>(
    verificationApiUrl,
    "/zkpassport/verify-and-refresh-root-authority",
    payload,
  );
}

export async function verifyRootRecoveryPreflightThroughBackend(
  verificationApiUrl: string,
  payload: VerifyRootRecoveryPreflightPayload,
): Promise<VerifyRootRecoveryPreflightResponse> {
  return await postVerificationApi<VerifyRootRecoveryPreflightResponse>(
    verificationApiUrl,
    "/zkpassport/verify-for-root-recovery",
    payload,
  );
}

export async function verifyAndIssueInstagramThroughBackend(
  verificationApiUrl: string,
  payload: VerifyAndIssueInstagramPayload,
): Promise<VerifyAndIssueInstagramResponse> {
  return await postVerificationApi<VerifyAndIssueInstagramResponse>(
    verificationApiUrl,
    "/instagram/verify",
    payload,
  );
}
