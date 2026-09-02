#!/usr/bin/env node

// Bridge + claim Fee Juice from the local-network L1 to any L2 address.
// Fee Juice is not transferable between L2 accounts: the only way to fund an
// arbitrary address (e.g. an embedded-wallet active account or a recovery ghost)
// is to bridge it from L1 and claim it. This mirrors the sponsor-funding path in
// scripts/bootstrap-local-apps.mjs.
//
// Usage:
//   node ./scripts/fund-fee-juice.mjs <l2-address> [options]
//
// Options:
//   --fee-payer-index <n>      Local test account that pays for / sends the claim tx. Default: 0
//   --aztec-node-url <url>      Default: manifest endpoint or http://127.0.0.1:8080
//   --l1-rpc-url <url>          Default: manifest endpoint or http://127.0.0.1:8545
//   --l1-mnemonic <mnemonic>   Default: MNEMONIC env or the anvil "test ... junk" mnemonic
//   --manifest <path>          Default: deployments/local.json (used only for endpoints)
//   --wait-ms <ms>             Fee Juice bridge witness timeout. Default: 420000
//   --poll-ms <ms>             Fee Juice bridge witness poll interval. Default: 15000
//   --skip-checkpoint-advance  Do not advance bounded local Aztec checkpoints

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getInitialTestAccountsData, INITIAL_TEST_SIGNING_KEYS } from "@aztec/accounts/testing";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { FeeJuiceContract, ProtocolContractAddress } from "@aztec/aztec.js/protocol";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { createLogger } from "@aztec/foundation/log";
import { retryUntil } from "@aztec/foundation/retry";
import { getNonNullifiedL1ToL2MessageWitness } from "@aztec/stdlib/messaging";
import { createAztecNodeDebugClient } from "@aztec/stdlib/interfaces/client";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { createPublicClient, http, parseAbi } from "viem";

const DEFAULT_NETWORK_NAME = "local";
const DEFAULT_WAIT_FOR_NODE_MS = 120_000;
const DEFAULT_FEE_JUICE_WITNESS_WAIT_MS = 420_000;
const DEFAULT_FEE_JUICE_WITNESS_POLL_MS = 15_000;
const DEFAULT_LOCAL_TEST_ACCOUNT_INDEX = 0;
const LOCAL_ANVIL_CHAIN_ID = 31_337n;
const LOCAL_CLOCK_DRIFT_DANGER_SECONDS = 180n;
const DEFAULT_L1_MNEMONIC =
  process.env.MNEMONIC ?? "test test test test test test test test test test test junk";
const inboxAbi = parseAbi(["function LAG() view returns (uint256)"]);

function assertNode24Runtime() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 24) {
    throw new Error(`Node.js >=24 is required. Current runtime: ${process.versions.node}`);
  }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function usage() {
  return `Usage:
  node ./scripts/fund-fee-juice.mjs <l2-address> [options]

Options:
  --fee-payer-index <n>      Local test account that sends the claim tx. Default: 0
  --aztec-node-url <url>     Default: manifest endpoint or http://127.0.0.1:8080
  --l1-rpc-url <url>         Default: manifest endpoint or http://127.0.0.1:8545
  --l1-mnemonic <mnemonic>  Default: MNEMONIC env or the anvil "test ... junk" mnemonic
  --manifest <path>         Default: deployments/local.json (endpoints only)
  --wait-ms <ms>            Fee Juice bridge witness timeout. Default: 420000
  --poll-ms <ms>            Fee Juice bridge witness poll interval. Default: 15000
  --skip-checkpoint-advance Do not advance bounded local Aztec checkpoints
`;
}

function parseNumber(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite integer`);
  }
  return parsed;
}

function readJsonIfExists(path) {
  if (!path || !existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function errorDetails(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNode(node, timeoutMs) {
  await retryUntil(
    async () => {
      try {
        await node.getNodeInfo();
        return true;
      } catch {
        return undefined;
      }
    },
    "Aztec node readiness",
    Math.max(1, Math.ceil(timeoutMs / 1000)),
    1,
  );
}

async function importLocalTestAccount(wallet, index) {
  const testAccounts = await getInitialTestAccountsData();
  const account = testAccounts[index];
  if (!account) {
    throw new Error(`Local test account index ${index} is not available.`);
  }
  const manager = await wallet.createSchnorrInitializerlessAccount(
    account.secret,
    account.salt,
    INITIAL_TEST_SIGNING_KEYS[index] ?? account.signingKey,
    `local-test-${index}`,
  );
  return manager.address;
}

async function bridgeFeeJuiceToAddress(node, l1RpcUrls, l1Mnemonic, recipient) {
  const l1Client = createExtendedL1Client(l1RpcUrls, l1Mnemonic);
  const logger = createLogger("magna:fund-fee-juice");
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, logger);
  const claim = await portalManager.bridgeTokensPublic(recipient, undefined, true);
  return {
    claimAmount: claim.claimAmount,
    claimSecret: claim.claimSecret,
    messageHash: claim.messageHash,
    messageLeafIndex: claim.messageLeafIndex,
  };
}

function localCheckpointAdvanceLimit(inboxLag) {
  if (inboxLag < 1n || inboxLag > 64n) {
    throw new Error(`Canonical Inbox returned an invalid local checkpoint lag: ${inboxLag}.`);
  }
  return Number(inboxLag) + 2;
}

async function getClaimWitness(node, claim) {
  return getNonNullifiedL1ToL2MessageWitness(
    node,
    ProtocolContractAddress.FeeJuice,
    Fr.fromHexString(claim.messageHash),
    claim.claimSecret,
  );
}

function assertClaimWitnessIndex(witness, expectedLeafIndex) {
  if (witness[0] !== expectedLeafIndex) {
    throw new Error(
      `Fee Juice Inbox index mismatch: portal=${expectedLeafIndex} Aztec=${witness[0]}.`,
    );
  }
}

async function advanceLocalCheckpointsForClaim(node, nodeUrl, l1RpcUrl, claim, pollMs) {
  const nodeInfo = await node.getNodeInfo();
  const nodeChainId = BigInt(nodeInfo.l1ChainId);
  if (nodeChainId !== LOCAL_ANVIL_CHAIN_ID) {
    throw new Error(
      `Refusing Fee Juice debug checkpoint advancement on chain ${nodeChainId}; ` +
        `only local Anvil chain ${LOCAL_ANVIL_CHAIN_ID} is allowed.`,
    );
  }

  const l1 = createPublicClient({ transport: http(l1RpcUrl) });
  const l1ChainId = BigInt(await l1.getChainId());
  if (l1ChainId !== LOCAL_ANVIL_CHAIN_ID) {
    throw new Error(`Fee Juice local L1 RPC reports unexpected chain ${l1ChainId}.`);
  }

  const inboxAddress = nodeInfo.l1ContractAddresses.inboxAddress.toString();
  const inboxLag = await l1.readContract({
    address: inboxAddress,
    abi: inboxAbi,
    functionName: "LAG",
  });
  const advanceLimit = localCheckpointAdvanceLimit(inboxLag);
  const debug = createAztecNodeDebugClient(nodeUrl);
  const advanceClockPacedCheckpoint = async () => {
    while (true) {
      const latestBlock = await l1.getBlock();
      const wallTimestamp = BigInt(Math.floor(Date.now() / 1000));
      const drift = latestBlock.timestamp - wallTimestamp;
      if (drift >= LOCAL_CLOCK_DRIFT_DANGER_SECONDS) {
        throw new Error(
          `Local L1 is ${drift}s ahead of the host. Restart with npm run network:local and rerun both local ` +
            "bootstraps before funding; another checkpoint would make the monotonic clock problem worse.",
        );
      }
      if (latestBlock.timestamp < wallTimestamp) {
        const beforeL2Block = await node.getBlockNumber();
        await debug.warpL2TimeAtLeastTo(Number(wallTimestamp));
        if ((await node.getBlockNumber()) > beforeL2Block) return;
        continue;
      }
      await sleep(1_000);
    }
  };
  let lastError = "message not indexed yet";

  for (let advanced = 0; advanced <= advanceLimit; advanced += 1) {
    let witness;
    try {
      witness = await getClaimWitness(node, claim);
    } catch (error) {
      lastError = errorDetails(error);
    }
    if (witness) {
      assertClaimWitnessIndex(witness, claim.messageLeafIndex);
      return { localCheckpointsAdvanced: advanced };
    }
    if (advanced === advanceLimit) break;
    await advanceClockPacedCheckpoint();
    await sleep(pollMs);
  }

  throw new Error(
    `Fee Juice Inbox message was not committed after ${advanceLimit} bounded local checkpoint advances. ` +
      `last_error=${lastError}`,
  );
}

async function claimBridgedFeeJuice(
  node,
  wallet,
  feePayer,
  recipient,
  claim,
  waitMs,
  pollMs,
  witnessAlreadyConfirmed,
) {
  const startedAt = Date.now();
  let lastError = "unknown";
  let witnessReady = witnessAlreadyConfirmed;
  while (!witnessReady && Date.now() - startedAt < waitMs) {
    try {
      const witness = await getClaimWitness(node, claim);
      assertClaimWitnessIndex(witness, claim.messageLeafIndex);
      witnessReady = true;
    } catch (error) {
      lastError = errorDetails(error);
      console.info(`[fund-fee-juice] bridge witness not ready yet: ${lastError}`);
      await sleep(pollMs);
    }
  }

  if (!witnessReady) {
    throw new Error(
      `Timeout awaiting Fee Juice bridge message witness after ${waitMs}ms. last_error=${lastError}`,
    );
  }

  const feeJuice = FeeJuiceContract.at(wallet);
  const claimReceipt = await feeJuice.methods
    .claim(recipient, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({ from: feePayer });
  const balanceAfterClaim = await getFeeJuiceBalance(recipient, node);
  return {
    claimTxHash: String(
      claimReceipt.txHash?.toString?.() ?? claimReceipt.receipt?.txHash?.toString?.() ?? "",
    ),
    balanceAfterClaim,
  };
}

async function main() {
  assertNode24Runtime();

  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.info(usage());
    process.exit(0);
  }

  const recipientArg = args._[0];
  if (!recipientArg || typeof recipientArg !== "string") {
    console.error("Error: an L2 recipient address is required.\n");
    console.info(usage());
    process.exit(1);
  }
  const recipient = AztecAddress.fromStringUnsafe(recipientArg);

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const manifestPath = resolve(repoRoot, String(args.manifest ?? `deployments/${DEFAULT_NETWORK_NAME}.json`));
  const manifest = readJsonIfExists(manifestPath);

  const nodeUrl = String(
    args.aztecNodeUrl ?? manifest?.endpoints?.aztecNodeUrl ?? process.env.AZTEC_NODE_URL ?? "http://127.0.0.1:8080",
  );
  const l1RpcUrls = String(
    args.l1RpcUrl ?? process.env.ETHEREUM_HOSTS ?? manifest?.endpoints?.l1RpcUrl ?? "http://127.0.0.1:8545",
  )
    .split(",")
    .map(url => url.trim())
    .filter(Boolean);
  const l1Mnemonic = String(args.l1Mnemonic ?? DEFAULT_L1_MNEMONIC);
  const feePayerIndex = parseNumber(args.feePayerIndex, DEFAULT_LOCAL_TEST_ACCOUNT_INDEX, "fee-payer-index");
  const witnessWaitMs = parseNumber(args.waitMs, DEFAULT_FEE_JUICE_WITNESS_WAIT_MS, "wait-ms");
  const witnessPollMs = parseNumber(args.pollMs, DEFAULT_FEE_JUICE_WITNESS_POLL_MS, "poll-ms");

  const node = createAztecNodeClient(nodeUrl);
  await waitForNode(node, DEFAULT_WAIT_FOR_NODE_MS);
  console.info(`[fund-fee-juice] aztec node ready (${nodeUrl})`);

  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { proverEnabled: false },
  });

  try {
    const feePayer = await importLocalTestAccount(wallet, feePayerIndex);
    console.info(`[fund-fee-juice] claim fee payer: local-test-${feePayerIndex} (${feePayer.toString()})`);

    const balanceBefore = await getFeeJuiceBalance(recipient, node);
    console.info(`[fund-fee-juice] recipient ${recipient.toString()} balance before: ${balanceBefore.toString()}`);

    const claim = await bridgeFeeJuiceToAddress(node, l1RpcUrls, l1Mnemonic, recipient);
    console.info(
      `[fund-fee-juice] bridged ${claim.claimAmount.toString()} Fee Juice from L1; awaiting ingestion`,
    );

    let witnessAlreadyConfirmed = false;
    if (!args.skipCheckpointAdvance) {
      const checkpointResult = await advanceLocalCheckpointsForClaim(
        node,
        nodeUrl,
        l1RpcUrls[0],
        claim,
        Math.min(witnessPollMs, 2_000),
      );
      witnessAlreadyConfirmed = true;
      console.info(
        `[fund-fee-juice] canonical Inbox membership available after advancing ` +
          `${checkpointResult.localCheckpointsAdvanced} local checkpoint(s)`,
      );
    }

    const result = await claimBridgedFeeJuice(
      node,
      wallet,
      feePayer,
      recipient,
      claim,
      witnessWaitMs,
      witnessPollMs,
      witnessAlreadyConfirmed,
    );

    console.info("[fund-fee-juice] completed");
    console.info(
      JSON.stringify(
        {
          recipient: recipient.toString(),
          claimTxHash: result.claimTxHash,
          claimAmount: claim.claimAmount.toString(),
          balanceBefore: balanceBefore.toString(),
          balanceAfter: result.balanceAfterClaim.toString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await wallet.stop().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(`[fund-fee-juice] ${errorDetails(error)}`);
  process.exit(1);
});
