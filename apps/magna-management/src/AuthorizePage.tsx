import { useCallback, useEffect, useRef, useState } from "react";
import {
  assertLoginRequest,
  policyFromWire,
  randomHex,
  type LoginRequest,
  type LoginRequirement,
  type SessionAssertion,
} from "@magna/core";
import {
  assertStoredWebAuthnAccount,
  loadStoredWebAuthnAccounts,
  type MagnaConsumerLoginOutcome,
  type StoredWebAuthnAccount,
} from "@magna/wallet";
import { AuthorizeWalletPicker, authorizeWalletsForOrigin } from "./AuthorizeWalletPicker";
import { resolveRegisteredDapp } from "./lib/dapp-registry";
import {
  isPasskeyAccountAuthNoteMissing,
  runWalletLoginForRequest,
  type WalletLoginRequestInput,
} from "./lib/wallet-login";
import { tryWalletLoginThroughExistingSession } from "./lib/wallet-session-broker";

type Phase = "waiting" | "choosing" | "authenticating" | "verifying" | "done" | "error";

type PendingAuthorization = {
  request: LoginRequest;
  replyOrigin: string;
  loginInput: WalletLoginRequestInput;
};

function describeLoginError(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.message) return cause.message;
    return cause.name ? `${cause.name} (no message)` : "Unknown error (no message).";
  }
  if (cause === undefined || cause === null) return "Unknown error.";
  if (typeof cause === "string") return cause || "Unknown error.";
  try {
    const json = JSON.stringify(cause);
    if (json && json !== "{}") return json;
  } catch {
    // fall through to String() below
  }
  return String(cause);
}

async function createRedirectCode(assertion: unknown): Promise<string> {
  const apiUrl = import.meta.env.VITE_MAGNA_VERIFICATION_API_URL ?? "http://localhost:4310";
  const response = await fetch(`${apiUrl}/api/session/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assertion }),
  });
  if (!response.ok) {
    throw new Error(`failed to create Magna session code: ${response.status}`);
  }
  const body = (await response.json()) as { code?: unknown };
  if (typeof body.code !== "string" || !body.code) {
    throw new Error("session code response is missing code");
  }
  return body.code;
}

function redirectUriForRegisteredDapp(redirectUri: string | undefined, origin: string): URL {
  if (!redirectUri) throw new Error("redirectUri is required for redirectCode responseMode");
  const url = new URL(redirectUri);
  if (url.origin !== origin) {
    throw new Error("redirectUri origin is not registered for this dApp");
  }
  return url;
}

function loginRequirementsFromRequest(request: LoginRequest): LoginRequirement[] | undefined {
  return request.requirements?.map(requirement => {
    if (requirement.kind === "policy") {
      return {
        id: requirement.id,
        kind: "policy",
        policy: policyFromWire(requirement.policy),
      };
    }
    return {
      id: requirement.id,
      kind: "instagram-handle",
      handle: requirement.handle,
    };
  });
}

export function AuthorizePage() {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [error, setError] = useState("");
  const [pendingAuthorization, setPendingAuthorization] = useState<PendingAuthorization | null>(null);
  const [storedWallets, setStoredWallets] = useState<StoredWebAuthnAccount[]>([]);
  const requestRef = useRef<{ request: LoginRequest; replyOrigin: string } | null>(null);

  const failAuthorization = useCallback((cause: unknown) => {
    const message = describeLoginError(cause);
    setError(message);
    setPhase("error");
    const pending = requestRef.current;
    const opener = window.opener as Window | null;
    if (pending && opener) {
      opener.postMessage(
        { v: 1, kind: "magna:login-error", requestId: pending.request.requestId, error: message },
        pending.replyOrigin,
      );
    }
  }, []);

  const completeAuthorization = useCallback(
    async (pending: PendingAuthorization, outcome: MagnaConsumerLoginOutcome) => {
      setPhase("verifying");
      if (!outcome.receipt || !outcome.authorizationContract || !outcome.receipts?.length) {
        throw new Error("Aztec login did not produce a chain-bound session authorization.");
      }
      const assertion: SessionAssertion = {
        v: 2,
        clientId: pending.request.clientId,
        origin: pending.replyOrigin,
        requestId: pending.request.requestId,
        sessionChallenge: pending.request.sessionChallenge,
        policyHash: pending.request.policyHash,
        verified: true,
        issuedAt: pending.loginInput.sessionExpiresAt - 300,
        expiresAt: pending.loginInput.sessionExpiresAt,
        authorizationContract: outcome.authorizationContract,
        receipt: outcome.receipt,
        receipts: outcome.receipts,
      };
      if (pending.request.responseMode === "redirectCode") {
        const redirectUrl = redirectUriForRegisteredDapp(pending.request.redirectUri, pending.replyOrigin);
        redirectUrl.searchParams.set("magna_code", await createRedirectCode(assertion));
        setPhase("done");
        window.location.href = redirectUrl.toString();
        return;
      }
      const opener = window.opener as Window | null;
      if (!opener) throw new Error("The requesting dApp window is no longer available.");
      opener.postMessage(
        { v: 2, kind: "magna:login-response", requestId: pending.request.requestId, assertion },
        pending.replyOrigin,
      );
      setPhase("done");
      window.close();
    },
    [],
  );

  const openStoredWallet = useCallback(
    async (account: StoredWebAuthnAccount) => {
      if (!pendingAuthorization || phase !== "choosing") return;
      setError("");
      setPhase("authenticating");
      try {
        // Wallet selection can remain open indefinitely. Start the five-minute
        // chain-bound authorization window only when the user actually chooses
        // a passkey, not when the popup first received the request.
        const refreshedPending: PendingAuthorization = {
          ...pendingAuthorization,
          loginInput: {
            ...pendingAuthorization.loginInput,
            sessionExpiresAt: Math.floor(Date.now() / 1000) + 300,
          },
        };
        try {
          const brokered = await tryWalletLoginThroughExistingSession(refreshedPending.loginInput, {
            targetCredentialId: account.credentialId,
            onBrokerSelected: () => setPhase("authenticating"),
            performWebAuthnAssertion: async (credentialId, challenge) => {
              if (credentialId !== account.credentialId) {
                throw new Error("The open wallet requested a different passkey than the wallet you selected.");
              }
              window.focus();
              return assertStoredWebAuthnAccount(account, challenge);
            },
          });
          if (brokered.handled) {
            await completeAuthorization(refreshedPending, brokered.outcome);
            return;
          }
          if (brokered.conflictingCredentialIds.length > 0) {
            throw new Error(
              `The selected wallet is not the wallet currently open in the management tab. ` +
                `Open “${account.displayName}” in management, then retry Login with Magna.`,
            );
          }
        } catch (brokerError) {
          if (!isPasskeyAccountAuthNoteMissing(brokerError)) {
            throw brokerError;
          }
          // The broker runs before the first Aztec transaction. If its
          // long-lived PXE missed the account constructor note, retry in this
          // popup with a clean in-memory PXE reconstructed from the selected
          // passkey and current chain. No note or credential is copied from
          // browser storage into PXE.
          console.warn(
            "[magna][authorize] Open-wallet PXE missed the account auth note; rebuilding private state from chain in an isolated authorization PXE.",
          );
        }
        const outcome = await runWalletLoginForRequest({
          ...refreshedPending.loginInput,
          storedCredentialId: account.credentialId,
          onVerifying: () => setPhase("verifying"),
        });
        await completeAuthorization(refreshedPending, outcome);
      } catch (cause) {
        failAuthorization(cause);
      }
    },
    [completeAuthorization, failAuthorization, pendingAuthorization, phase],
  );

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setError("This page must be opened by a dApp using @magna/client.");
      setPhase("error");
      return;
    }

    const onMessage = async (event: MessageEvent) => {
      try {
        assertLoginRequest(event.data);
      } catch {
        return;
      }
      const data = event.data;
      if (requestRef.current) return;

      try {
        if (data.origin !== event.origin) throw new Error("request origin mismatch");
        const dapp = resolveRegisteredDapp(data.clientId, event.origin);
        requestRef.current = { request: data, replyOrigin: dapp.origin };

        const issuedAt = Math.floor(Date.now() / 1000);
        const loginInput: WalletLoginRequestInput = {
          policy: policyFromWire(data.policy),
          requirements: loginRequirementsFromRequest(data),
          consumerGatewayAddress: dapp.consumerGatewayAddress,
          sessionRequestId: data.requestId,
          sessionChallenge: data.sessionChallenge,
          sessionExpiresAt: issuedAt + 300,
        };
        const rpId = window.location.hostname || "localhost";
        const eligible = authorizeWalletsForOrigin(
          loadStoredWebAuthnAccounts(window.localStorage),
          rpId,
          window.location.origin,
        );
        const pending = { request: data, replyOrigin: dapp.origin, loginInput };
        if (eligible.length === 0) {
          throw new Error("No Magna passkeys are stored for this wallet site. Open the management app and create or restore a wallet first.");
        }
        setPendingAuthorization(pending);
        setStoredWallets(eligible);
        setPhase("choosing");
      } catch (cause) {
        failAuthorization(cause);
      }
    };

    window.addEventListener("message", onMessage);
    opener.postMessage({ v: 1, kind: "magna:ready", nonce: randomHex(8) }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, [completeAuthorization, failAuthorization]);

  return (
    <main className="authorize-shell" aria-live="polite">
      <section className="authorize-card">
        <p className="authorize-eyebrow">Magna Wallet</p>
        <h1>Login with Magna</h1>
        {phase === "waiting" ? <p>Waiting for the requesting app...</p> : null}
        {phase === "choosing" ? (
          <>
            <p>Choose the named wallet whose private credential should authorize this login.</p>
            <AuthorizeWalletPicker accounts={storedWallets} onSelect={account => void openStoredWallet(account)} />
          </>
        ) : null}
        {phase === "authenticating" ? <p>Confirm with your passkey to unlock your wallet account.</p> : null}
        {phase === "verifying" ? <p>Running private verification through the registered gateway.</p> : null}
        {phase === "done" ? <p>Done. You can close this window.</p> : null}
        {phase === "error" ? <p role="alert">Login failed: {error}</p> : null}
      </section>
    </main>
  );
}
