import { getInitialTestAccountsData, INITIAL_TEST_SIGNING_KEYS } from "@aztec/accounts/testing";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { createAztecNodeDebugClient } from "@aztec/stdlib/interfaces/client";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { MagnaIssuerContract } from "@magna/contracts-bindings";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runE2E = process.env.AZTEC_E2E === "1";
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const L1_RPC_URLS = (process.env.ETHEREUM_HOSTS ?? "http://localhost:8545")
  .split(",")
  .map(url => url.trim())
  .filter(Boolean);
const L1_MNEMONIC =
  process.env.MNEMONIC ?? "test test test test test test test test test test test junk";
const LOCAL_ANVIL_CHAIN_ID = 31_337n;
const LOCAL_CLOCK_DRIFT_DANGER_SECONDS = 180n;
const WAIT_FOR_NODE_MS = Number.parseInt(process.env.AZTEC_WAIT_FOR_NODE_MS ?? "240000", 10);

function errorDetails(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function waitForNode(node: ReturnType<typeof createAztecNodeClient>): Promise<void> {
  const deadline = Date.now() + WAIT_FOR_NODE_MS;
  while (Date.now() < deadline) {
    try {
      await node.getNodeInfo();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Timed out waiting for Aztec node at ${AZTEC_NODE_URL}`);
}

async function synchronizeLocalChainClock(
  node: ReturnType<typeof createAztecNodeClient>,
  wallet: EmbeddedWallet,
): Promise<void> {
  const nodeInfo = await node.getNodeInfo();
  if (BigInt(nodeInfo.l1ChainId) !== LOCAL_ANVIL_CHAIN_ID) {
    throw new Error(`Expected local Anvil chain ${LOCAL_ANVIL_CHAIN_ID.toString()}`);
  }

  const l1Client = createExtendedL1Client(L1_RPC_URLS, L1_MNEMONIC);
  if (BigInt(await l1Client.getChainId()) !== LOCAL_ANVIL_CHAIN_ID) {
    throw new Error(`Configured L1 RPC is not local Anvil chain ${LOCAL_ANVIL_CHAIN_ID.toString()}`);
  }

  const latestTimestamp = BigInt((await l1Client.getBlock()).timestamp);
  const wallTimestamp = BigInt(Math.floor(Date.now() / 1_000));
  const drift = latestTimestamp - wallTimestamp;
  if (drift >= LOCAL_CLOCK_DRIFT_DANGER_SECONDS) {
    throw new Error(
      `Local L1 is ${drift.toString()}s ahead of the host; restart the local stack before running this test.`,
    );
  }
  if (latestTimestamp >= wallTimestamp) return;

  const beforeBlock = await node.getBlockNumber();
  await createAztecNodeDebugClient(AZTEC_NODE_URL).warpL2TimeAtLeastTo(Number(wallTimestamp));
  const deadline = Date.now() + 120_000;
  while ((await node.getBlockNumber()) <= beforeBlock) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the synchronized Aztec checkpoint");
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }

  const walletDebug = (
    wallet as EmbeddedWallet & { pxe?: { debug?: { sync?: () => Promise<void> } } }
  ).pxe?.debug;
  const debugSync = walletDebug?.sync;
  if (debugSync) await debugSync.call(walletDebug);
}

function assertNode24Runtime(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 24) {
    throw new Error(`Node.js >=24 is required; current runtime is ${process.versions.node}`);
  }
}

const suite = runE2E ? describe.sequential : describe.skip;

suite("rooted Passport A2 issuance uniqueness", () => {
  let wallet: EmbeddedWallet | undefined;
  let issuer: MagnaIssuerContract;
  let orchestrator: AztecAddress;
  let activeOwner: AztecAddress;
  let ghostOwner: AztecAddress;

  beforeAll(async () => {
    assertNode24Runtime();
    const node = createAztecNodeClient(AZTEC_NODE_URL);
    await waitForNode(node);
    wallet = await EmbeddedWallet.create(node, {
      ephemeral: true,
      pxeConfig: { proverEnabled: false },
    });
    await synchronizeLocalChainClock(node, wallet);

    const initialAccounts = await getInitialTestAccountsData();
    expect(initialAccounts.length).toBeGreaterThanOrEqual(3);
    const managers = [];
    for (let index = 0; index < 3; index += 1) {
      const account = initialAccounts[index]!;
      managers.push(
        await wallet.createSchnorrInitializerlessAccount(
          account.secret,
          account.salt,
          INITIAL_TEST_SIGNING_KEYS[index] ?? account.signingKey,
          `issuance-uniqueness-${index}`,
        ),
      );
    }
    [orchestrator, activeOwner, ghostOwner] = managers.map(manager => manager.address) as [
      AztecAddress,
      AztecAddress,
      AztecAddress,
    ];

    const deployed = await (MagnaIssuerContract.deploy as unknown as (
      wallet: EmbeddedWallet,
      orchestratorAddress: AztecAddress,
      verifyMeterHookAddress: AztecAddress,
    ) => {
      send: (opts: { from: AztecAddress }) => Promise<{
        contract: MagnaIssuerContract;
        receipt: { hasExecutionSucceeded: () => boolean };
      }>;
    })(wallet, orchestrator, AztecAddress.ZERO).send({ from: orchestrator });
    expect(deployed.receipt.hasExecutionSucceeded()).toBe(true);
    issuer = deployed.contract;
  }, 300_000);

  afterAll(async () => {
    await wallet?.stop().catch(() => undefined);
  });

  it("rejects a second initial lineage for the same proof-authenticated root", async () => {
    const rootCommitment = 0x4d41474e415f554e495155454e455353n;
    const first = await issuer.methods
      .register_rooted_passport_v2(activeOwner, ghostOwner, rootCommitment, 0x1111n, 1_993_456_000n)
      .send({ from: orchestrator });
    expect(first.receipt.hasExecutionSucceeded()).toBe(true);

    let duplicateIssuanceError: unknown;
    try {
      await issuer.methods
        .register_rooted_passport_v2(ghostOwner, activeOwner, rootCommitment, 0x2222n, 1_993_456_001n)
        .send({ from: orchestrator });
    } catch (error) {
      duplicateIssuanceError = error;
    }

    const details = errorDetails(duplicateIssuanceError);
    console.info(`[e2e] duplicate rooted Passport A2 issuance rejected: ${details}`);
    expect(details).toMatch(/nullifier/i);
  }, 240_000);
});
