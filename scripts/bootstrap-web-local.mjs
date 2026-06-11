#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { ProtocolContractAddress } from "@aztec/aztec.js/protocol";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { deployL1Contract } from "@aztec/ethereum/deploy-l1-contract";
import { EthCheatCodes } from "@aztec/ethereum/test";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { createLogger } from "@aztec/foundation/log";
import { TestDateProvider } from "@aztec/foundation/timer";
import { retryUntil } from "@aztec/foundation/retry";
import { getNonNullifiedL1ToL2MessageWitness } from "@aztec/stdlib/messaging";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { FeeJuiceContract } from "@aztec/noir-contracts.js/FeeJuice";
import { TokenContract } from "@aztec/noir-contracts.js/Token";

import { MagnaIssuerContract } from "../packages/contracts-bindings/src/MagnaIssuer.ts";
import { MagnaCompanySponsorContract } from "../packages/contracts-bindings/src/MagnaCompanySponsor.ts";
import { MagnaConsumerContract } from "../packages/contracts-bindings/src/MagnaConsumer.ts";
import { MagnaCompanyRightsRegistryContract } from "../packages/contracts-bindings/src/MagnaCompanyRightsRegistry.ts";
import { MagnaRightsPurchaseL2Contract } from "../packages/contracts-bindings/src/MagnaRightsPurchaseL2.ts";

const DEFAULT_NETWORK_NAME = "local";
const DEFAULT_WAIT_FOR_NODE_MS = 120_000;
const DEFAULT_FEE_JUICE_WITNESS_WAIT_MS = 420_000;
const DEFAULT_FEE_JUICE_WITNESS_POLL_MS = 15_000;
const DEFAULT_SPONSOR_MAX_FEE_CAP = 1_000_000_000_000_000n;
const DEFAULT_INITIAL_SPONSOR_RIGHTS = 1_000_000n;
const DEFAULT_L2_PRICE_PER_VERIFY = 150_000n;
const DEFAULT_L2_STABLE_MINT_AMOUNT = 10_000_000_000_000n;
const DEFAULT_L1_STABLE_INITIAL_SUPPLY = 1_000_000_000_000n;
const MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS = 300n;
const DEFAULT_LOCAL_TEST_ACCOUNT_INDEX = 0;
const DEFAULT_L1_MNEMONIC =
  process.env.MNEMONIC ?? "test test test test test test test test test test test junk";
const TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS = [
  "Invalid tx: Invalid expiration timestamp",
  "Invalid tx: Block header not found",
  "Tx dropped by P2P node",
];
const ERC20_DECIMALS_ABI = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
];

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
  node ./scripts/bootstrap-web-local.mjs [options]

Options:
  --network-name <name>               Default: local
  --manifest <path>                   Default: deployments/<network>.json
  --env-out <path>                    Default: apps/magna-web/.env.local
  --aztec-node-url <url>              Optional override for node URL
  --l1-rpc-url <url>                  Optional override for L1 RPC URL
  --l1-mnemonic <mnemonic>            Optional override for test mnemonic
  --treasury <address>                Optional override for rights-stack L1 portal treasury
  --l1-payment-token-address <addr>   Optional override for rights-stack L1 payment token
  --local-test-account-index <n>      Default: 0
  --wait-for-node-ms <ms>             Default: 120000
  --fee-juice-witness-wait-ms <ms>    Default: 420000
  --fee-juice-witness-poll-ms <ms>    Default: 15000
  --sponsor-max-fee-cap <integer>     Default: 1000000000000000
  --initial-sponsor-rights <integer>  Default: 1000000
  --skip-rights-deploy                Reuse existing manifest instead of running magna:testnet deploy first
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

function parseBigInt(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return BigInt(String(value));
  } catch {
    throw new Error(`${label} must be a bigint-compatible value`);
  }
}

function readJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadL1Artifact(sourceName, contractName) {
  const here = dirname(fileURLToPath(import.meta.url));
  const projectDir = resolve(here, "..", "l1-contracts", "magna-rights-portal");
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
    throw new Error(`Missing ${contractName} artifact at ${artifactPath}`);
  }

  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!artifact?.bytecode?.object) {
    throw new Error(`${contractName} artifact missing bytecode`);
  }
  return artifact;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function unwrapStepResult(value) {
  if (value && typeof value === "object" && "result" in value) {
    return value.result;
  }
  return value;
}

function toBigIntValue(value) {
  const unwrapped = unwrapStepResult(value);
  if (typeof unwrapped === "bigint") return unwrapped;
  if (typeof unwrapped === "number") return BigInt(unwrapped);
  if (typeof unwrapped === "string") return BigInt(unwrapped);
  if (unwrapped && typeof unwrapped.toBigInt === "function") return unwrapped.toBigInt();
  if (unwrapped && typeof unwrapped.toString === "function") {
    const asString = unwrapped.toString();
    if (asString && asString !== "[object Object]") return BigInt(asString);
  }
  throw new SyntaxError(`Cannot convert ${String(unwrapped)} to a BigInt`);
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientLocalNetworkTxError(error) {
  const details = errorDetails(error);
  return TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS.some(marker => details.includes(marker));
}

async function runRetriedStep(label, work) {
  let attempt = 1;
  while (true) {
    console.info(`[web-bootstrap] ${label}${attempt > 1 ? ` (retry=${attempt - 1})` : ""}`);
    try {
      return await work();
    } catch (error) {
      const details = errorDetails(error);
      if (!isTransientLocalNetworkTxError(error) || attempt >= 3) {
        throw new Error(`${label} failed: ${details}`);
      }
      console.info(`[web-bootstrap] transient local-network tx error: ${details}`);
      await sleep(250);
      attempt += 1;
    }
  }
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

async function syncWalletPxeAfterWarp(label, wallet) {
  const debugSync = wallet?.pxe?.debug?.sync;
  if (!debugSync) {
    await sleep(1_000);
    return;
  }
  console.info(`[web-bootstrap] ${label} syncing PXE after L1 warp`);
  await retryUntil(
    async () => {
      try {
        await debugSync.call(wallet.pxe.debug);
        return true;
      } catch {
        return undefined;
      }
    },
    `${label} PXE sync after warp`,
    30,
    1,
  );
}

async function warpForwardSeconds({ l1RpcUrls, l1Mnemonic, label, seconds, wallet }) {
  const l1Client = createExtendedL1Client(l1RpcUrls, l1Mnemonic);
  const currentTimestamp = BigInt((await l1Client.getBlock()).timestamp);
  const targetTimestamp = currentTimestamp + seconds + 1n;
  const cheatCodes = new EthCheatCodes(
    l1RpcUrls,
    new TestDateProvider(),
    createLogger("magna:web-bootstrap:time-warp"),
  );
  await cheatCodes.warp(targetTimestamp, { silent: true, resetBlockInterval: true });
  console.info(
    `[web-bootstrap] ${label} warped time ` +
      `(from_ts=${currentTimestamp.toString()} to_ts=${targetTimestamp.toString()})`,
  );
  await syncWalletPxeAfterWarp(label, wallet);
}

async function mineTwoL2BlocksForBridgeIngestion(l2NudgeToken, orchestrator, label = "bridge ingestion") {
  const nudgeRecipient = AztecAddress.fromBigInt(Fr.random().toBigInt());
  await runRetriedStep(`${label} L2 nudge #1`, async () => {
    return await l2NudgeToken.methods.mint_to_public(nudgeRecipient, 1n).send({ from: orchestrator });
  });
  await runRetriedStep(`${label} L2 nudge #2`, async () => {
    return await l2NudgeToken.methods.mint_to_public(nudgeRecipient, 1n).send({ from: orchestrator });
  });
}

async function bridgeFeeJuiceToAddress(node, l1RpcUrls, l1Mnemonic, recipient) {
  const l1Client = createExtendedL1Client(l1RpcUrls, l1Mnemonic);
  const logger = createLogger("magna:web-bootstrap:fee-juice");
  const portalManager = await L1FeeJuicePortalManager.new(node, l1Client, logger);
  const claim = await portalManager.bridgeTokensPublic(recipient, undefined, true);
  return {
    claimAmount: claim.claimAmount,
    claimSecret: claim.claimSecret,
    messageHash: claim.messageHash,
    messageLeafIndex: claim.messageLeafIndex,
  };
}

async function claimBridgedFeeJuice(
  node,
  wallet,
  feePayer,
  recipient,
  claim,
  waitMs,
  pollMs,
) {
  const startedAt = Date.now();
  let lastError = "unknown";
  while (Date.now() - startedAt < waitMs) {
    try {
      await getNonNullifiedL1ToL2MessageWitness(
        node,
        ProtocolContractAddress.FeeJuice,
        Fr.fromHexString(claim.messageHash),
        claim.claimSecret,
      );
      break;
    } catch (error) {
      lastError = errorDetails(error);
      await sleep(pollMs);
    }
  }

  if (Date.now() - startedAt >= waitMs) {
    throw new Error(
      `Timeout awaiting Fee Juice bridge message witness after ${waitMs}ms. last_error=${lastError}`,
    );
  }

  const feeJuice = await FeeJuiceContract.at(ProtocolContractAddress.FeeJuice, wallet);
  const claimReceipt = await runRetriedStep(`FeeJuice.claim(${recipient.toString()})`, async () => {
    return await feeJuice.methods
      .claim(recipient, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
      .send({ from: feePayer });
  });
  const balanceAfterClaim = await getFeeJuiceBalance(recipient, node);
  return {
    claimTxHash: String(claimReceipt.txHash?.toString?.() ?? claimReceipt.receipt?.txHash?.toString?.() ?? ""),
    balanceAfterClaim,
  };
}

async function topUpRightsFromL2Payment({
  wallet,
  orchestrator,
  l2PaymentToken,
  l2RightsPurchase,
  l2Treasury,
  simulateFrom,
  sponsor,
  rightsAmount,
  packageId,
  pricePerVerify,
}) {
  const authwitNonce = Fr.random();
  const paymentAmount = rightsAmount * pricePerVerify;
  const action = l2PaymentToken.methods.transfer_in_public(
    orchestrator,
    l2Treasury,
    paymentAmount,
    authwitNonce,
  );

  await runRetriedStep("set public authwit for rights purchase", async () => {
    const setAuthwit = await SetPublicAuthwitContractInteraction.create(
      wallet,
      orchestrator,
      { caller: l2RightsPurchase.address, action },
      true,
    );
    return await setAuthwit.send();
  });

  const purchaseReceipt = await runRetriedStep("purchase sponsor rights", async () => {
    return await l2RightsPurchase.methods
      .purchase_rights_public(sponsor, rightsAmount, packageId, authwitNonce)
      .send({ from: orchestrator });
  });
  const nextPurchaseId = await l2RightsPurchase.methods.get_next_purchase_id().simulate({ from: simulateFrom });
  return {
    authwitNonce: authwitNonce.toString(),
    purchaseId: (toBigIntValue(nextPurchaseId) - 1n).toString(),
    purchaseTxHash: String(
      purchaseReceipt.txHash?.toString?.() ?? purchaseReceipt.receipt?.txHash?.toString?.() ?? "",
    ),
  };
}

function updateManifestWithWebBootstrap(manifestPath, details) {
  const manifest = readJson(manifestPath, "Deployment manifest");
  manifest.l2 = manifest.l2 ?? {};
  manifest.l2.issuerAddress = details.issuerAddress;
  manifest.l2.consumerAddress = details.consumerAddress;
  manifest.l2.companySponsorAddress = details.companySponsorAddress;
  manifest.l2.companySponsorAddresses = Array.from(
    new Set([...(manifest.l2.companySponsorAddresses ?? []), details.companySponsorAddress]),
  );
  manifest.l2.activeCompanySponsorAddress = details.companySponsorAddress;
  manifest.l2.webBootstrap = {
    orchestratorAddress: details.orchestratorAddress,
    txHashes: details.txHashes,
  };
  manifest.timestamps = manifest.timestamps ?? {};
  manifest.timestamps.webBootstrappedAt = new Date().toISOString();
  writeJson(manifestPath, manifest);
}

function runNodeScript(scriptPath, args, description) {
  console.info(`[web-bootstrap] ${description}`);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: resolve(dirname(scriptPath), ".."),
    stdio: "inherit",
    shell: false,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${description} failed with exit code ${result.status ?? 1}`);
  }
}

async function ensureL1PaymentTokenAddress({ existingAddress, l1Client }) {
  if (existingAddress) {
    try {
      await l1Client.readContract({
        address: existingAddress,
        abi: ERC20_DECIMALS_ABI,
        functionName: "decimals",
      });
      return existingAddress;
    } catch (error) {
      console.info(
        `[web-bootstrap] existing L1 payment token address is not usable on current network; ` +
          `deploying a fresh mock token instead: ${errorDetails(error)}`,
      );
    }
  }

  const paymentTokenArtifact = loadL1Artifact("MockERC20.sol", "MockERC20");
  const deployment = await deployL1Contract(
    l1Client,
    paymentTokenArtifact.abi,
    paymentTokenArtifact.bytecode.object,
    ["Mock USD Coin", "mUSDC", 6, l1Client.account.address, DEFAULT_L1_STABLE_INITIAL_SUPPLY],
  );
  return deployment.address.toString();
}

async function loadInitialLocalNetworkAccountsInWallet(wallet) {
  const testAccounts = await getInitialTestAccountsData();
  const addresses = [];
  for (let i = 0; i < testAccounts.length; i += 1) {
    const account = testAccounts[i];
    const alias = `local-test-${i}`;
    const manager = await wallet.createSchnorrAccount(
      account.secret,
      account.salt,
      account.signingKey,
      alias,
    );
    addresses.push(manager.address);
  }
  return addresses;
}

async function main() {
  assertNode24Runtime();

  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.info(usage());
    process.exit(0);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const networkName = String(args.networkName ?? DEFAULT_NETWORK_NAME);
  const manifestPath = resolve(repoRoot, String(args.manifest ?? `deployments/${networkName}.json`));
  const envOutPath = resolve(repoRoot, String(args.envOut ?? "apps/magna-web/.env.local"));
  const existingManifest = existsSync(manifestPath) ? readJson(manifestPath, "Deployment manifest") : undefined;
  const nodeUrl = String(
    args.aztecNodeUrl ?? existingManifest?.endpoints?.aztecNodeUrl ?? process.env.AZTEC_NODE_URL ?? "http://127.0.0.1:8080",
  );
  const l1RpcUrls = String(
    args.l1RpcUrl ?? process.env.ETHEREUM_HOSTS ?? existingManifest?.endpoints?.l1RpcUrl ?? "http://127.0.0.1:8545",
  )
    .split(",")
    .map(url => url.trim())
    .filter(Boolean);
  const l1Mnemonic = String(args.l1Mnemonic ?? DEFAULT_L1_MNEMONIC);
  const waitForNodeMs = parseNumber(args.waitForNodeMs, DEFAULT_WAIT_FOR_NODE_MS, "wait-for-node-ms");
  const feeJuiceWitnessWaitMs = parseNumber(
    args.feeJuiceWitnessWaitMs,
    DEFAULT_FEE_JUICE_WITNESS_WAIT_MS,
    "fee-juice-witness-wait-ms",
  );
  const feeJuiceWitnessPollMs = parseNumber(
    args.feeJuiceWitnessPollMs,
    DEFAULT_FEE_JUICE_WITNESS_POLL_MS,
    "fee-juice-witness-poll-ms",
  );
  const localTestAccountIndex = parseNumber(
    args.localTestAccountIndex,
    DEFAULT_LOCAL_TEST_ACCOUNT_INDEX,
    "local-test-account-index",
  );
  const sponsorMaxFeeCap = parseBigInt(
    args.sponsorMaxFeeCap,
    DEFAULT_SPONSOR_MAX_FEE_CAP,
    "sponsor-max-fee-cap",
  );
  const initialSponsorRights = parseBigInt(
    args.initialSponsorRights,
    DEFAULT_INITIAL_SPONSOR_RIGHTS,
    "initial-sponsor-rights",
  );
  if (!args.skipRightsDeploy) {
    const l1Client = createExtendedL1Client(l1RpcUrls, l1Mnemonic);
    const initialAccounts = await getInitialTestAccountsData();
    const adminAccount = initialAccounts[localTestAccountIndex];
    if (!adminAccount) {
      throw new Error(`Local test account index ${localTestAccountIndex} is not available.`);
    }
    const rightsDeployTreasury =
      args.treasury ??
      existingManifest?.l1?.treasuryAddress ??
      existingManifest?.l2?.treasuryAddress ??
      l1Client.account.address;
    const rightsDeployL1PaymentTokenAddress = await ensureL1PaymentTokenAddress({
      existingAddress: args.l1PaymentTokenAddress ?? existingManifest?.l1?.paymentTokenAddress,
      l1Client,
    });

    runNodeScript(
      resolve(repoRoot, "scripts/magna-testnet-validate.mjs"),
      [
        "deploy",
        "--network-name",
        networkName,
        "--manifest",
        manifestPath,
        "--aztec-node-url",
        nodeUrl,
        "--l1-rpc-url",
        l1RpcUrls[0],
        "--l1-mnemonic",
        l1Mnemonic,
        "--treasury",
        rightsDeployTreasury,
        "--l1-payment-token-address",
        rightsDeployL1PaymentTokenAddress,
        "--aztec-admin-secret",
        adminAccount.secret.toString(),
        "--aztec-admin-salt",
        adminAccount.salt.toString(),
        "--aztec-admin-signing-key",
        adminAccount.signingKey.toString(),
        "--aztec-admin-alias",
        `local-test-${localTestAccountIndex}`,
        "--aztec-admin-address",
        adminAccount.address.toString(),
        "--wallet-ephemeral",
        "true",
      ],
      "deploy rights stack via magna:testnet deploy",
    );
  }

  const manifest = readJson(manifestPath, "Deployment manifest");

  const rightsRegistryAddress = manifest?.l2?.rightsRegistryAddress;
  const purchaseAdapterAddress = manifest?.l2?.purchaseAdapterAddress;
  const paymentTokenAddress = manifest?.l2?.paymentTokenAddress;
  const expectedAdminAddress = manifest?.l2?.adminAddress;

  if (!rightsRegistryAddress || !purchaseAdapterAddress || !paymentTokenAddress || !expectedAdminAddress) {
    throw new Error(
      `Manifest ${manifestPath} is missing required rights-stack addresses. Re-run without --skip-rights-deploy.`,
    );
  }

  const node = createAztecNodeClient(nodeUrl);
  await waitForNode(node, waitForNodeMs);
  console.info(`[web-bootstrap] aztec node ready (${nodeUrl})`);

  const wallet = await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: { proverEnabled: false },
  });

  try {
    const initialAccounts = await loadInitialLocalNetworkAccountsInWallet(wallet);
    const orchestrator = initialAccounts[localTestAccountIndex];
    if (!orchestrator) {
      throw new Error(`Local test account index ${localTestAccountIndex} is not available`);
    }

    if (orchestrator.toString().toLowerCase() !== String(expectedAdminAddress).toLowerCase()) {
      throw new Error(
        `Local test account #${localTestAccountIndex} (${orchestrator.toString()}) does not match manifest admin ` +
          `${expectedAdminAddress}. Use the account index that matches the deployed rights stack admin.`,
      );
    }

    await wallet.registerSender(orchestrator, `local-test-${localTestAccountIndex}`);

    const rightsRegistry = MagnaCompanyRightsRegistryContract.at(
      AztecAddress.fromString(rightsRegistryAddress),
      wallet,
    );
    const l2RightsPurchase = MagnaRightsPurchaseL2Contract.at(
      AztecAddress.fromString(purchaseAdapterAddress),
      wallet,
    );
    const l2PaymentToken = TokenContract.at(AztecAddress.fromString(paymentTokenAddress), wallet);

    const issuerDeployReceipt = await runRetriedStep("deploy MagnaIssuer", async () => {
      return await MagnaIssuerContract.deploy(wallet, orchestrator, AztecAddress.ZERO).send({
        from: orchestrator,
      });
    });
    const issuer = issuerDeployReceipt.contract;

    const companySponsorDeployReceipt = await runRetriedStep("deploy MagnaCompanySponsor", async () => {
      return await MagnaCompanySponsorContract.deploy(wallet, orchestrator, sponsorMaxFeeCap).send({
        from: orchestrator,
      });
    });
    const companySponsor = companySponsorDeployReceipt.contract;

    const consumerDeployReceipt = await runRetriedStep("deploy MagnaConsumer", async () => {
      return await MagnaConsumerContract.deploy(wallet, issuer.address).send({
        from: orchestrator,
      });
    });
    const consumer = consumerDeployReceipt.contract;

    await runRetriedStep("companySponsor.initialize_issuer", async () => {
      return await companySponsor.methods.initialize_issuer(issuer.address).send({ from: orchestrator });
    });
    await runRetriedStep("issuer.add_company_sponsor_gateway", async () => {
      return await issuer.methods.add_company_sponsor_gateway(companySponsor.address).send({ from: orchestrator });
    });
    await runRetriedStep("companySponsor.initialize_rights_registry", async () => {
      return await companySponsor.methods.initialize_rights_registry(rightsRegistry.address).send({
        from: orchestrator,
      });
    });
    await runRetriedStep("issuer.add_consumer_gateway", async () => {
      return await issuer.methods.add_consumer_gateway(consumer.address).send({ from: orchestrator });
    });
    await warpForwardSeconds({
      l1RpcUrls,
      l1Mnemonic,
      label: "issuer.add_consumer_gateway activation",
      seconds: MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS,
      wallet,
    });
    await mineTwoL2BlocksForBridgeIngestion(
      l2PaymentToken,
      orchestrator,
      "consumer gateway activation",
    );
    await runRetriedStep("mint L2 payment token to orchestrator", async () => {
      return await l2PaymentToken.methods
        .mint_to_public(orchestrator, DEFAULT_L2_STABLE_MINT_AMOUNT)
        .send({ from: orchestrator });
    });

    const rightsTopUp = await topUpRightsFromL2Payment({
      wallet,
      orchestrator,
      l2PaymentToken,
      l2RightsPurchase,
      l2Treasury: orchestrator,
      simulateFrom: orchestrator,
      sponsor: companySponsor.address,
      rightsAmount: initialSponsorRights,
      packageId: 0n,
      pricePerVerify: DEFAULT_L2_PRICE_PER_VERIFY,
    });

    let sponsorFeeJuiceClaimTxHash;
    const sponsorFeeJuiceBefore = await getFeeJuiceBalance(companySponsor.address, node);
    if (sponsorFeeJuiceBefore === 0n) {
      const sponsorFundingClaim = await bridgeFeeJuiceToAddress(node, l1RpcUrls, l1Mnemonic, companySponsor.address);
      await mineTwoL2BlocksForBridgeIngestion(
        l2PaymentToken,
        orchestrator,
        "sponsor Fee Juice bridge ingestion",
      );
      const sponsorFunding = await claimBridgedFeeJuice(
        node,
        wallet,
        orchestrator,
        companySponsor.address,
        sponsorFundingClaim,
        feeJuiceWitnessWaitMs,
        feeJuiceWitnessPollMs,
      );
      sponsorFeeJuiceClaimTxHash = sponsorFunding.claimTxHash;
    }

    const txHashes = {
      deployIssuer:
        issuerDeployReceipt.receipt?.txHash?.toString?.() ?? issuerDeployReceipt.txHash?.toString?.() ?? "",
      deployCompanySponsor:
        companySponsorDeployReceipt.receipt?.txHash?.toString?.() ??
        companySponsorDeployReceipt.txHash?.toString?.() ??
        "",
      deployConsumer:
        consumerDeployReceipt.receipt?.txHash?.toString?.() ?? consumerDeployReceipt.txHash?.toString?.() ?? "",
      seedSponsorRights: rightsTopUp.purchaseTxHash,
      ...(sponsorFeeJuiceClaimTxHash ? { sponsorFeeJuiceClaim: sponsorFeeJuiceClaimTxHash } : {}),
    };

    updateManifestWithWebBootstrap(manifestPath, {
      orchestratorAddress: orchestrator.toString(),
      issuerAddress: issuer.address.toString(),
      companySponsorAddress: companySponsor.address.toString(),
      consumerAddress: consumer.address.toString(),
      txHashes,
    });

    runNodeScript(
      resolve(repoRoot, "apps/magna-web/scripts/fill-env-from-local-deploy.mjs"),
      [
        "--network-name",
        networkName,
        "--manifest",
        manifestPath,
        "--out",
        envOutPath,
        "--issuer-address",
        issuer.address.toString(),
        "--company-sponsor-address",
        companySponsor.address.toString(),
        "--company-sponsor-addresses",
        companySponsor.address.toString(),
        "--active-company-sponsor-address",
        companySponsor.address.toString(),
        "--orchestrator-address",
        orchestrator.toString(),
      ],
      "write apps/magna-web env from deployed web stack",
    );

    console.info("[web-bootstrap] completed");
    console.info(
      JSON.stringify(
        {
          manifestPath,
          envOutPath,
          orchestratorAddress: orchestrator.toString(),
          issuerAddress: issuer.address.toString(),
          companySponsorAddress: companySponsor.address.toString(),
          consumerAddress: consumer.address.toString(),
          rightsRegistryAddress: rightsRegistry.address.toString(),
          purchaseAdapterAddress: l2RightsPurchase.address.toString(),
          paymentTokenAddress: l2PaymentToken.address.toString(),
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
  console.error(`[web-bootstrap] ${errorDetails(error)}`);
  process.exit(1);
});
