import {
  ClaimId,
  ConstraintOp,
  CredentialType,
  MAGNA_SESSION_AUTHORIZATION_DS,
  computeLoginRequirementsHash,
  computePolicyHash,
  loginRequirementsToWire,
  normalizePolicy,
  policyToWire,
  randomHex,
  randomFieldHex,
  sessionAuthorizationFields,
  type LoginRequirement,
  type LoginRequest,
  type LoginResponse,
  type Policy,
  type SessionVerificationReceipt,
  type SessionAssertion,
} from "@magna/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TxHash } from "@aztec/aztec.js/tx";
import { DomainSeparator } from "@aztec/constants";
import { pedersenHash, poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync";

const MAGNA_INSTAGRAM_HANDLE_DS = 0x4d414948n; // "MAIH"

function instagramHandlePolicy(handle: string): Policy {
  const bytes = new TextEncoder().encode(handle);
  if (bytes.length > 31) throw new Error("Instagram handle exceeds the 31-byte field limit");
  let packed = 0n;
  for (const byte of bytes) packed = (packed << 8n) | BigInt(byte);
  const handleHash = pedersenHash([MAGNA_INSTAGRAM_HANDLE_DS, BigInt(bytes.length), packed]).toBigInt();
  return normalizePolicy({
    credentialType: CredentialType.Instagram,
    constraints: [{ claimId: ClaimId.InstagramHandleHash, op: ConstraintOp.Eq, value: handleHash }],
  });
}

export type MagnaLoginResult = {
  verified: boolean;
  assertion: SessionAssertion;
  receipt: string;
  receipts: SessionVerificationReceipt[];
};

export type MagnaLoginRequirement = LoginRequirement;

export type ExpectedRequestContext = {
  clientId: string;
  origin: string;
  requestId: string;
  sessionChallenge: string;
  policyHash: string;
  consumerGatewayAddress: string;
  requirements: { id: string; kind: string; policy: Policy }[];
};

export type SessionChainVerifierInput = {
  aztecNodeUrl: string;
  authorizationContract: string;
  consumerGatewayAddress: string;
  requestId: string;
  sessionChallenge: string;
  expiresAt: number;
  requirementIndex: number;
  policy: Policy;
  txHash: string;
};

export type SessionChainVerifier = (input: SessionChainVerifierInput) => Promise<void>;

export async function verifyAztecSessionAuthorization(
  input: SessionChainVerifierInput,
  node = createAztecNodeClient(input.aztecNodeUrl),
): Promise<void> {
  const inner = poseidon2HashWithSeparator(
    sessionAuthorizationFields(input),
    MAGNA_SESSION_AUTHORIZATION_DS,
  );
  // This is the exact Aztec 5.1 siloNullifier construction. Use the synchronous
  // official Poseidon implementation here so a browser SDK does not initialize
  // the native/async Barretenberg backend merely to validate a receipt.
  const expected = poseidon2HashWithSeparator(
    [AztecAddress.fromStringUnsafe(input.authorizationContract), new Fr(inner.toBigInt())],
    DomainSeparator.SILOED_NULLIFIER,
  );
  const receipt = await node.getTxReceipt(TxHash.fromString(input.txHash), { includeTxEffect: true });
  if (!receipt.isMined()) throw new Error(`Aztec session transaction ${input.txHash} is not mined`);
  if (!receipt.hasExecutionSucceeded()) throw new Error(`Aztec session transaction ${input.txHash} reverted`);
  if (!receipt.txEffect) throw new Error(`Aztec session transaction ${input.txHash} has no transaction effect`);
  if (!receipt.txEffect.nullifiers.some(nullifier => nullifier.equals(expected))) {
    throw new Error(`Aztec session transaction ${input.txHash} is not bound to this login request and policy`);
  }
}

/**
 * Validates the wallet's response against the in-flight request and the
 * corresponding Aztec transaction effects. Throws on any mismatch.
 */
export async function validateLoginResponse(
  assertion: SessionAssertion,
  expected: ExpectedRequestContext,
  config: Pick<MagnaClientConfig, "aztecNodeUrl" | "sessionAuthorizationAddress" | "chainVerifier">,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<MagnaLoginResult> {
  const a = assertion;
  if (a.v !== 2 || a.verified !== true) throw new Error("invalid Magna chain-bound session assertion");
  if (a.requestId !== expected.requestId) throw new Error("requestId mismatch");
  if (a.sessionChallenge !== expected.sessionChallenge) throw new Error("sessionChallenge mismatch");
  if (a.policyHash !== expected.policyHash) throw new Error("policyHash mismatch");
  if (a.clientId !== expected.clientId) throw new Error("clientId mismatch");
  if (a.origin !== expected.origin) throw new Error("origin mismatch");
  if (a.authorizationContract !== config.sessionAuthorizationAddress) {
    throw new Error("session authorization contract mismatch");
  }
  if (a.expiresAt <= nowSeconds || a.issuedAt > nowSeconds + 60) {
    throw new Error("session assertion expired or not yet valid");
  }
  if (a.expiresAt - a.issuedAt !== 300) throw new Error("session assertion lifetime is invalid");
  if (!Array.isArray(a.receipts) || a.receipts.length !== expected.requirements.length) {
    throw new Error("session authorization receipt count mismatch");
  }
  const verifyChain = config.chainVerifier ?? verifyAztecSessionAuthorization;
  for (const [index, requirement] of expected.requirements.entries()) {
    const receipt = a.receipts[index];
    if (!receipt || receipt.id !== requirement.id || receipt.kind !== requirement.kind || typeof receipt.receipt !== "string") {
      throw new Error(`session authorization receipt ${index} mismatch`);
    }
    await verifyChain({
      aztecNodeUrl: config.aztecNodeUrl,
      authorizationContract: a.authorizationContract,
      consumerGatewayAddress: expected.consumerGatewayAddress,
      requestId: expected.requestId,
      sessionChallenge: expected.sessionChallenge,
      expiresAt: a.expiresAt,
      requirementIndex: index,
      policy: requirement.policy,
      txHash: receipt.receipt,
    });
  }
  if (a.receipt !== a.receipts[0]?.receipt) throw new Error("primary session receipt mismatch");
  return { verified: true, assertion: a, receipt: a.receipt, receipts: a.receipts };
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
  aztecNodeUrl: string;
  consumerGatewayAddress: string;
  sessionAuthorizationAddress: string;
  chainVerifier?: SessionChainVerifier;
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
      authorizationRequirements: [{ id: "default", kind: "policy", policy: normalized }],
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
    const authorizationRequirements = requirements.map(requirement => ({
      id: requirement.id,
      kind: requirement.kind,
      policy: requirement.kind === "policy"
        ? normalizePolicy(requirement.policy)
        : instagramHandlePolicy(requirement.handle),
    }));
    return this.openLoginRequest({
      policy: normalizePolicy(policyRequirement.policy),
      policyHash,
      requirements: wireRequirements,
      authorizationRequirements,
    });
  }

  private async openLoginRequest(input: {
    policy: Policy;
    policyHash: string;
    requirements?: LoginRequest["requirements"];
    authorizationRequirements: { id: string; kind: string; policy: Policy }[];
  }): Promise<MagnaLoginResult> {
    const win = this.config.windowImpl ?? browserWindowImpl();
    const requestId = randomHex(16);
    const sessionChallenge = randomFieldHex();

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
              {
                clientId: this.config.clientId,
                origin: win.origin,
                requestId,
                sessionChallenge,
                policyHash: input.policyHash,
                consumerGatewayAddress: this.config.consumerGatewayAddress,
                requirements: input.authorizationRequirements,
              },
              this.config,
            ).then(resolve, reject);
          });
        }
      });
      cleanup.push(unlisten);
    });
  }
}
