import { ClaimId, ConstraintOp, CredentialType } from "@magna/core";
import { describe, expect, it, vi } from "vitest";
import {
  registerWalletSessionLoginBroker,
  tryWalletLoginThroughExistingSession,
  type WalletSessionBrokerInput,
} from "./wallet-session-broker";

const input: WalletSessionBrokerInput = {
  policy: {
    credentialType: CredentialType.Passport,
    constraints: [{ claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n }],
  },
  consumerGatewayAddress: "0xconsumer",
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
      expect(handler).toHaveBeenCalledWith(input);
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
    ).resolves.toEqual({ handled: false });
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
});
