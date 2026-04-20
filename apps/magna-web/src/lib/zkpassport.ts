import {
  type ProofResult,
  type Query,
  type QueryResult,
  type QueryResultErrors,
  ZKPassport,
} from "@zkpassport/sdk";
import type { GhostDerivationVersion } from "../../../../packages/magna-client/src/types.js";

export type ZkPassportRequestMetadata = {
  name: string;
  logo: string;
  purpose: string;
  scope?: string;
};

export type ZkPassportLifecycleEvent =
  | { type: "request_created"; requestId: string; url: string }
  | { type: "bridge_connected" }
  | { type: "request_received" }
  | { type: "generating_proof" }
  | { type: "proof_generated"; proofCount: number }
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
  | {
      status: "rejected";
    };

export type ActiveZkPassportRequest = {
  requestId: string;
  url: string;
  cancel: () => void;
  completion: Promise<ZkPassportCompletion>;
};

export type VerifyAndIssuePayload = {
  proofs: ProofResult[];
  originalQuery: Query;
  queryResult: QueryResult;
  activeOwner: string;
  ageThreshold: number;
  mode?: "passport" | "rooted";
  ghostDerivationVersion?: GhostDerivationVersion;
};

export type VerifyAndIssueResponse = {
  issuanceTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
  mode: "passport" | "rooted";
  ghostDerivationVersion: GhostDerivationVersion;
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
  ghostDerivationVersion?: GhostDerivationVersion;
  ageThreshold: number;
};

export type VerifyAndRefreshRootAuthorityResponse = {
  renewalTxHash?: string;
  ghostOwner: string;
  rootCommitment: string;
  claimsHash: string;
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
  ghostDerivationVersion: GhostDerivationVersion;
  matchesExpectedGhostOwner: true;
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

let zkPassportSingleton: ZKPassport | null = null;

function getZkPassport(): ZKPassport {
  if (!zkPassportSingleton) {
    zkPassportSingleton = new ZKPassport();
  }
  return zkPassportSingleton;
}

function parseErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

function summarizeQueryResultErrors(errors?: Partial<QueryResultErrors>): string | undefined {
  if (!errors) {
    return undefined;
  }
  const messages: string[] = [];
  for (const [section, operations] of Object.entries(errors)) {
    if (!operations || typeof operations !== "object") {
      continue;
    }
    for (const [operation, detail] of Object.entries(operations)) {
      if (!detail || typeof detail !== "object") {
        continue;
      }
      const message = Reflect.get(detail, "message");
      if (typeof message === "string" && message.trim()) {
        messages.push(`${section}.${operation}: ${message.trim()}`);
      }
    }
  }
  return messages.length > 0 ? messages.join(" | ") : undefined;
}

function sanitizeForJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(entry => sanitizeForJson(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const prototype = Object.getPrototypeOf(value);
  const isPlainObject = prototype === Object.prototype || prototype === null;
  const record = value as Record<string, unknown>;
  const toStringCandidate = (value as { toString?: () => string }).toString;
  if (!isPlainObject && typeof toStringCandidate === "function") {
    const asString = toStringCandidate.call(value);
    if (asString && asString !== "[object Object]") {
      return asString;
    }
  }

  const keys = Object.keys(record);
  return Object.fromEntries(keys.map(key => [key, sanitizeForJson(record[key])]));
}

async function postVerificationApi<TResponse>(verificationApiUrl: string, path: string, payload: unknown): Promise<TResponse> {
  const response = await fetch(`${verificationApiUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(sanitizeForJson(payload)),
  });

  if (!response.ok) {
    let serverMessage = `status ${response.status}`;
    try {
      const errorBody = (await response.json()) as { error?: string };
      if (errorBody.error) {
        serverMessage = errorBody.error;
      }
    } catch {
      // Ignore parse failure and keep generic status.
    }
    throw new Error(`Verification API request failed: ${serverMessage}`);
  }

  return (await response.json()) as TResponse;
}

export async function startPassportZkRequest(options: {
  ageThreshold: number;
  metadata: ZkPassportRequestMetadata;
  devMode?: boolean;
  onEvent?: (event: ZkPassportLifecycleEvent) => void;
}): Promise<ActiveZkPassportRequest> {
  const sdk = getZkPassport();
  const queryBuilder = await sdk.request({
    name: options.metadata.name,
    logo: options.metadata.logo,
    purpose: options.metadata.purpose,
    scope: options.metadata.scope,
    devMode: options.devMode,
  });

  const built = queryBuilder
    .gte("age", options.ageThreshold)
    .disclose("nationality")
    .disclose("expiry_date")
    .done();

  options.onEvent?.({
    type: "request_created",
    requestId: built.requestId,
    url: built.url,
  });

  const proofs: ProofResult[] = [];
  const completion = new Promise<ZkPassportCompletion>((resolve, reject) => {
    built.onBridgeConnect(() => {
      options.onEvent?.({ type: "bridge_connected" });
    });
    built.onRequestReceived(() => {
      options.onEvent?.({ type: "request_received" });
    });
    built.onGeneratingProof(() => {
      options.onEvent?.({ type: "generating_proof" });
    });
    built.onProofGenerated((proof) => {
      proofs.push(proof);
      options.onEvent?.({
        type: "proof_generated",
        proofCount: proofs.length,
      });
    });
    built.onReject(() => {
      resolve({ status: "rejected" });
    });
    built.onError((error) => {
      reject(new Error(typeof error === "string" ? error : parseErrorMessage(error)));
    });
    built.onResult((response) => {
      options.onEvent?.({
        type: "result_received",
        verified: response.verified,
      });
      if (!response.verified) {
        const detail = summarizeQueryResultErrors(response.queryResultErrors);
        reject(new Error(detail ? `zkPassport returned verified=false. ${detail}` : "zkPassport returned verified=false."));
        return;
      }
      resolve({
        status: "verified",
        uniqueIdentifier: response.uniqueIdentifier,
        proofs: [...proofs],
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
      sdk.cancelRequest(built.requestId);
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
