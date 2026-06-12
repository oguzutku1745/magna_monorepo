import { useEffect, useRef, useState } from "react";
import {
  policyFromWire,
  randomHex,
  type LoginRequest,
  type SessionAssertion,
} from "@magna/core";
import { resolveRegisteredDapp } from "./lib/dapp-registry";
import { signAssertion } from "./lib/session-signer";
import { runWalletLoginForRequest } from "./lib/wallet-login";

type Phase = "waiting" | "authenticating" | "verifying" | "done" | "error";


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

export function AuthorizePage() {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [error, setError] = useState<string>("");
  const requestRef = useRef<{ request: LoginRequest; replyOrigin: string } | null>(null);

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) {
      setError("This page must be opened by a dApp using @magna/client.");
      setPhase("error");
      return;
    }
    const onMessage = async (event: MessageEvent) => {
      const data = event.data as LoginRequest;
      if (data?.kind !== "magna:login-request" || requestRef.current) return;
      try {
        if (data.origin !== event.origin) throw new Error("request origin mismatch");
        const dapp = resolveRegisteredDapp(data.clientId, event.origin);
        requestRef.current = { request: data, replyOrigin: dapp.origin };

        setPhase("authenticating");
        const outcome = await runWalletLoginForRequest({
          policy: policyFromWire(data.policy),
          consumerGatewayAddress: dapp.consumerGatewayAddress,
          onVerifying: () => setPhase("verifying"),
        });

        const now = Math.floor(Date.now() / 1000);
        const assertion: SessionAssertion = {
          v: 1,
          clientId: data.clientId,
          origin: dapp.origin,
          requestId: data.requestId,
          sessionChallenge: data.sessionChallenge,
          policyHash: data.policyHash,
          verified: outcome.verified,
          issuedAt: now,
          expiresAt: now + 300,
          receipt: outcome.receipt ?? null,
        };
        const signed = await signAssertion(assertion);
        if (data.responseMode === "redirectCode") {
          const redirectUrl = redirectUriForRegisteredDapp(data.redirectUri, dapp.origin);
          redirectUrl.searchParams.set("magna_code", await createRedirectCode(signed));
          setPhase("done");
          window.location.href = redirectUrl.toString();
          return;
        }
        opener.postMessage(
          { v: 1, kind: "magna:login-response", requestId: data.requestId, assertion: signed },
          dapp.origin,
        );
        setPhase("done");
        window.close();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setPhase("error");
        if (requestRef.current) {
          opener.postMessage(
            {
              v: 1,
              kind: "magna:login-error",
              requestId: requestRef.current.request.requestId,
              error: message,
            },
            requestRef.current.replyOrigin,
          );
        }
      }
    };
    window.addEventListener("message", onMessage);
    opener.postMessage({ v: 1, kind: "magna:ready", nonce: randomHex(8) }, "*");
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <main className="authorize-shell" aria-live="polite">
      <section className="authorize-card">
        <p className="authorize-eyebrow">Magna Wallet</p>
        <h1>Login with Magna</h1>
        {phase === "waiting" && <p>Waiting for the requesting app...</p>}
        {phase === "authenticating" && <p>Confirm with your passkey to unlock your wallet account.</p>}
        {phase === "verifying" && <p>Running private verification through the registered gateway.</p>}
        {phase === "done" && <p>Done. You can close this window.</p>}
        {phase === "error" && <p role="alert">Login failed: {error}</p>}
      </section>
    </main>
  );
}
