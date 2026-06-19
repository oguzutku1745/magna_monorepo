import {
  computeLoginRequirementsHash,
  computePolicyHash,
  loginRequirementsToWire,
  normalizePolicy,
  policyToWire,
  randomHex,
  type LoginRequirement,
  verifySessionAssertion,
  type LoginRequest,
  type LoginResponse,
  type Policy,
  type SessionVerificationReceipt,
  type SignedSessionAssertion,
} from "@magna/core";

export type MagnaLoginResult = {
  verified: boolean;
  assertion: SignedSessionAssertion;
  receipt: string | null;
  receipts?: SessionVerificationReceipt[];
};

export type MagnaLoginRequirement = LoginRequirement;

export type ExpectedRequestContext = {
  clientId: string;
  origin: string;
  requestId: string;
  sessionChallenge: string;
  policyHash: string;
};

/**
 * Validates the wallet's response against the in-flight request. Throws on any
 * mismatch. Order: signature first, then field binding, then expiry.
 */
export async function validateLoginResponse(
  signed: SignedSessionAssertion,
  expected: ExpectedRequestContext,
  magnaPublicKeyJwk: JsonWebKey,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<MagnaLoginResult> {
  const ok = await verifySessionAssertion(signed, magnaPublicKeyJwk);
  if (!ok) throw new Error("Magna session assertion signature is invalid");
  const a = signed.assertion;
  if (a.requestId !== expected.requestId) throw new Error("requestId mismatch");
  if (a.sessionChallenge !== expected.sessionChallenge) throw new Error("sessionChallenge mismatch");
  if (a.policyHash !== expected.policyHash) throw new Error("policyHash mismatch");
  if (a.clientId !== expected.clientId) throw new Error("clientId mismatch");
  if (a.origin !== expected.origin) throw new Error("origin mismatch");
  if (a.expiresAt <= nowSeconds || a.issuedAt > nowSeconds + 60) {
    throw new Error("session assertion expired or not yet valid");
  }
  return { verified: a.verified, assertion: signed, receipt: a.receipt, receipts: a.receipts };
}

type PopupLike = {
  closed: boolean;
  postMessage: (msg: unknown, targetOrigin: string) => void;
  close: () => void;
};

export type WindowImpl = {
  open: (url: string, name: string, features: string) => PopupLike | null;
  addMessageListener: (fn: (event: { origin: string; data: unknown }) => void) => () => void;
  origin: string;
};

function browserWindowImpl(): WindowImpl {
  return {
    open: (url, name, features) => window.open(url, name, features),
    addMessageListener: fn => {
      const handler = (event: MessageEvent) => fn({ origin: event.origin, data: event.data });
      window.addEventListener("message", handler);
      return () => window.removeEventListener("message", handler);
    },
    origin: window.location.origin,
  };
}

export type MagnaClientConfig = {
  clientId: string;
  walletOrigin: string;
  magnaPublicKeyJwk: JsonWebKey;
  timeoutMs?: number;
  windowImpl?: WindowImpl;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class MagnaClient {
  constructor(private readonly config: MagnaClientConfig) {}

  async login(policy: Policy): Promise<MagnaLoginResult> {
    const normalized = normalizePolicy(policy);
    const policyHash = await computePolicyHash(normalized);
    return this.openLoginRequest({
      policy: normalized,
      policyHash,
    });
  }

  async loginWithRequirements(requirements: LoginRequirement[]): Promise<MagnaLoginResult> {
    const policyRequirement = requirements.find(
      (requirement): requirement is Extract<LoginRequirement, { kind: "policy" }> => requirement.kind === "policy",
    );
    if (!policyRequirement) {
      throw new Error("loginWithRequirements requires at least one policy requirement");
    }
    const wireRequirements = loginRequirementsToWire(requirements);
    const policyHash = await computeLoginRequirementsHash(wireRequirements);
    return this.openLoginRequest({
      policy: normalizePolicy(policyRequirement.policy),
      policyHash,
      requirements: wireRequirements,
    });
  }

  private async openLoginRequest(input: {
    policy: Policy;
    policyHash: string;
    requirements?: LoginRequest["requirements"];
  }): Promise<MagnaLoginResult> {
    const win = this.config.windowImpl ?? browserWindowImpl();
    const requestId = randomHex(16);
    const sessionChallenge = randomHex(32);

    const request: LoginRequest = {
      v: 1,
      kind: "magna:login-request",
      clientId: this.config.clientId,
      origin: win.origin,
      requestId,
      sessionChallenge,
      policy: policyToWire(input.policy),
      policyHash: input.policyHash,
      requirements: input.requirements,
      responseMode: "postMessage",
    };

    const popup = win.open(
      `${this.config.walletOrigin}/authorize`,
      "magna-login",
      "popup,width=420,height=640",
    );
    if (!popup) throw new Error("popup blocked; use loginWithRedirect()");

    const timeoutMs = this.config.timeoutMs ?? 120_000;
    return new Promise<MagnaLoginResult>((resolve, reject) => {
      let settled = false;
      let requestPosted = false;
      const cleanup: (() => void)[] = [];
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        for (const cleanupFn of cleanup) cleanupFn();
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error("Magna login timed out"))),
        timeoutMs,
      );
      cleanup.push(() => clearTimeout(timer));
      const closePoll = setInterval(() => {
        if (popup.closed) finish(() => reject(new Error("Magna login window was closed")));
      }, 500);
      cleanup.push(() => clearInterval(closePoll));
      const unlisten = win.addMessageListener(event => {
        if (event.origin !== this.config.walletOrigin) return;
        if (!isObject(event.data)) return;
        const data = event.data;
        if (data.kind === "magna:ready") {
          if (requestPosted) return;
          requestPosted = true;
          popup.postMessage(request, this.config.walletOrigin);
          return;
        }
        if (data.requestId !== requestId) return;
        if (data.kind === "magna:login-error") {
          finish(() => reject(new Error(`Magna login failed: ${String(data.error ?? "unknown error")}`)));
          return;
        }
        if (data.kind === "magna:login-response") {
          const response = data as unknown as LoginResponse;
          finish(() => {
            popup.close();
            validateLoginResponse(
              response.assertion,
              { clientId: this.config.clientId, origin: win.origin, requestId, sessionChallenge, policyHash: input.policyHash },
              this.config.magnaPublicKeyJwk,
            ).then(resolve, reject);
          });
        }
      });
      cleanup.push(unlisten);
    });
  }
}
