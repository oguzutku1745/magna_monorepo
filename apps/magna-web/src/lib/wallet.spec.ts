import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const makeAddress = (value: string) => ({
    toString: () => value,
    equals: (other: { toString?: () => string } | string) => (typeof other === "string" ? other : other.toString?.()) === value,
  });
  const storedAccounts: Array<{ alias: string; item: { toString: () => string; equals: (other: { toString?: () => string } | string) => boolean } }> = [];
  const storedAccountRecords = new Map<
    string,
    {
      secretKey: object;
      salt: object;
      type: "schnorr" | "ecdsasecp256r1";
      signingKey: Buffer;
    }
  >();
  const deployedAddresses = new Set<string>();
  const initializedOnlyAddresses = new Set<string>();
  const existingNullifierOnDeployAddresses = new Set<string>();
  const deployCalls: Array<{ address: string; from: string }> = [];
  const getSchnorrAccountContractAddress = vi.fn(async () => makeAddress("0xghost-passport-account"));

  const buildAccountManager = (address: string) => ({
    address: makeAddress(address),
    getInstance: () => ({ address }),
    getAccountContract: () => ({
      getContractArtifact: async () => ({ name: "MockAccountArtifact" }),
    }),
    getSecretKey: () => ({ kind: `secret:${address}` }),
    getDeployMethod: async () => ({
      send: async (options: { from: { toString?: () => string } | string }) => {
        deployCalls.push({
          address,
          from: typeof options.from === "string" ? options.from : options.from.toString?.() ?? "",
        });
        if (existingNullifierOnDeployAddresses.has(address)) {
          existingNullifierOnDeployAddresses.delete(address);
          initializedOnlyAddresses.add(address);
          throw new Error("Invalid tx: Existing nullifier");
        }
        deployedAddresses.add(address);
        return { txHash: `0xdeploy-${address}` };
      },
    }),
  });

  const wallet = {
    getAccounts: vi.fn(async () => storedAccounts.map(account => ({ alias: account.alias, item: account.item }))),
    createSchnorrAccount: vi.fn(async (_secret, _salt, _signingKey, alias?: string) => {
      const existing = storedAccounts.find(account => account.alias === (alias ?? ""));
      const address =
        existing?.item.toString() ??
        (alias?.startsWith("magna-ghost-") ? "0xghost-passport-account" : `0xmanaged-${alias ?? "account"}`);
      if (!storedAccounts.some(account => account.item.toString() === address)) {
        storedAccounts.push({
          alias: alias ?? "",
          item: makeAddress(address),
        });
      }
      return buildAccountManager(address);
    }),
    createECDSARAccount: vi.fn(async (_secret, _salt, _signingKey, alias?: string) => {
      const address = "0xpasskey-account";
      if (!storedAccounts.some(account => account.item.toString() === address)) {
        storedAccounts.push({
          alias: alias ?? "",
          item: makeAddress(address),
        });
      }
      return buildAccountManager(address);
    }),
    createECDSAKAccount: vi.fn(async (_secret, _salt, _signingKey, alias?: string) => {
      const address = `0xmanaged-k1-${alias ?? "account"}`;
      return buildAccountManager(address);
    }),
    getContractMetadata: vi.fn(async (address: { toString?: () => string } | string) => {
      const normalized = typeof address === "string" ? address : address.toString?.() ?? "";
      return {
        instance: {},
        initializationStatus:
          deployedAddresses.has(normalized) || initializedOnlyAddresses.has(normalized) ? "INITIALIZED" : "UNKNOWN",
        isContractPublished: deployedAddresses.has(normalized),
      };
    }),
    registerSender: vi.fn(async () => undefined),
    registerContract: vi.fn(async () => undefined),
    walletDB: {
      retrieveAccount: vi.fn(async (address: string) => {
        const account = storedAccountRecords.get(address);
        if (!account) {
          throw new Error(`missing stored account ${address}`);
        }
        return account;
      }),
    },
    pxe: {
      debug: {
        sync: vi.fn(async () => undefined),
      },
    },
    stop: vi.fn(async () => undefined),
  };

  return {
    storedAccounts,
    storedAccountRecords,
    wallet,
    embeddedCreate: vi.fn(async () => wallet),
    createAztecNodeClient: vi.fn(() => ({ kind: "node-client" })),
    waitForNode: vi.fn(async () => undefined),
    getInitialTestAccountsData: vi.fn(async () => [
      {
        address: makeAddress("0xmanaged-local-test-0"),
        secret: { kind: "local-test-secret" },
        salt: { kind: "local-test-salt" },
        signingKey: { kind: "local-test-signing-key" },
      },
    ]),
    computePublicKey: vi.fn(async (_input: Uint8Array | Buffer) => new Uint8Array(33).fill(3)),
    getSchnorrAccountContractAddress,
    deployedAddresses,
    initializedOnlyAddresses,
    existingNullifierOnDeployAddresses,
    deployCalls,
  };
});

vi.mock("@aztec/accounts/testing", () => ({
  getInitialTestAccountsData: testState.getInitialTestAccountsData,
}));

vi.mock("@aztec/accounts/schnorr", () => ({
  getSchnorrAccountContractAddress: testState.getSchnorrAccountContractAddress,
}));

vi.mock("@aztec/aztec.js/node", () => ({
  createAztecNodeClient: testState.createAztecNodeClient,
  waitForNode: testState.waitForNode,
}));

vi.mock("@aztec/wallets/embedded", () => ({
  EmbeddedWallet: {
    create: testState.embeddedCreate,
  },
}));

vi.mock("@aztec/foundation/crypto/ecdsa", () => ({
  Ecdsa: class {
    constructor(_curve: string) {}
    async computePublicKey(input: Uint8Array | Buffer) {
      return await testState.computePublicKey(input);
    }
  },
}));

vi.mock("./aztec", () => ({
  getChainInfo: vi.fn(),
  stringifyAddress: (value: { toString: () => string } | string) => (typeof value === "string" ? value : value.toString()),
}));

import {
  createManagedWalletSession,
  createTransientGhostWalletSession,
  ensureGhostAccountLifecycle,
} from "./wallet";

describe("wallet session persistence", () => {
  beforeEach(() => {
    testState.storedAccounts.length = 0;
    testState.storedAccountRecords.clear();
    testState.deployedAddresses.clear();
    testState.initializedOnlyAddresses.clear();
    testState.existingNullifierOnDeployAddresses.clear();
    testState.deployCalls.length = 0;
    testState.wallet.getAccounts.mockClear();
    testState.wallet.createSchnorrAccount.mockClear();
    testState.wallet.createECDSARAccount.mockClear();
    testState.wallet.createECDSAKAccount.mockClear();
    testState.wallet.getContractMetadata.mockClear();
    testState.wallet.registerSender.mockClear();
    testState.wallet.registerContract.mockClear();
    testState.wallet.walletDB.retrieveAccount.mockClear();
    testState.wallet.pxe.debug.sync.mockClear();
    testState.wallet.stop.mockClear();
    testState.embeddedCreate.mockClear();
    testState.createAztecNodeClient.mockClear();
    testState.waitForNode.mockClear();
    testState.computePublicKey.mockClear();
    testState.getSchnorrAccountContractAddress.mockClear();
  });

  it("reuses a persisted managed account instead of creating a fresh one", async () => {
    testState.storedAccounts.push({
      alias: "magna-user",
      item: {
        toString: () => "0xexisting-managed-account",
        equals: (other: { toString?: () => string } | string) =>
          (typeof other === "string" ? other : other.toString?.()) === "0xexisting-managed-account",
      },
    });
    testState.storedAccountRecords.set("0xexisting-managed-account", {
      secretKey: { kind: "managed-secret" },
      salt: { kind: "managed-salt" },
      type: "schnorr",
      signingKey: Buffer.alloc(32, 1),
    });
    testState.deployedAddresses.add("0xexisting-managed-account");

    const session = await createManagedWalletSession({
      nodeUrl: "http://127.0.0.1:8080",
      alias: "magna-user",
      flavor: "schnorr",
      bootstrapWithLocalTestAccount: false,
      localTestAccountIndex: 0,
    });

    expect(testState.embeddedCreate).toHaveBeenCalledWith(
      { kind: "node-client" },
      expect.objectContaining({ ephemeral: false }),
    );
    expect(testState.wallet.createSchnorrAccount).toHaveBeenCalledTimes(1);
    expect(testState.wallet.registerContract).toHaveBeenCalledTimes(1);
    expect(testState.wallet.pxe.debug.sync).toHaveBeenCalledTimes(2);
    expect(testState.deployCalls).toHaveLength(0);
    expect(session.activeAccount.address).toBe("0xexisting-managed-account");
    expect(session.metadata?.storageMode).toBe("persistent");
    expect(session.metadata?.deploymentStatus).toBe("deployed");
    expect(session.metadata?.sessionOrigin).toBe("reused");
  });

  it("deploys a new managed account with the local test fee payer", async () => {
    const session = await createManagedWalletSession({
      nodeUrl: "http://127.0.0.1:8080",
      alias: "magna-user",
      flavor: "schnorr",
      bootstrapWithLocalTestAccount: false,
      deployWithLocalTestAccount: true,
      localTestAccountIndex: 0,
    });

    expect(testState.wallet.createSchnorrAccount).toHaveBeenCalledTimes(2);
    expect(testState.wallet.registerContract).toHaveBeenCalledTimes(1);
    expect(testState.deployCalls).toEqual([{ address: "0xmanaged-magna-user", from: "0xmanaged-local-test-0" }]);
    expect(testState.wallet.pxe.debug.sync).toHaveBeenCalledTimes(2);
    expect(session.activeAccount.address).toBe("0xmanaged-magna-user");
    expect(session.accounts.map(account => account.address)).toEqual(["0xmanaged-magna-user"]);
    expect(session.metadata?.storageMode).toBe("persistent");
    expect(session.metadata?.deploymentStatus).toBe("deployed");
    expect(session.metadata?.sessionOrigin).toBe("new");
    expect(session.metadata?.feePayer).toBe("0xmanaged-local-test-0");
  });

  it("recovers managed account deploy races by rechecking initialization status", async () => {
    testState.existingNullifierOnDeployAddresses.add("0xmanaged-magna-user");

    const session = await createManagedWalletSession({
      nodeUrl: "http://127.0.0.1:8080",
      alias: "magna-user",
      flavor: "schnorr",
      bootstrapWithLocalTestAccount: false,
      deployWithLocalTestAccount: true,
      localTestAccountIndex: 0,
    });

    expect(testState.deployCalls).toEqual([{ address: "0xmanaged-magna-user", from: "0xmanaged-local-test-0" }]);
    expect(session.metadata?.deploymentStatus).toBe("deployed");
    expect(session.metadata?.sessionOrigin).toBe("new");
  });

  it("creates and deploys scoped ghost accounts without retaining local ghost state", async () => {
    const validFeePayer = `0x${"1".repeat(64)}`;
    const lifecycle = await ensureGhostAccountLifecycle({
      nodeUrl: "http://127.0.0.1:8080",
      uniqueIdentifier: "12345",
      credentialType: 1,
      deploymentFromAddress: validFeePayer,
    });

    expect(testState.getSchnorrAccountContractAddress).toHaveBeenCalledTimes(1);
    expect(testState.wallet.registerSender).toHaveBeenCalled();
    expect(testState.deployCalls).toContainEqual({
      address: "0xghost-passport-account",
      from: validFeePayer,
    });
    expect(lifecycle.address).toBe("0xghost-passport-account");
    expect(lifecycle.deploymentStatus).toBe("deployed");
    expect(lifecycle.localState).toBe("derived-each-time");
    expect(testState.wallet.stop).toHaveBeenCalled();
  });

  it("derives already deployed ghost accounts again instead of depending on persisted local ghost state", async () => {
    testState.deployedAddresses.add("0xghost-passport-account");

    const lifecycle = await ensureGhostAccountLifecycle({
      nodeUrl: "http://127.0.0.1:8080",
      uniqueIdentifier: "12345",
      credentialType: 1,
    });

    expect(lifecycle.deploymentStatus).toBe("deployed");
    expect(testState.deployCalls).toHaveLength(0);
    expect(lifecycle.localState).toBe("derived-each-time");
  });

  it("creates a transient ghost wallet session for root recovery sends", async () => {
    const validFeePayer = `0x${"1".repeat(64)}`;
    const session = await createTransientGhostWalletSession({
      nodeUrl: "http://127.0.0.1:8080",
      uniqueIdentifier: "12345",
      credentialType: 1,
      deploymentFromAddress: validFeePayer,
    });

    expect(session.ghostAddress).toBe("0xghost-passport-account");
    expect(session.localState).toBe("derived-each-time");
    expect(testState.wallet.stop).not.toHaveBeenCalled();

    await session.dispose();
    expect(testState.wallet.stop).toHaveBeenCalledTimes(1);
    await session.dispose();
    expect(testState.wallet.stop).toHaveBeenCalledTimes(1);
  });
});
