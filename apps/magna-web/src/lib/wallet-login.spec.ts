import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimId, ConstraintOp, CredentialType, type Policy } from "@magna/core";

const testState = vi.hoisted(() => {
  const activeAddress = "0x2222222222222222222222222222222222222222";
  const linkedLogin = vi.fn(async () => ({ txHash: "0xlinked" }));
  const legacyLogin = vi.fn(async () => ({ txHash: "0xlegacy" }));
  const linkedLoginV2 = vi.fn(async () => ({ txHash: "0xlinkedv2" }));
  const legacyLoginV2 = vi.fn(async () => ({ txHash: "0xlegacyv2" }));
  const disconnect = vi.fn(async () => undefined);
  const registerKnownIssuerSender = vi.fn(async () => undefined);
  const createWebAuthnWalletSession = vi.fn(async () => ({
    wallet: { id: "wallet" },
    activeAccount: { address: activeAddress },
    disconnect,
  }));
  const packAlpha3 = vi.fn((value: string) => BigInt(`0x${Buffer.from(value, "ascii").toString("hex")}`));

  class MagnaVerificationEngine {
    loginWithLinkedMagnaThroughConsumer = linkedLogin;
    loginWithMagnaThroughConsumer = legacyLogin;
    loginWithLinkedMagnaV2ThroughConsumer = linkedLoginV2;
    loginWithMagnaV2ThroughConsumer = legacyLoginV2;
  }

  return {
    activeAddress,
    linkedLogin,
    legacyLogin,
    linkedLoginV2,
    legacyLoginV2,
    disconnect,
    registerKnownIssuerSender,
    createWebAuthnWalletSession,
    packAlpha3,
    MagnaVerificationEngine,
  };
});

vi.mock("@aztec/aztec.js/addresses", () => ({
  AztecAddress: {
    fromString: (value: string) => value,
  },
}));

vi.mock("@magna/contracts-bindings", () => ({
  MagnaIssuerContract: {
    at: vi.fn(() => ({ id: "issuer" })),
  },
  MagnaConsumerContract: {
    at: vi.fn(() => ({ id: "consumer" })),
  },
}));

vi.mock("@magna/wallet", () => ({
  createWebAuthnWalletSession: testState.createWebAuthnWalletSession,
  registerKnownIssuerSender: testState.registerKnownIssuerSender,
  MagnaVerificationEngine: testState.MagnaVerificationEngine,
  packAlpha3: testState.packAlpha3,
}));

vi.mock("./env", () => ({
  getAppEnv: () => ({
    aztecNodeUrl: "http://127.0.0.1:8080",
    enableLocalTestBootstrap: false,
    issuerAddress: "0xissuer",
    localTestAccountIndex: 0,
    orchestratorAddress: "0xorchestrator",
  }),
}));

vi.mock("./aztec", () => ({
  readTxHash: (receipt: { txHash?: string }) => receipt.txHash ?? null,
}));

import { runWalletLoginForRequest } from "./wallet-login";

const LAST_ISSUED_PASSPORT_STORAGE_KEY = "magna-web:last-issued-passport:v1";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

describe("runWalletLoginForRequest", () => {
  const policy: Policy = {
    credentialType: CredentialType.Passport,
    constraints: [
      {
        claimId: ClaimId.AgeMinProven,
        op: ConstraintOp.Gte,
        value: 18n,
      },
    ],
  };

  let localStorage: ReturnType<typeof makeLocalStorage>;

  beforeEach(() => {
    localStorage = makeLocalStorage();
    vi.stubGlobal("window", {
      location: { hostname: "localhost" },
      localStorage,
    });
    testState.linkedLogin.mockClear();
    testState.legacyLogin.mockClear();
    testState.linkedLoginV2.mockClear();
    testState.legacyLoginV2.mockClear();
    testState.disconnect.mockClear();
    testState.registerKnownIssuerSender.mockClear();
    testState.createWebAuthnWalletSession.mockClear();
    testState.packAlpha3.mockClear();
  });

  it("routes rooted stored passports through linked consumer-gateway login", async () => {
    localStorage.setItem(
      LAST_ISSUED_PASSPORT_STORAGE_KEY,
      JSON.stringify({
        ownerAddress: testState.activeAddress,
        claimsHash: "123",
        mode: "rooted",
        rootCommitment: "99",
        normalizedClaims: {
          nationalityAlpha3: "ZKR",
          minAgeProven: 18,
        },
      }),
    );

    const outcome = await runWalletLoginForRequest({
      policy,
      consumerGatewayAddress: "0xconsumer",
    });

    expect(outcome).toEqual({ verified: true, receipt: "0xlinked" });
    expect(testState.legacyLogin).not.toHaveBeenCalled();
    expect(testState.linkedLogin).toHaveBeenCalledWith({
      policy,
      consumerGatewayAddress: "0xconsumer",
      rootCommitment: "99",
      claimsHash: "123",
      claimsWitness: {
        minAgeProven: 18,
        nationalityAlpha3Packed: 0x5a4b52n,
      },
      from: testState.activeAddress,
    });
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });

  it("routes rooted stored committed passports through v2 linked consumer-gateway login", async () => {
    localStorage.setItem(
      LAST_ISSUED_PASSPORT_STORAGE_KEY,
      JSON.stringify({
        ownerAddress: testState.activeAddress,
        claimsHash: "123",
        mode: "rooted",
        rootCommitment: "99",
        committedClaimsWitness: {
          minAgeProven: 18,
          nationalityAlpha3Packed: "5925714",
          nationalityBlind: "111",
          expiryTs: "1893456000",
          expiryBlind: "222",
        },
      }),
    );

    const outcome = await runWalletLoginForRequest({
      policy,
      consumerGatewayAddress: "0xconsumer",
    });

    expect(outcome).toEqual({ verified: true, receipt: "0xlinkedv2" });
    expect(testState.linkedLogin).not.toHaveBeenCalled();
    expect(testState.legacyLogin).not.toHaveBeenCalled();
    expect(testState.linkedLoginV2).toHaveBeenCalledWith({
      policy,
      consumerGatewayAddress: "0xconsumer",
      rootCommitment: "99",
      claimsHash: "123",
      claimsWitness: {
        minAgeProven: 18,
        nationalityAlpha3Packed: 5925714n,
        nationalityBlind: 111n,
        expiryTs: 1893456000n,
        expiryBlind: 222n,
      },
      from: testState.activeAddress,
    });
    expect(testState.packAlpha3).not.toHaveBeenCalled();
    expect(testState.disconnect).toHaveBeenCalledOnce();
  });
});
