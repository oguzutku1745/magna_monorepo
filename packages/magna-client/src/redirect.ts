import {
  computePolicyHash,
  normalizePolicy,
  policyFromWire,
  policyToWire,
  randomFieldHex,
  randomHex,
  type LoginRequest,
  type Policy,
} from "@magna-protocol/core";
import {
  validateLoginResponse,
  type MagnaClientConfig,
  type MagnaLoginResult,
} from "./connector.js";

const PENDING_KEY = "magna-pending-login-v1";

/**
 * Fallback for popup-blocked/mobile contexts: full-page redirect carrying the
 * request; the wallet redirects back with a one-time code which is exchanged
 * at the wallet-operated exchange endpoint for the chain-bound assertion.
 */
export async function loginWithRedirect(
  config: MagnaClientConfig & { redirectUri: string },
  policy: Policy,
  storage: Storage = sessionStorage,
  navigate: (url: string) => void = url => {
    window.location.href = url;
  },
  origin: string = window.location.origin,
): Promise<void> {
  const normalized = normalizePolicy(policy);
  const policyHash = await computePolicyHash(normalized);
  const request: LoginRequest = {
    v: 1,
    kind: "magna:login-request",
    clientId: config.clientId,
    origin,
    requestId: randomHex(16),
    sessionChallenge: randomFieldHex(),
    policy: policyToWire(normalized),
    policyHash,
    responseMode: "redirectCode",
    redirectUri: config.redirectUri,
  };
  storage.setItem(
    PENDING_KEY,
    JSON.stringify({
      requestId: request.requestId,
      sessionChallenge: request.sessionChallenge,
      policyHash,
      policy: request.policy,
    }),
  );
  const json = JSON.stringify(request);
  const encoded = btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  navigate(`${config.walletOrigin}/authorize?request=${encoded}`);
}

/** Call on redirectUri page load. Reads ?magna_code, exchanges, validates. */
export async function completeRedirectLogin(
  config: MagnaClientConfig & { exchangeUrl: string },
  href: string = window.location.href,
  storage: Storage = sessionStorage,
  fetchImpl: typeof fetch = fetch,
): Promise<MagnaLoginResult | null> {
  const url = new URL(href);
  const code = url.searchParams.get("magna_code");
  if (!code) return null;
  const pendingRaw = storage.getItem(PENDING_KEY);
  if (!pendingRaw) throw new Error("no pending Magna login for this code");
  storage.removeItem(PENDING_KEY);
  const pending = JSON.parse(pendingRaw) as {
    requestId: string;
    sessionChallenge: string;
    policyHash: string;
    policy: LoginRequest["policy"];
  };
  const response = await fetchImpl(config.exchangeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw new Error(`code exchange failed: ${response.status}`);
  const { assertion } = (await response.json()) as { assertion: MagnaLoginResult["assertion"] };
  return validateLoginResponse(
    assertion,
    {
      clientId: config.clientId,
      origin: url.origin,
      requestId: pending.requestId,
      sessionChallenge: pending.sessionChallenge,
      policyHash: pending.policyHash,
      consumerGatewayAddress: config.consumerGatewayAddress,
      requirements: [{ id: "default", kind: "policy", policy: policyFromWire(pending.policy) }],
    },
    config,
  );
}
