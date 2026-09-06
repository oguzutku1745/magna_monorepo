import type { MagnaConsumerLoginOutcome, WebAuthnAssertionResult } from "@magna/wallet";
import type { WalletLoginRequestInput } from "./wallet-login";

const WALLET_SESSION_CHANNEL = "magna:wallet-session-login:v1";
const DEFAULT_DISCOVERY_TIMEOUT_MS = 1_500;
const DEFAULT_COMPLETION_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_ASSERTION_TIMEOUT_MS = 90_000;

export type WalletSessionBrokerInput = Omit<WalletLoginRequestInput, "onVerifying">;

type BrokerMessage =
  | { type: "probe"; requestId: string }
  | { type: "available"; requestId: string; brokerId: string; credentialId?: string }
  | { type: "execute"; requestId: string; brokerId: string; input: WalletSessionBrokerInput }
  | { type: "started"; requestId: string; brokerId: string }
  | { type: "success"; requestId: string; brokerId: string; outcome: MagnaConsumerLoginOutcome }
  | { type: "failure"; requestId: string; brokerId: string; error: string }
  | {
      type: "webauthn-request";
      requestId: string;
      brokerId: string;
      assertionId: string;
      credentialId: string;
      challengeHex: string;
    }
  | {
      type: "webauthn-success";
      requestId: string;
      brokerId: string;
      assertionId: string;
      assertion: WebAuthnAssertionWire;
    }
  | {
      type: "webauthn-failure";
      requestId: string;
      brokerId: string;
      assertionId: string;
      error: string;
    };

type WebAuthnAssertionWire = {
  signatureRSHex: string;
  authenticatorDataHex: string;
  clientDataJSONHex: string;
};

export type WalletSessionBrokerExecution = {
  requestWebAuthnAssertion: (challenge: Uint8Array) => Promise<WebAuthnAssertionResult>;
};

export type WalletSessionBrokerResult =
  | { handled: false; conflictingCredentialIds: string[] }
  | { handled: true; outcome: MagnaConsumerLoginOutcome };

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return String(error);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string, label: string): Uint8Array {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(normalized)) {
    throw new Error(`${label} must be non-empty, even-length hexadecimal bytes.`);
  }
  return Uint8Array.from(normalized.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)));
}

function assertionToWire(assertion: WebAuthnAssertionResult): WebAuthnAssertionWire {
  return {
    signatureRSHex: bytesToHex(assertion.signatureRS),
    authenticatorDataHex: bytesToHex(assertion.authenticatorData),
    clientDataJSONHex: bytesToHex(assertion.clientDataJSON),
  };
}

function assertionFromWire(assertion: WebAuthnAssertionWire): WebAuthnAssertionResult {
  const signatureRS = hexToBytes(assertion.signatureRSHex, "WebAuthn signature");
  if (signatureRS.length !== 64) throw new Error("WebAuthn signature must be exactly 64 bytes.");
  return {
    signatureRS,
    authenticatorData: hexToBytes(assertion.authenticatorDataHex, "WebAuthn authenticator data"),
    clientDataJSON: hexToBytes(assertion.clientDataJSONHex, "WebAuthn client data"),
  };
}

function isBrokerMessage(value: unknown): value is BrokerMessage {
  if (!value || typeof value !== "object") return false;
  const type = Reflect.get(value, "type");
  const requestId = Reflect.get(value, "requestId");
  return (
    typeof type === "string" &&
    [
      "probe",
      "available",
      "execute",
      "started",
      "success",
      "failure",
      "webauthn-request",
      "webauthn-success",
      "webauthn-failure",
    ].includes(type) &&
    typeof requestId === "string" &&
    requestId.length > 0
  );
}

export function registerWalletSessionLoginBroker(
  handler: (
    input: WalletSessionBrokerInput,
    execution: WalletSessionBrokerExecution,
  ) => Promise<MagnaConsumerLoginOutcome>,
  options: { credentialId?: string; assertionTimeoutMs?: number } = {},
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(WALLET_SESSION_CHANNEL);
  const brokerId = randomId();
  let activeRequestId: string | null = null;
  let closed = false;
  const pendingAssertions = new Map<
    string,
    {
      requestId: string;
      resolve: (assertion: WebAuthnAssertionResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const requestWebAuthnAssertion = async (challenge: Uint8Array): Promise<WebAuthnAssertionResult> => {
    if (!activeRequestId) throw new Error("No Login with Magna request is active.");
    const credentialId = options.credentialId;
    if (!credentialId) throw new Error("The open wallet session has no passkey credential identifier.");
    if (challenge.length !== 32) throw new Error("WebAuthn AuthWit challenge must be exactly 32 bytes.");
    const requestId = activeRequestId;
    const assertionId = randomId();
    return await new Promise<WebAuthnAssertionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingAssertions.delete(assertionId);
        reject(new Error("The Login with Magna popup did not complete the passkey assertion in time."));
      }, options.assertionTimeoutMs ?? DEFAULT_ASSERTION_TIMEOUT_MS);
      pendingAssertions.set(assertionId, { requestId, resolve, reject, timer });
      channel.postMessage({
        type: "webauthn-request",
        requestId,
        brokerId,
        assertionId,
        credentialId,
        challengeHex: bytesToHex(challenge),
      } satisfies BrokerMessage);
    });
  };

  channel.onmessage = event => {
    const message = event.data;
    if (!isBrokerMessage(message) || closed) return;
    if (
      (message.type === "webauthn-success" || message.type === "webauthn-failure") &&
      message.brokerId === brokerId
    ) {
      const pending = pendingAssertions.get(message.assertionId);
      if (!pending || pending.requestId !== message.requestId) return;
      clearTimeout(pending.timer);
      pendingAssertions.delete(message.assertionId);
      if (message.type === "webauthn-failure") {
        pending.reject(new Error(message.error));
        return;
      }
      try {
        pending.resolve(assertionFromWire(message.assertion));
      } catch (error) {
        pending.reject(new Error(`Invalid WebAuthn assertion returned by the popup: ${errorMessage(error)}`));
      }
      return;
    }
    if (message.type === "probe") {
      channel.postMessage({
        type: "available",
        requestId: message.requestId,
        brokerId,
        credentialId: options.credentialId,
      } satisfies BrokerMessage);
      return;
    }
    if (message.type !== "execute" || message.brokerId !== brokerId) return;
    if (activeRequestId) {
      channel.postMessage({
        type: "failure",
        requestId: message.requestId,
        brokerId,
        error: "The open Magna wallet is already processing another action.",
      } satisfies BrokerMessage);
      return;
    }

    activeRequestId = message.requestId;
    channel.postMessage({ type: "started", requestId: message.requestId, brokerId } satisfies BrokerMessage);
    void handler(message.input, { requestWebAuthnAssertion })
      .then(outcome => {
        if (!closed) {
          channel.postMessage({
            type: "success",
            requestId: message.requestId,
            brokerId,
            outcome,
          } satisfies BrokerMessage);
        }
      })
      .catch(error => {
        if (!closed) {
          channel.postMessage({
            type: "failure",
            requestId: message.requestId,
            brokerId,
            error: errorMessage(error),
          } satisfies BrokerMessage);
        }
      })
      .finally(() => {
        if (activeRequestId === message.requestId) activeRequestId = null;
      });
  };

  return () => {
    closed = true;
    for (const pending of pendingAssertions.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The open Magna wallet session closed before passkey authorization completed."));
    }
    pendingAssertions.clear();
    channel.close();
  };
}

export async function tryWalletLoginThroughExistingSession(
  input: WalletSessionBrokerInput,
  options: {
    discoveryTimeoutMs?: number;
    completionTimeoutMs?: number;
    targetCredentialId?: string;
    onBrokerSelected?: () => void;
    performWebAuthnAssertion?: (
      credentialId: string,
      challenge: Uint8Array,
    ) => Promise<WebAuthnAssertionResult>;
  } = {},
): Promise<WalletSessionBrokerResult> {
  if (typeof BroadcastChannel === "undefined") return { handled: false, conflictingCredentialIds: [] };
  const requestId = randomId();
  const channel = new BroadcastChannel(WALLET_SESSION_CHANNEL);
  const discoveryTimeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const completionTimeoutMs = options.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;

  return await new Promise<WalletSessionBrokerResult>((resolve, reject) => {
    let selectedBrokerId: string | null = null;
    const conflictingCredentialIds = new Set<string>();
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      clearTimeout(discoveryTimer);
      if (completionTimer) clearTimeout(completionTimer);
      channel.close();
      callback();
    };
    const discoveryTimer = setTimeout(
      () => finish(() => resolve({ handled: false, conflictingCredentialIds: [...conflictingCredentialIds] })),
      discoveryTimeoutMs,
    );

    channel.onmessage = event => {
      const message = event.data;
      if (!isBrokerMessage(message) || message.requestId !== requestId) return;
      if (message.type === "available" && !selectedBrokerId) {
        if (options.targetCredentialId && message.credentialId !== options.targetCredentialId) {
          if (message.credentialId) conflictingCredentialIds.add(message.credentialId);
          return;
        }
        selectedBrokerId = message.brokerId;
        clearTimeout(discoveryTimer);
        options.onBrokerSelected?.();
        completionTimer = setTimeout(
          () => finish(() => reject(new Error("The open Magna wallet did not finish the login request in time."))),
          completionTimeoutMs,
        );
        channel.postMessage({
          type: "execute",
          requestId,
          brokerId: selectedBrokerId,
          input,
        } satisfies BrokerMessage);
        return;
      }
      if (!("brokerId" in message) || !selectedBrokerId || message.brokerId !== selectedBrokerId) return;
      if (message.type === "webauthn-request") {
        const brokerId = selectedBrokerId;
        const respondWithFailure = (error: unknown) => {
          channel.postMessage({
            type: "webauthn-failure",
            requestId,
            brokerId,
            assertionId: message.assertionId,
            error: errorMessage(error),
          } satisfies BrokerMessage);
        };
        if (!options.performWebAuthnAssertion) {
          respondWithFailure(new Error("The Login with Magna popup cannot perform passkey assertions."));
          return;
        }
        let challenge: Uint8Array;
        try {
          challenge = hexToBytes(message.challengeHex, "WebAuthn challenge");
          if (challenge.length !== 32) throw new Error("WebAuthn challenge must be exactly 32 bytes.");
        } catch (error) {
          respondWithFailure(error);
          return;
        }
        void options.performWebAuthnAssertion(message.credentialId, challenge)
          .then(assertion => {
            channel.postMessage({
              type: "webauthn-success",
              requestId,
              brokerId,
              assertionId: message.assertionId,
              assertion: assertionToWire(assertion),
            } satisfies BrokerMessage);
          })
          .catch(respondWithFailure);
        return;
      }
      if (message.type === "success") {
        finish(() => resolve({ handled: true, outcome: message.outcome }));
      } else if (message.type === "failure") {
        finish(() => reject(new Error(message.error)));
      }
    };

    channel.postMessage({ type: "probe", requestId } satisfies BrokerMessage);
  });
}
