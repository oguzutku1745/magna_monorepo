import type { MagnaConsumerLoginOutcome } from "@magna/wallet";
import type { WalletLoginRequestInput } from "./wallet-login";

const WALLET_SESSION_CHANNEL = "magna:wallet-session-login:v1";
const DEFAULT_DISCOVERY_TIMEOUT_MS = 1_500;
const DEFAULT_COMPLETION_TIMEOUT_MS = 15 * 60 * 1_000;

export type WalletSessionBrokerInput = Omit<WalletLoginRequestInput, "onVerifying">;

type BrokerMessage =
  | { type: "probe"; requestId: string }
  | { type: "available"; requestId: string; brokerId: string }
  | { type: "execute"; requestId: string; brokerId: string; input: WalletSessionBrokerInput }
  | { type: "started"; requestId: string; brokerId: string }
  | { type: "success"; requestId: string; brokerId: string; outcome: MagnaConsumerLoginOutcome }
  | { type: "failure"; requestId: string; brokerId: string; error: string };

export type WalletSessionBrokerResult =
  | { handled: false }
  | { handled: true; outcome: MagnaConsumerLoginOutcome };

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return String(error);
}

function isBrokerMessage(value: unknown): value is BrokerMessage {
  if (!value || typeof value !== "object") return false;
  const type = Reflect.get(value, "type");
  const requestId = Reflect.get(value, "requestId");
  return (
    typeof type === "string" &&
    ["probe", "available", "execute", "started", "success", "failure"].includes(type) &&
    typeof requestId === "string" &&
    requestId.length > 0
  );
}

export function registerWalletSessionLoginBroker(
  handler: (input: WalletSessionBrokerInput) => Promise<MagnaConsumerLoginOutcome>,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(WALLET_SESSION_CHANNEL);
  const brokerId = randomId();
  let activeRequestId: string | null = null;
  let closed = false;

  channel.onmessage = event => {
    const message = event.data;
    if (!isBrokerMessage(message) || closed) return;
    if (message.type === "probe") {
      channel.postMessage({ type: "available", requestId: message.requestId, brokerId } satisfies BrokerMessage);
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
    void handler(message.input)
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
    channel.close();
  };
}

export async function tryWalletLoginThroughExistingSession(
  input: WalletSessionBrokerInput,
  options: {
    discoveryTimeoutMs?: number;
    completionTimeoutMs?: number;
    onBrokerSelected?: () => void;
  } = {},
): Promise<WalletSessionBrokerResult> {
  if (typeof BroadcastChannel === "undefined") return { handled: false };
  const requestId = randomId();
  const channel = new BroadcastChannel(WALLET_SESSION_CHANNEL);
  const discoveryTimeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const completionTimeoutMs = options.completionTimeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;

  return await new Promise<WalletSessionBrokerResult>((resolve, reject) => {
    let selectedBrokerId: string | null = null;
    let completionTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      clearTimeout(discoveryTimer);
      if (completionTimer) clearTimeout(completionTimer);
      channel.close();
      callback();
    };
    const discoveryTimer = setTimeout(() => finish(() => resolve({ handled: false })), discoveryTimeoutMs);

    channel.onmessage = event => {
      const message = event.data;
      if (!isBrokerMessage(message) || message.requestId !== requestId) return;
      if (message.type === "available" && !selectedBrokerId) {
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
      if (message.type === "success") {
        finish(() => resolve({ handled: true, outcome: message.outcome }));
      } else if (message.type === "failure") {
        finish(() => reject(new Error(message.error)));
      }
    };

    channel.postMessage({ type: "probe", requestId } satisfies BrokerMessage);
  });
}
