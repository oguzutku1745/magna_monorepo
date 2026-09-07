import { ClaimId, ConstraintOp, CredentialType } from "@magna-protocol/core";
import { describe, expect, it, vi } from "vitest";
import {
  registerWalletSessionLoginBroker,
  tryWalletLoginThroughExistingSession,
  type WalletSessionBrokerExecution,
  type WalletSessionBrokerInput,
} from "./wallet-session-broker";

const input: WalletSessionBrokerInput = {
  policy: {
    credentialType: CredentialType.Passport,
    constraints: [{ claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n }],
  },
  consumerGatewayAddress: "0xconsumer",
  sessionRequestId: "11".repeat(16),
  sessionChallenge: `00${"22".repeat(31)}`,
  sessionExpiresAt: 1_800_000_000,
};

describe("wallet session login broker", () => {
  it("routes login through the selected existing wallet owner", async () => {
    const handler = vi.fn(async () => ({ verified: true as const, receipt: "0xlogin" }));
    const unregister = registerWalletSessionLoginBroker(handler);
    try {
      await expect(
        tryWalletLoginThroughExistingSession(input, {
          discoveryTimeoutMs: 250,
          completionTimeoutMs: 1_000,
        }),
      ).resolves.toEqual({ handled: true, outcome: { verified: true, receipt: "0xlogin" } });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        input,
        expect.objectContaining({ requestWebAuthnAssertion: expect.any(Function) }),
      );
    } finally {
      unregister();
    }
  });

  it("falls back only when no existing session broker answers", async () => {
    await expect(
      tryWalletLoginThroughExistingSession(input, {
        discoveryTimeoutMs: 25,
        completionTimeoutMs: 100,
      }),
    ).resolves.toEqual({ handled: false, conflictingCredentialIds: [] });
  });

  it("only routes through the wallet session selected in the popup", async () => {
    const wrongHandler = vi.fn(async () => ({ verified: true as const, receipt: "0xwrong" }));
    const selectedHandler = vi.fn(async () => ({ verified: true as const, receipt: "0xselected" }));
    const unregisterWrong = registerWalletSessionLoginBroker(wrongHandler, { credentialId: "wallet-a" });
    const unregisterSelected = registerWalletSessionLoginBroker(selectedHandler, { credentialId: "wallet-b" });
    try {
      await expect(
        tryWalletLoginThroughExistingSession(input, {
          targetCredentialId: "wallet-b",
          discoveryTimeoutMs: 250,
          completionTimeoutMs: 1_000,
        }),
      ).resolves.toEqual({ handled: true, outcome: { verified: true, receipt: "0xselected" } });
      expect(wrongHandler).not.toHaveBeenCalled();
      expect(selectedHandler).toHaveBeenCalledOnce();
    } finally {
      unregisterWrong();
      unregisterSelected();
    }
  });

  it("reports a different open wallet instead of opening the same OPFS store twice", async () => {
    const unregister = registerWalletSessionLoginBroker(
      async () => ({ verified: true as const, receipt: "0xwrong" }),
      { credentialId: "wallet-a" },
    );
    try {
      await expect(
        tryWalletLoginThroughExistingSession(input, {
          targetCredentialId: "wallet-b",
          discoveryTimeoutMs: 25,
          completionTimeoutMs: 100,
        }),
      ).resolves.toEqual({ handled: false, conflictingCredentialIds: ["wallet-a"] });
    } finally {
      unregister();
    }
  });

  it("returns the selected wallet's failure instead of opening a second PXE", async () => {
    const unregister = registerWalletSessionLoginBroker(async () => {
      throw new Error("existing wallet is busy");
    });
    try {
      await expect(
        tryWalletLoginThroughExistingSession(input, {
          discoveryTimeoutMs: 250,
          completionTimeoutMs: 1_000,
        }),
      ).rejects.toThrow("existing wallet is busy");
    } finally {
      unregister();
    }
  });

  it("executes brokered passkey assertions in the authorization popup", async () => {
    const challenge = new Uint8Array(32).fill(7);
    const assertion = {
      signatureRS: new Uint8Array(64).fill(8),
      authenticatorData: new Uint8Array([9, 10, 11]),
      clientDataJSON: new TextEncoder().encode('{"type":"webauthn.get"}'),
    };
    const performWebAuthnAssertion = vi.fn(async () => assertion);
    const handler = vi.fn(async (_request: WalletSessionBrokerInput, execution: WalletSessionBrokerExecution) => {
      const received = await execution.requestWebAuthnAssertion(challenge);
      expect(received).toEqual(assertion);
      return { verified: true as const, receipt: "0xpopup-login" };
    });
    const unregister = registerWalletSessionLoginBroker(handler, {
      credentialId: "popup-owned-passkey",
      assertionTimeoutMs: 1_000,
    });

    try {
      await expect(
        tryWalletLoginThroughExistingSession(input, {
          discoveryTimeoutMs: 250,
          completionTimeoutMs: 1_000,
          targetCredentialId: "popup-owned-passkey",
          performWebAuthnAssertion,
        }),
      ).resolves.toEqual({ handled: true, outcome: { verified: true, receipt: "0xpopup-login" } });
      expect(performWebAuthnAssertion).toHaveBeenCalledWith("popup-owned-passkey", challenge);
    } finally {
      unregister();
    }
  });
});
