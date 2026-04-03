import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { deployL1Contract } from "@aztec/ethereum/deploy-l1-contract";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { computeSecretHash } from "@aztec/stdlib/hash";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import {
  MagnaCompanyRightsRegistryContract,
  MagnaCompanySponsorContract,
} from "@magna/contracts-bindings";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseAbiItem, pad } from "viem";

const runE2E = process.env.AZTEC_E2E === "1";
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const L1_RPC_URLS = (process.env.ETHEREUM_HOSTS ?? "http://localhost:8545")
  .split(",")
  .map(url => url.trim())
  .filter(Boolean);
const L1_MNEMONIC =
  process.env.MNEMONIC ?? "test test test test test test test test test test test junk";
const COMPANY_SPONSOR_MAX_FEE_CAP = 1_000_000_000_000_000n;
const STABLE_PRICE_PER_VERIFY = 150_000n; // 0.15 USDC with 6 decimals
const INITIAL_STABLE_SUPPLY = 1_000_000_000_000n;
const AZTEC_WAIT_FOR_NODE_MS = Number.parseInt(process.env.AZTEC_WAIT_FOR_NODE_MS ?? "240000", 10);

type L1Artifact = {
  abi: readonly unknown[];
  bytecode: {
    object: `0x${string}`;
  };
};

type BridgeContext = {
  node: ReturnType<typeof createAztecNodeClient>;
  wallet: EmbeddedWallet;
  orchestrator: AztecAddress;
  activeOwner: AztecAddress;
  rightsRegistry: MagnaCompanyRightsRegistryContract;
  companySponsor: MagnaCompanySponsorContract;
  l1Client: ReturnType<typeof createExtendedL1Client>;
  registryAddress: `0x${string}`;
  inboxAddress: `0x${string}`;
  portalAddress: `0x${string}`;
  portalArtifact: L1Artifact;
  paymentTokenAddress: `0x${string}`;
  paymentTokenArtifact: L1Artifact;
  l2NudgeToken: TokenContract;
};

function assertNode24Runtime(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 24) {
    throw new Error(
      `Node.js >=24 is required for this Aztec E2E flow. Current runtime: ${process.versions.node}. ` +
        "Run: nvm use 24",
    );
  }
}

async function waitForNode(node: ReturnType<typeof createAztecNodeClient>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await node.getNodeInfo();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Timed out waiting for Aztec node (${timeoutMs}ms)`);
}

function loadL1Artifact(sourceName: string, contractName: string): L1Artifact {
  const here = dirname(fileURLToPath(import.meta.url));
  const projectDir = resolve(here, "..", "..", "..", "l1-contracts", "magna-rights-portal");
  const artifactPath = resolve(projectDir, "out", sourceName, `${contractName}.json`);

  const build = spawnSync("forge", ["build"], {
    cwd: projectDir,
    stdio: "inherit",
    shell: false,
  });
  if ((build.status ?? 1) !== 0) {
    throw new Error(`forge build failed for ${contractName}`);
  }

  if (!existsSync(artifactPath)) {
    throw new Error(`Missing ${contractName} artifact: ${artifactPath}`);
  }

  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as L1Artifact;
  if (!artifact.bytecode?.object) {
    throw new Error(`${contractName} artifact missing bytecode`);
  }
  return artifact;
}

async function mineTwoL2Blocks(ctx: BridgeContext): Promise<void> {
  const nudgeRecipient = AztecAddress.fromBigInt(Fr.random().toBigInt());
  await ctx.l2NudgeToken.methods
    .mint_to_public(nudgeRecipient, 1n)
    .send({ from: ctx.orchestrator });
  await ctx.l2NudgeToken.methods
    .mint_to_public(nudgeRecipient, 1n)
    .send({ from: ctx.orchestrator });
}

const suite = runE2E ? describe.sequential : describe.skip;

suite("Magna rights local-network L1->L2 bridge flow", () => {
  let ctx: BridgeContext | undefined;
  let wallet: EmbeddedWallet | undefined;

  beforeAll(async () => {
    assertNode24Runtime();

    const node = createAztecNodeClient(AZTEC_NODE_URL);
    await waitForNode(node, AZTEC_WAIT_FOR_NODE_MS);

    const embeddedWallet = await EmbeddedWallet.create(node, {
      ephemeral: true,
      pxeConfig: { proverEnabled: false },
    });
    wallet = embeddedWallet;

    const testAccounts = await getInitialTestAccountsData();
    const orchestrator = (
      await embeddedWallet.createSchnorrAccount(
        testAccounts[0].secret,
        testAccounts[0].salt,
        testAccounts[0].signingKey,
        "rights-bridge-orchestrator",
      )
    ).address;
    const activeOwner = (
      await embeddedWallet.createSchnorrAccount(
        testAccounts[1].secret,
        testAccounts[1].salt,
        testAccounts[1].signingKey,
        "rights-bridge-active-owner",
      )
    ).address;
    await embeddedWallet.registerSender(orchestrator, "rights-bridge-orchestrator");

    const l1Client = createExtendedL1Client(L1_RPC_URLS, L1_MNEMONIC);
    const nodeInfo = await node.getNodeInfo();
    const registryAddress = nodeInfo.l1ContractAddresses.registryAddress.toString() as `0x${string}`;
    const inboxAddress = nodeInfo.l1ContractAddresses.inboxAddress.toString() as `0x${string}`;
    const portalArtifact = loadL1Artifact("MagnaRightsPortal.sol", "MagnaRightsPortal");
    const paymentTokenArtifact = loadL1Artifact("MockERC20.sol", "MockERC20");
    const paymentTokenDeployment = await deployL1Contract(
      l1Client,
      paymentTokenArtifact.abi,
      paymentTokenArtifact.bytecode.object,
      ["Mock USD Coin", "mUSDC", 6, l1Client.account.address, INITIAL_STABLE_SUPPLY],
    );
    const paymentTokenAddress = paymentTokenDeployment.address.toString() as `0x${string}`;
    const portalDeployment = await deployL1Contract(
      l1Client,
      portalArtifact.abi,
      portalArtifact.bytecode.object,
      [l1Client.account.address, paymentTokenAddress, STABLE_PRICE_PER_VERIFY],
    );
    const portalAddress = portalDeployment.address.toString() as `0x${string}`;
    const rightsRegistryDeploy = await MagnaCompanyRightsRegistryContract.deploy(
      embeddedWallet,
      EthAddress.fromString(portalAddress),
      orchestrator,
    ).send({
      from: orchestrator,
    });
    const l2NudgeTokenDeploy = await TokenContract.deploy(
      embeddedWallet,
      orchestrator,
      "L2 Nudge Token",
      "L2N",
      6,
    ).send({
      from: orchestrator,
    });
    const companySponsorDeploy = await MagnaCompanySponsorContract.deploy(
      embeddedWallet,
      orchestrator,
      COMPANY_SPONSOR_MAX_FEE_CAP,
    ).send({
      from: orchestrator,
    });
    const rightsRegistry = rightsRegistryDeploy.contract;
    const l2NudgeToken = l2NudgeTokenDeploy.contract;
    const companySponsor = companySponsorDeploy.contract;
    const initPortalTxHash = await (l1Client.writeContract as (...args: any[]) => Promise<`0x${string}`>)({
      address: portalAddress,
      abi: portalArtifact.abi,
      functionName: "initialize",
      args: [registryAddress, rightsRegistry.address.toString() as `0x${string}`],
    });
    await l1Client.waitForTransactionReceipt({ hash: initPortalTxHash });

    ctx = {
      node,
      wallet: embeddedWallet,
      orchestrator,
      activeOwner,
      rightsRegistry,
      companySponsor,
      l1Client,
      registryAddress,
      inboxAddress,
      portalAddress,
      portalArtifact,
      paymentTokenAddress,
      paymentTokenArtifact,
      l2NudgeToken,
    };
  }, 420_000);

  afterAll(async () => {
    if (wallet) {
      await wallet.stop();
    }
  });

  it("requires one-time portal initialization before purchases", async () => {
    if (!ctx) throw new Error("bridge context missing");

    const uninitializedPortalDeployment = await deployL1Contract(
      ctx.l1Client,
      ctx.portalArtifact.abi,
      ctx.portalArtifact.bytecode.object,
      [ctx.l1Client.account.address, ctx.paymentTokenAddress, STABLE_PRICE_PER_VERIFY],
    );
    const uninitializedPortal = uninitializedPortalDeployment.address.toString() as `0x${string}`;
    const secret = Fr.random();
    const secretHash = await computeSecretHash(secret);
    const packageId = pad("0x01", { size: 32 });
    const extraPolicyHash = pad("0x02", { size: 32 });

    await expect(
      (ctx.l1Client.writeContract as (...args: any[]) => Promise<`0x${string}`>)({
        address: uninitializedPortal,
        abi: ctx.portalArtifact.abi,
        functionName: "purchaseRights",
        args: [
          ctx.companySponsor.address.toString() as `0x${string}`,
          1n,
          pad(secretHash.toString() as `0x${string}`, { size: 32 }),
          packageId,
          extraPolicyHash,
        ],
      }),
    ).rejects.toBeDefined();

    const initTxHash = await (ctx.l1Client.writeContract as (...args: any[]) => Promise<`0x${string}`>)({
      address: uninitializedPortal,
      abi: ctx.portalArtifact.abi,
      functionName: "initialize",
      args: [ctx.registryAddress, ctx.rightsRegistry.address.toString() as `0x${string}`],
    });
    await ctx.l1Client.waitForTransactionReceipt({ hash: initTxHash });

    await expect(
      (ctx.l1Client.writeContract as (...args: any[]) => Promise<`0x${string}`>)({
        address: uninitializedPortal,
        abi: ctx.portalArtifact.abi,
        functionName: "initialize",
        args: [ctx.registryAddress, ctx.rightsRegistry.address.toString() as `0x${string}`],
      }),
    ).rejects.toBeDefined();
  }, 240_000);

  it("claims a purchase message on L2 and rejects replay", async () => {
    if (!ctx) throw new Error("bridge context missing");

    const rightsAmount = 7n;
    const packageIdField = Fr.random();
    const packageId = packageIdField.toString() as `0x${string}`;
    const extraPolicyHash = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
    const secret = Fr.random();
    const secretHash = await computeSecretHash(secret);
    const paymentAmount = rightsAmount * STABLE_PRICE_PER_VERIFY;

    const approveTxHash = await (ctx.l1Client.writeContract as (...args: any[]) => Promise<`0x${string}`>)({
      address: ctx.paymentTokenAddress,
      abi: ctx.paymentTokenArtifact.abi,
      functionName: "approve",
      args: [ctx.portalAddress, paymentAmount],
    });
    await ctx.l1Client.waitForTransactionReceipt({ hash: approveTxHash });

    const purchaseTxHash = await (ctx.l1Client.writeContract as (...args: any[]) => Promise<`0x${string}`>)({
      address: ctx.portalAddress,
      abi: ctx.portalArtifact.abi,
      functionName: "purchaseRights",
      args: [
        ctx.companySponsor.address.toString() as `0x${string}`,
        rightsAmount,
        pad(secretHash.toString() as `0x${string}`, { size: 32 }),
        packageId,
        extraPolicyHash,
      ],
    });
    const purchaseReceipt = await ctx.l1Client.waitForTransactionReceipt({ hash: purchaseTxHash });

    const rightsPurchasedEvent = parseAbiItem(
      "event RightsPurchased(uint256 indexed purchaseId, bytes32 indexed sponsorAddressOnAztec, uint128 rightsAmount, bytes32 packageId, bytes32 creditNonce, bytes32 contentHash, bytes32 secretHash, bytes32 messageKey, uint256 messageLeafIndex, uint256 paymentAmount, address payer)",
    );
    const purchasedLogs = await ctx.l1Client.getLogs({
      address: ctx.portalAddress,
      event: rightsPurchasedEvent,
      fromBlock: purchaseReceipt.blockNumber,
      toBlock: purchaseReceipt.blockNumber,
    });
    expect(purchasedLogs.length).toBeGreaterThan(0);
    const purchased = purchasedLogs[0];
    const creditNonce = purchased.args.creditNonce as `0x${string}`;

    const inboxMessageSentEvent = parseAbiItem(
      "event MessageSent(uint256 indexed checkpointNumber, uint256 index, bytes32 indexed hash, bytes16 rollingHash)",
    );
    const inboxLogs = await ctx.l1Client.getLogs({
      address: ctx.inboxAddress,
      event: inboxMessageSentEvent,
      fromBlock: purchaseReceipt.blockNumber,
      toBlock: purchaseReceipt.blockNumber,
    });
    expect(inboxLogs.length).toBeGreaterThan(0);
    const messageLeafIndex = inboxLogs[0].args.index!;

    const before = await ctx.rightsRegistry.methods
      .get_remaining_verifies(ctx.companySponsor.address)
      .simulate({ from: ctx.activeOwner })
      .then(result => result.result as bigint);

    await mineTwoL2Blocks(ctx);

    await ctx.rightsRegistry.methods
      .claim_l1_credit(
        ctx.companySponsor.address,
        rightsAmount,
        packageIdField,
        Fr.fromHexString(creditNonce),
        secret,
        messageLeafIndex,
      )
      .send({ from: ctx.orchestrator });

    const after = await ctx.rightsRegistry.methods
      .get_remaining_verifies(ctx.companySponsor.address)
      .simulate({ from: ctx.activeOwner })
      .then(result => result.result as bigint);
    expect(after).toEqual(before + rightsAmount);

    await expect(
      ctx.rightsRegistry.methods
        .claim_l1_credit(
          ctx.companySponsor.address,
          rightsAmount,
          packageIdField,
          Fr.fromHexString(creditNonce),
          secret,
          messageLeafIndex,
        )
        .send({ from: ctx.orchestrator }),
    ).rejects.toBeDefined();
  }, 420_000);
});
