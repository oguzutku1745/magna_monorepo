#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses";
import { loadContractArtifact } from "@aztec/aztec.js/abi";
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization";
import { Contract, DeployMethod } from "@aztec/aztec.js/contracts";
import { Fq, Fr } from "@aztec/aztec.js/fields";
import { PublicKeys } from "@aztec/aztec.js/keys";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { deployL1Contract } from "@aztec/ethereum/deploy-l1-contract";
import { createLogger } from "@aztec/foundation/log";
import { retryUntil } from "@aztec/foundation/retry";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { getNonNullifiedL1ToL2MessageWitness } from "@aztec/stdlib/messaging";
import { computeSecretHash } from "@aztec/stdlib/hash";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { pad, parseAbiItem } from "viem";

import rightsRegistryArtifactJson from "../contracts/magna-company-rights-registry/target/magna_company_rights_registry-MagnaCompanyRightsRegistry.json" with { type: "json" };
import rightsPurchaseArtifactJson from "../contracts/magna-rights-purchase-l2/target/magna_rights_purchase_l2-MagnaRightsPurchaseL2.json" with { type: "json" };

const PINNED_AZTEC_VERSION = process.env.AZTEC_VERSION_PIN ?? "5.0.0-rc.1";
const DEFAULT_PRICE_PER_VERIFY = 150_000n;
const DEFAULT_L1_TOKEN_DECIMALS = 6;
const DEFAULT_REPORTS_DIR = "reports";
const DEFAULT_DEPLOYMENTS_DIR = "deployments";
const DEFAULT_WAIT_FOR_NODE_MS = 120_000;
const DEFAULT_L1_MESSAGE_WAIT_MS = 300_000;
const DEFAULT_L1_MESSAGE_POLL_MS = 10_000;
const DEFAULT_RIGHTS_AMOUNT = 1n;
const DEFAULT_L2_SMOKE_MINT_AMOUNT = 1_000_000n;
const PORTAL_EVENT_ABI = parseAbiItem(
  "event RightsPurchased(uint256 indexed purchaseId, bytes32 indexed sponsorAddressOnAztec, uint128 rightsAmount, bytes32 packageId, bytes32 creditNonce, bytes32 contentHash, bytes32 secretHash, bytes32 messageKey, uint256 messageLeafIndex, uint256 paymentAmount, address payer)",
);
const INBOX_MESSAGE_SENT_ABI = parseAbiItem(
  "event MessageSent(uint256 indexed checkpointNumber, uint256 index, bytes32 indexed hash, bytes16 rollingHash)",
);
const ERC20_DECIMALS_ABI = [
  {
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];
const AZTEC_REGISTRY_ABI = [
  {
    inputs: [],
    name: "getCanonicalRollup",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
];
const AZTEC_ROLLUP_ABI = [
  {
    inputs: [],
    name: "getInbox",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getVersion",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
];

const rightsRegistryArtifact = loadContractArtifact(rightsRegistryArtifactJson);
const rightsPurchaseArtifact = loadContractArtifact(rightsPurchaseArtifactJson);

function makeBinding(artifact) {
  return {
    artifact,
    at(address, wallet) {
      return Contract.at(address, artifact, wallet);
    },
    deploy(wallet, ...args) {
      return new DeployMethod(
        PublicKeys.default(),
        wallet,
        artifact,
        (instance, innerWallet) => Contract.at(instance.address, artifact, innerWallet),
        args,
      );
    },
  };
}

const MagnaCompanyRightsRegistry = makeBinding(rightsRegistryArtifact);
const MagnaRightsPurchaseL2 = makeBinding(rightsPurchaseArtifact);

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
    const [rawKey, rawInline] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    if (rawInline !== undefined) {
      args[key] = rawInline;
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
  node ./scripts/magna-testnet-validate.mjs <mode> [options]

Modes:
  preflight   Check endpoints, versions, balances, and resolved Aztec L1 addresses.
  deploy      Deploy Magna portal + rights registry + L2 purchase adapter and write a manifest.
  validate    Validate live deployment invariants against a manifest.
  smoke-l1    Run the L1 portal purchase -> L2 rights claim smoke.
  smoke-l2    Run the L2 authwit payment -> registry credit smoke.
  smoke-full  Run both smoke paths and consume one right after each if sponsor==admin.

Common options:
  --network-name <name>
  --aztec-node-url <url>
  --l1-rpc-url <url>
  --manifest <path>
  --report <path>
  --wallet-ephemeral <true|false>               Default false

L1 signer options:
  --l1-private-key <hex>
  --l1-mnemonic <mnemonic>

Aztec admin account options:
  --aztec-admin-secret <hex field>
  --aztec-admin-salt <hex field>
  --aztec-admin-signing-key <hex 32 bytes>
  --aztec-admin-alias <label>
  --aztec-admin-address <expected address>

Deployment options:
  --treasury <address>
  --l1-payment-token-address <address>
  --l1-payment-token-decimals <number>
  --l2-payment-token-address <aztec address>   Optional existing L2 token
  --price-per-verify <base units>              Default 150000

Smoke options:
  --smoke-sponsor-address <aztec address>      Defaults to aztec admin address
  --smoke-sponsor-addresses <csv addresses>    Defaults to smoke.sponsorAddresses[0] or smoke.sponsorAddress
  --smoke-rights-amount <integer>              Default 1
  --smoke-package-id <integer or 0x...>
`;
}

function normalizeHex(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.startsWith("0x") ? value : `0x${value}`;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function parseNumber(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite integer`);
  }
  return parsed;
}

function parseBigIntInput(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return BigInt(String(value));
  } catch {
    throw new Error(`${label} must be a bigint-compatible integer`);
  }
}

function parseAddressList(value) {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function parseField(value, label) {
  try {
    return Fr.fromHexString(normalizeHex(value, label));
  } catch {
    throw new Error(`${label} must be a valid field hex string`);
  }
}

function parseFq(value, label) {
  try {
    return Fq.fromHexString(normalizeHex(value, label));
  } catch {
    throw new Error(`${label} must be a valid Fq hex string`);
  }
}

function parseOptionalField(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return parseField(value, "field");
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

function toPrintable(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toPrintable);
  if (typeof value.toString === "function") {
    const printed = value.toString();
    if (printed && printed !== "[object Object]") return printed;
  }
  const result = {};
  for (const [key, inner] of Object.entries(value)) {
    result[key] = toPrintable(inner);
  }
  return result;
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
  throw new Error(`Cannot convert value to bigint: ${String(unwrapped)}`);
}

function getTxReceipt(result) {
  if (result && typeof result === "object" && "receipt" in result) {
    return result.receipt;
  }
  return result;
}

function txHashToString(result) {
  const receipt = getTxReceipt(result);
  const txHash = receipt?.txHash;
  if (typeof txHash === "string") return txHash;
  if (txHash && typeof txHash.toString === "function") return txHash.toString();
  return JSON.stringify(toPrintable(txHash));
}

class Reporter {
  constructor(mode, networkName, reportPath) {
    this.data = {
      mode,
      network: networkName,
      startedAt: new Date().toISOString(),
      steps: [],
      status: "running",
    };
    this.reportPath = reportPath;
  }

  info(name, details) {
    this.data.steps.push({ status: "info", name, details: toPrintable(details) });
  }

  pass(name, details) {
    this.data.steps.push({ status: "passed", name, details: toPrintable(details) });
  }

  fail(name, error, details) {
    this.data.steps.push({
      status: "failed",
      name,
      error: errorDetails(error),
      details: toPrintable(details),
    });
  }

  write(status, extra = {}) {
    this.data.status = status;
    this.data.finishedAt = new Date().toISOString();
    this.data = { ...this.data, ...toPrintable(extra) };
    const parent = dirname(this.reportPath);
    mkdirSync(parent, { recursive: true });
    writeFileSync(this.reportPath, `${JSON.stringify(this.data, null, 2)}\n`);
  }
}

function buildConfig(cli) {
  const mode = cli.mode ?? cli._[0];
  if (!mode || cli.help || cli.h) {
    console.info(usage());
    process.exit(cli.help || cli.h ? 0 : 1);
  }

  const networkName = cli.networkName ?? process.env.MAGNA_NETWORK_NAME;
  if (!networkName) {
    throw new Error("--network-name is required");
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const manifestPath = resolve(
    repoRoot,
    cli.manifest ?? process.env.MAGNA_MANIFEST_PATH ?? `${DEFAULT_DEPLOYMENTS_DIR}/${networkName}.json`,
  );
  const reportTimestamp = new Date().toISOString().replaceAll(":", "-");
  const reportPath = resolve(
    repoRoot,
    cli.report ?? process.env.MAGNA_REPORT_PATH ?? `${DEFAULT_REPORTS_DIR}/${networkName}-${mode}-${reportTimestamp}.json`,
  );

  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : undefined;
  const l1RpcUrl = cli.l1RpcUrl ?? process.env.L1_RPC_URL ?? manifest?.endpoints?.l1RpcUrl;
  const aztecNodeUrl = cli.aztecNodeUrl ?? process.env.AZTEC_NODE_URL ?? manifest?.endpoints?.aztecNodeUrl;
  const l1PrivateKey = cli.l1PrivateKey ?? process.env.DEPLOYER_PRIVATE_KEY ?? process.env.L1_PRIVATE_KEY;
  const l1Mnemonic = cli.l1Mnemonic ?? process.env.L1_MNEMONIC ?? process.env.MNEMONIC;
  const treasury =
    cli.treasury ?? process.env.TREASURY_ADDRESS ?? manifest?.l2?.treasuryAddress ?? manifest?.l1?.treasuryAddress;
  const l1PaymentTokenAddress =
    cli.l1PaymentTokenAddress ?? process.env.L1_PAYMENT_TOKEN_ADDRESS ?? manifest?.l1?.paymentTokenAddress;
  const l2PaymentTokenAddress =
    cli.l2PaymentTokenAddress ?? process.env.L2_PAYMENT_TOKEN_ADDRESS ?? manifest?.l2?.paymentTokenAddress;
  const l1PaymentTokenDecimals = parseNumber(
    cli.l1PaymentTokenDecimals ?? process.env.L1_PAYMENT_TOKEN_DECIMALS ?? manifest?.config?.l1PaymentTokenDecimals,
    DEFAULT_L1_TOKEN_DECIMALS,
    "l1 payment token decimals",
  );
  const pricePerVerify = parseBigIntInput(
    cli.pricePerVerify ?? process.env.PRICE_PER_VERIFY ?? manifest?.config?.pricePerVerify,
    DEFAULT_PRICE_PER_VERIFY,
    "price per verify",
  );
  const aztecAdminSecret =
    cli.aztecAdminSecret ?? process.env.AZTEC_ADMIN_SECRET ?? process.env.MAGNA_AZTEC_ADMIN_SECRET;
  const aztecAdminSalt =
    cli.aztecAdminSalt ?? process.env.AZTEC_ADMIN_SALT ?? process.env.MAGNA_AZTEC_ADMIN_SALT;
  const aztecAdminSigningKey =
    cli.aztecAdminSigningKey ??
    process.env.AZTEC_ADMIN_SIGNING_KEY ??
    process.env.MAGNA_AZTEC_ADMIN_SIGNING_KEY;
  const aztecAdminAlias = cli.aztecAdminAlias ?? process.env.AZTEC_ADMIN_ALIAS ?? "magna-testnet-admin";
  const aztecAdminAddress =
    cli.aztecAdminAddress ?? process.env.AZTEC_ADMIN_ADDRESS ?? manifest?.l2?.adminAddress;
  const smokeSponsorAddresses =
    parseAddressList(
      cli.smokeSponsorAddresses ??
        process.env.MAGNA_SMOKE_SPONSOR_ADDRESSES ??
        (Array.isArray(manifest?.smoke?.sponsorAddresses)
          ? manifest.smoke.sponsorAddresses.join(",")
          : undefined),
    );
  const smokeSponsorAddress =
    cli.smokeSponsorAddress ??
    process.env.MAGNA_SMOKE_SPONSOR_ADDRESS ??
    smokeSponsorAddresses[0] ??
    manifest?.smoke?.sponsorAddress;
  const smokeRightsAmount = parseBigIntInput(
    cli.smokeRightsAmount ?? process.env.MAGNA_SMOKE_RIGHTS_AMOUNT,
    DEFAULT_RIGHTS_AMOUNT,
    "smoke rights amount",
  );
  const smokePackageId = cli.smokePackageId ?? process.env.MAGNA_SMOKE_PACKAGE_ID ?? manifest?.smoke?.packageIdDefault;
  const walletEphemeral = parseBoolean(cli.walletEphemeral ?? process.env.MAGNA_WALLET_EPHEMERAL);

  return {
    mode,
    repoRoot,
    networkName,
    manifestPath,
    reportPath,
    manifest,
    l1RpcUrl,
    aztecNodeUrl,
    l1Signer: l1PrivateKey ?? l1Mnemonic,
    treasury,
    l1PaymentTokenAddress,
    l2PaymentTokenAddress,
    l1PaymentTokenDecimals,
    pricePerVerify,
    aztecAdminSecret,
    aztecAdminSalt,
    aztecAdminSigningKey,
    aztecAdminAlias,
    aztecAdminAddress,
    smokeSponsorAddress,
    smokeSponsorAddresses,
    smokeRightsAmount,
    smokePackageId,
    walletEphemeral,
    waitForNodeMs: parseNumber(cli.waitForNodeMs ?? process.env.MAGNA_WAIT_FOR_NODE_MS, DEFAULT_WAIT_FOR_NODE_MS, "wait ms"),
    l1MessageWaitMs: parseNumber(
      cli.l1MessageWaitMs ?? process.env.MAGNA_L1_MESSAGE_WAIT_MS,
      DEFAULT_L1_MESSAGE_WAIT_MS,
      "l1 message wait ms",
    ),
    l1MessagePollMs: parseNumber(
      cli.l1MessagePollMs ?? process.env.MAGNA_L1_MESSAGE_POLL_MS,
      DEFAULT_L1_MESSAGE_POLL_MS,
      "l1 message poll ms",
    ),
    deployL2Token: !(cli.l2PaymentTokenAddress ?? process.env.L2_PAYMENT_TOKEN_ADDRESS ?? manifest?.l2?.paymentTokenAddress),
    consumeAfterSmoke: parseBoolean(cli.consumeAfterSmoke ?? process.env.MAGNA_CONSUME_AFTER_SMOKE),
  };
}

function requireValue(value, message) {
  if (value === undefined || value === null || value === "") {
    throw new Error(message);
  }
  return value;
}

function requireModeInputs(config) {
  requireValue(config.l1RpcUrl, "Missing --l1-rpc-url");
  requireValue(config.aztecNodeUrl, "Missing --aztec-node-url");
  requireValue(config.l1Signer, "Missing --l1-private-key or --l1-mnemonic");
  requireValue(config.aztecAdminSecret, "Missing --aztec-admin-secret");
  requireValue(config.aztecAdminSalt, "Missing --aztec-admin-salt");
  requireValue(config.aztecAdminSigningKey, "Missing --aztec-admin-signing-key");

  if (config.mode === "deploy" || config.mode === "preflight") {
    requireValue(config.treasury, "Missing --treasury");
    requireValue(config.l1PaymentTokenAddress, "Missing --l1-payment-token-address");
  }

  if (config.mode === "validate" || config.mode.startsWith("smoke")) {
    if (!config.manifest && !existsSync(config.manifestPath)) {
      throw new Error(`Missing manifest at ${config.manifestPath}`);
    }
  }
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

async function createAdminWallet(config, reporter) {
  const node = createAztecNodeClient(config.aztecNodeUrl);
  await waitForNode(node, config.waitForNodeMs);
  reporter.pass("aztec node ready", { nodeUrl: config.aztecNodeUrl });

  const wallet = await EmbeddedWallet.create(node, {
    // PXE stores local synced/private state; local-network bootstrap should opt into
    // ephemeral storage after node restarts to avoid stale world-state anchors.
    ephemeral: config.walletEphemeral,
    pxeConfig: { proverEnabled: false },
  });
  const accountManager = await wallet.createSchnorrAccount(
    parseField(config.aztecAdminSecret, "aztec admin secret"),
    parseField(config.aztecAdminSalt, "aztec admin salt"),
    parseFq(config.aztecAdminSigningKey, "aztec admin signing key"),
    config.aztecAdminAlias,
  );
  await wallet.registerSender(accountManager.address, config.aztecAdminAlias);

  if (config.aztecAdminAddress && accountManager.address.toString().toLowerCase() !== config.aztecAdminAddress.toLowerCase()) {
    throw new Error(
      `Configured Aztec admin address mismatch. expected=${config.aztecAdminAddress} actual=${accountManager.address.toString()}`,
    );
  }

  return { node, wallet, adminAddress: accountManager.address, accountManager };
}

async function buildRuntime(config, reporter) {
  const { node, wallet, adminAddress } = await createAdminWallet(config, reporter);
  const l1Client = createExtendedL1Client([config.l1RpcUrl], config.l1Signer);
  const nodeInfo = await node.getNodeInfo();
  const registryAddress = nodeInfo.l1ContractAddresses.registryAddress.toString();
  const resolvedRollupAddress = await l1Client.readContract({
    address: registryAddress,
    abi: AZTEC_REGISTRY_ABI,
    functionName: "getCanonicalRollup",
  });
  const resolvedInboxAddress = await l1Client.readContract({
    address: resolvedRollupAddress,
    abi: AZTEC_ROLLUP_ABI,
    functionName: "getInbox",
  });
  const resolvedRollupVersion = await l1Client.readContract({
    address: resolvedRollupAddress,
    abi: AZTEC_ROLLUP_ABI,
    functionName: "getVersion",
  });

  return {
    node,
    wallet,
    adminAddress,
    l1Client,
    nodeInfo,
    resolvedAztec: {
      l1ChainId: BigInt(nodeInfo.l1ChainId),
      registryAddress,
      rollupAddress: resolvedRollupAddress,
      inboxAddress: resolvedInboxAddress,
      rollupVersion: BigInt(resolvedRollupVersion),
    },
  };
}

async function validateL2PaymentTokenAddress(runtime, address) {
  const tokenAddress = AztecAddress.fromString(address);
  let metadata;
  if (typeof runtime.wallet.getContractMetadata === "function") {
    try {
      metadata = await runtime.wallet.getContractMetadata(tokenAddress);
    } catch {
      metadata = undefined;
    }
  }

  try {
    const token = TokenContract.at(tokenAddress, runtime.wallet);
    await token.methods.balance_of_public(runtime.adminAddress).simulate({ from: runtime.adminAddress });
    return {
      ok: true,
      metadata,
    };
  } catch (error) {
    return {
      ok: false,
      metadata,
      error,
    };
  }
}

async function runPreflight(config, reporter, runtime) {
  const l1Balance = await runtime.l1Client.getBalance({
    address: runtime.l1Client.account.address,
  });
  if (l1Balance <= 0n) {
    throw new Error("L1 deployer has zero native gas balance");
  }
  reporter.pass("l1 deployer gas balance", {
    address: runtime.l1Client.account.address,
    balance: l1Balance,
  });

  const tokenDecimals = await runtime.l1Client.readContract({
    address: config.l1PaymentTokenAddress,
    abi: ERC20_DECIMALS_ABI,
    functionName: "decimals",
  });
  if (Number(tokenDecimals) !== config.l1PaymentTokenDecimals) {
    throw new Error(
      `L1 token decimals mismatch. expected=${config.l1PaymentTokenDecimals} actual=${Number(tokenDecimals)}`,
    );
  }
  reporter.pass("l1 payment token decimals", {
    token: config.l1PaymentTokenAddress,
    decimals: Number(tokenDecimals),
  });

  const buyerStableBalance = await runtime.l1Client.readContract({
    address: config.l1PaymentTokenAddress,
    abi: ERC20_DECIMALS_ABI,
    functionName: "balanceOf",
    args: [runtime.l1Client.account.address],
  });
  if (BigInt(buyerStableBalance) < config.pricePerVerify) {
    throw new Error(
      `L1 payment token balance is below one smoke purchase. balance=${buyerStableBalance} required=${config.pricePerVerify}`,
    );
  }
  reporter.pass("l1 smoke buyer stable balance", {
    address: runtime.l1Client.account.address,
    balance: BigInt(buyerStableBalance),
    required: config.pricePerVerify,
  });

  const feeJuiceBalance = await getFeeJuiceBalance(runtime.adminAddress, runtime.node);
  if (feeJuiceBalance <= 0n) {
    throw new Error(
      `Aztec admin address has zero FeeJuice. address=${runtime.adminAddress.toString()}`,
    );
  }
  reporter.pass("aztec admin fee juice balance", {
    address: runtime.adminAddress,
    balance: feeJuiceBalance,
  });

  if (config.pricePerVerify !== DEFAULT_PRICE_PER_VERIFY) {
    throw new Error(
      `Price per verify drift detected. expected=${DEFAULT_PRICE_PER_VERIFY} actual=${config.pricePerVerify}`,
    );
  }
  reporter.pass("price per verify invariant", { pricePerVerify: config.pricePerVerify });

  reporter.pass("resolved aztec l1 contracts", runtime.resolvedAztec);
}

function buildManifest(config, runtime, deployment) {
  return {
    network: config.networkName,
    aztecVersion: PINNED_AZTEC_VERSION,
    endpoints: {
      l1RpcUrl: config.l1RpcUrl,
      aztecNodeUrl: config.aztecNodeUrl,
    },
    config: {
      pricePerVerify: config.pricePerVerify.toString(),
      l1PaymentTokenDecimals: config.l1PaymentTokenDecimals,
    },
    resolvedAztec: {
      registryAddress: runtime.resolvedAztec.registryAddress,
      rollupAddress: runtime.resolvedAztec.rollupAddress,
      inboxAddress: runtime.resolvedAztec.inboxAddress,
      rollupVersion: runtime.resolvedAztec.rollupVersion.toString(),
      l1ChainId: runtime.resolvedAztec.l1ChainId.toString(),
    },
    l1: {
      treasuryAddress: config.treasury,
      paymentTokenAddress: config.l1PaymentTokenAddress,
      portalAddress: deployment.portalAddress,
      txHashes: deployment.l1TxHashes,
    },
    l2: {
      adminAddress: runtime.adminAddress.toString(),
      treasuryAddress: config.treasury,
      rightsRegistryAddress: deployment.rightsRegistryAddress,
      purchaseAdapterAddress: deployment.purchaseAdapterAddress,
      paymentTokenAddress: deployment.l2PaymentTokenAddress,
      paymentTokenDeployedByScript: deployment.l2PaymentTokenDeployedByScript,
      txHashes: deployment.l2TxHashes,
    },
    smoke: {
      sponsorAddress: (config.smokeSponsorAddress ?? runtime.adminAddress.toString()).toString(),
      sponsorAddresses:
        config.smokeSponsorAddresses.length > 0
          ? config.smokeSponsorAddresses
          : [(config.smokeSponsorAddress ?? runtime.adminAddress.toString()).toString()],
      packageIdDefault:
        config.smokePackageId ??
        pad(`0x${DEFAULT_RIGHTS_AMOUNT.toString(16)}`, { size: 32 }),
    },
    timestamps: {
      deployedAt: new Date().toISOString(),
    },
  };
}

function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(toPrintable(manifest), null, 2)}\n`);
}

function readManifest(config) {
  const path = config.manifestPath;
  if (!existsSync(path)) {
    throw new Error(`Manifest not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

async function deployContracts(config, reporter, runtime) {
  const portalArtifact = loadL1Artifact("MagnaRightsPortal.sol", "MagnaRightsPortal");
  const portalDeployment = await deployL1Contract(
    runtime.l1Client,
    portalArtifact.abi,
    portalArtifact.bytecode.object,
    [config.treasury, config.l1PaymentTokenAddress, config.pricePerVerify],
  );
  const portalAddress = portalDeployment.address.toString();
  reporter.pass("deployed l1 portal", { portalAddress });

  const rightsRegistryDeployResult = await MagnaCompanyRightsRegistry.deploy(
    runtime.wallet,
    EthAddress.fromString(portalAddress),
    runtime.adminAddress,
  ).send({
    from: runtime.adminAddress,
  });
  const rightsRegistryAddress = rightsRegistryDeployResult.contract.address.toString();
  reporter.pass("deployed l2 rights registry", {
    rightsRegistryAddress,
    txHash: txHashToString(rightsRegistryDeployResult),
  });

  const initPortalTxHash = await runtime.l1Client.writeContract({
    address: portalAddress,
    abi: portalArtifact.abi,
    functionName: "initialize",
    args: [runtime.resolvedAztec.registryAddress, rightsRegistryAddress],
  });
  await runtime.l1Client.waitForTransactionReceipt({ hash: initPortalTxHash });
  reporter.pass("initialized l1 portal", { txHash: initPortalTxHash });

  let l2PaymentTokenAddress = config.l2PaymentTokenAddress;
  let l2PaymentTokenDeployedByScript = false;
  let l2TokenTxHash;
  if (l2PaymentTokenAddress) {
    const existingTokenValidation = await validateL2PaymentTokenAddress(runtime, l2PaymentTokenAddress);
    if (existingTokenValidation.ok) {
      reporter.pass("using existing l2 payment token", {
        l2PaymentTokenAddress,
        metadata: existingTokenValidation.metadata,
      });
    } else {
      reporter.info("existing l2 payment token address is not usable on current network", {
        l2PaymentTokenAddress,
        error: errorDetails(existingTokenValidation.error),
        metadata: existingTokenValidation.metadata,
      });
      l2PaymentTokenAddress = undefined;
    }
  }

  if (!l2PaymentTokenAddress) {
    const l2TokenDeployResult = await TokenContract.deploy(
      runtime.wallet,
      runtime.adminAddress,
      "Magna USD",
      "mUSD",
      6,
    ).send({
      from: runtime.adminAddress,
    });
    l2PaymentTokenAddress = l2TokenDeployResult.contract.address.toString();
    l2PaymentTokenDeployedByScript = true;
    l2TokenTxHash = txHashToString(l2TokenDeployResult);
    reporter.pass("deployed l2 payment token", {
      l2PaymentTokenAddress,
      txHash: l2TokenTxHash,
    });
  }

  const rightsPurchaseDeployResult = await MagnaRightsPurchaseL2.deploy(
    runtime.wallet,
    runtime.adminAddress,
    runtime.adminAddress,
    AztecAddress.fromString(l2PaymentTokenAddress),
    AztecAddress.fromString(rightsRegistryAddress),
    config.pricePerVerify,
  ).send({
    from: runtime.adminAddress,
  });
  const purchaseAdapterAddress = rightsPurchaseDeployResult.contract.address.toString();
  reporter.pass("deployed l2 rights purchase adapter", {
    purchaseAdapterAddress,
    txHash: txHashToString(rightsPurchaseDeployResult),
  });

  const rightsRegistry = MagnaCompanyRightsRegistry.at(
    AztecAddress.fromString(rightsRegistryAddress),
    runtime.wallet,
  );
  const initAdapterResult = await rightsRegistry.methods
    .initialize_l2_purchase_adapter(AztecAddress.fromString(purchaseAdapterAddress))
    .send({ from: runtime.adminAddress });
  reporter.pass("initialized l2 purchase adapter", {
    txHash: txHashToString(initAdapterResult),
  });

  return {
    portalAddress,
    rightsRegistryAddress,
    purchaseAdapterAddress,
    l2PaymentTokenAddress,
    l2PaymentTokenDeployedByScript,
    l1TxHashes: {
      deployPortal: portalDeployment.transactionHash?.toString?.() ?? undefined,
      initializePortal: initPortalTxHash,
    },
    l2TxHashes: {
      deployRightsRegistry: txHashToString(rightsRegistryDeployResult),
      deployPaymentToken: l2TokenTxHash,
      deployPurchaseAdapter: txHashToString(rightsPurchaseDeployResult),
      initializePurchaseAdapter: txHashToString(initAdapterResult),
    },
  };
}

async function bindManifestContracts(manifest, runtime) {
  const rightsRegistry = MagnaCompanyRightsRegistry.at(
    AztecAddress.fromString(manifest.l2.rightsRegistryAddress),
    runtime.wallet,
  );
  const rightsPurchase = MagnaRightsPurchaseL2.at(
    AztecAddress.fromString(manifest.l2.purchaseAdapterAddress),
    runtime.wallet,
  );
  const l2PaymentToken = TokenContract.at(AztecAddress.fromString(manifest.l2.paymentTokenAddress), runtime.wallet);
  return { rightsRegistry, rightsPurchase, l2PaymentToken };
}

async function validateManifest(config, reporter, runtime, manifest) {
  const portalArtifact = loadL1Artifact("MagnaRightsPortal.sol", "MagnaRightsPortal");
  const { rightsRegistry, rightsPurchase, l2PaymentToken } = await bindManifestContracts(manifest, runtime);

  const l1TokenDecimals = await runtime.l1Client.readContract({
    address: manifest.l1.paymentTokenAddress,
    abi: ERC20_DECIMALS_ABI,
    functionName: "decimals",
  });
  if (Number(l1TokenDecimals) !== Number(manifest.config.l1PaymentTokenDecimals)) {
    throw new Error(
      `L1 payment token decimals mismatch. expected=${manifest.config.l1PaymentTokenDecimals} actual=${Number(l1TokenDecimals)}`,
    );
  }
  reporter.pass("validated l1 token decimals", {
    token: manifest.l1.paymentTokenAddress,
    decimals: Number(l1TokenDecimals),
  });

  const portalOwner = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "owner",
  });
  const portalTreasury = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "treasury",
  });
  const portalPaymentAsset = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "paymentAsset",
  });
  const portalPrice = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "pricePerVerify",
  });
  const portalInitialized = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "initialized",
  });
  const portalRegistry = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "registry",
  });
  const portalInbox = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "inbox",
  });
  const portalRollupVersion = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "rollupVersion",
  });
  const portalL2Registry = await runtime.l1Client.readContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "l2RightsRegistry",
  });

  if (!portalInitialized) throw new Error("Portal is not initialized");
  if (portalTreasury.toLowerCase() !== manifest.l1.treasuryAddress.toLowerCase()) throw new Error("Portal treasury mismatch");
  if (portalPaymentAsset.toLowerCase() !== manifest.l1.paymentTokenAddress.toLowerCase()) {
    throw new Error("Portal payment asset mismatch");
  }
  if (BigInt(portalPrice) !== BigInt(manifest.config.pricePerVerify)) throw new Error("Portal price mismatch");
  if (portalRegistry.toLowerCase() !== manifest.resolvedAztec.registryAddress.toLowerCase()) {
    throw new Error("Portal registry mismatch");
  }
  if (portalInbox.toLowerCase() !== manifest.resolvedAztec.inboxAddress.toLowerCase()) {
    throw new Error("Portal inbox mismatch");
  }
  if (BigInt(portalRollupVersion) !== BigInt(manifest.resolvedAztec.rollupVersion)) {
    throw new Error("Portal rollup version mismatch");
  }
  if (portalL2Registry.toLowerCase() !== manifest.l2.rightsRegistryAddress.toLowerCase()) {
    throw new Error("Portal L2 rights registry mismatch");
  }
  reporter.pass("validated l1 portal invariants", {
    owner: portalOwner,
    treasury: portalTreasury,
    paymentAsset: portalPaymentAsset,
    registry: portalRegistry,
    inbox: portalInbox,
    rollupVersion: BigInt(portalRollupVersion),
    l2RightsRegistry: portalL2Registry,
  });

  const registryPortal = unwrapStepResult(
    await rightsRegistry.methods.get_portal().simulate({ from: runtime.adminAddress }),
  );
  const registryAdapter = unwrapStepResult(
    await rightsRegistry.methods.get_l2_purchase_adapter().simulate({ from: runtime.adminAddress }),
  );
  if (registryPortal.toString().toLowerCase() !== manifest.l1.portalAddress.toLowerCase()) {
    throw new Error("Rights registry portal binding mismatch");
  }
  if (registryAdapter.toString().toLowerCase() !== manifest.l2.purchaseAdapterAddress.toLowerCase()) {
    throw new Error("Rights registry adapter mismatch");
  }
  reporter.pass("validated l2 rights registry invariants", {
    portal: registryPortal.toString(),
    adapter: registryAdapter.toString(),
  });

  const purchaseAdmin = unwrapStepResult(
    await rightsPurchase.methods.get_admin().simulate({ from: runtime.adminAddress }),
  );
  const purchaseTreasury = unwrapStepResult(
    await rightsPurchase.methods.get_treasury().simulate({ from: runtime.adminAddress }),
  );
  const purchaseToken = unwrapStepResult(
    await rightsPurchase.methods.get_payment_token().simulate({ from: runtime.adminAddress }),
  );
  const purchaseRegistry = unwrapStepResult(
    await rightsPurchase.methods.get_rights_registry().simulate({ from: runtime.adminAddress }),
  );
  const purchasePrice = toBigIntValue(
    await rightsPurchase.methods.get_price_per_verify().simulate({ from: runtime.adminAddress }),
  );
  const nextPurchaseId = toBigIntValue(
    await rightsPurchase.methods.get_next_purchase_id().simulate({ from: runtime.adminAddress }),
  );
  if (purchaseAdmin.toString().toLowerCase() !== manifest.l2.adminAddress.toLowerCase()) {
    throw new Error("L2 purchase admin mismatch");
  }
  if (purchaseTreasury.toString().toLowerCase() !== manifest.l2.adminAddress.toLowerCase()) {
    throw new Error("L2 purchase treasury mismatch");
  }
  if (purchaseToken.toString().toLowerCase() !== manifest.l2.paymentTokenAddress.toLowerCase()) {
    throw new Error("L2 purchase payment token mismatch");
  }
  if (purchaseRegistry.toString().toLowerCase() !== manifest.l2.rightsRegistryAddress.toLowerCase()) {
    throw new Error("L2 purchase rights registry mismatch");
  }
  if (purchasePrice !== BigInt(manifest.config.pricePerVerify)) {
    throw new Error("L2 purchase price mismatch");
  }
  reporter.pass("validated l2 purchase adapter invariants", {
    admin: purchaseAdmin.toString(),
    treasury: purchaseTreasury.toString(),
    paymentToken: purchaseToken.toString(),
    rightsRegistry: purchaseRegistry.toString(),
    pricePerVerify: purchasePrice,
    nextPurchaseId,
  });

  const l2TokenValidation = await validateL2PaymentTokenAddress(runtime, manifest.l2.paymentTokenAddress);
  if (!l2TokenValidation.ok) {
    throw new Error(
      `L2 payment token address is not usable on the current network: ${manifest.l2.paymentTokenAddress}. ` +
        `cause=${errorDetails(l2TokenValidation.error)}`,
    );
  }
  const adminL2TokenBalance = toBigIntValue(
    await l2PaymentToken.methods.balance_of_public(runtime.adminAddress).simulate({ from: runtime.adminAddress }),
  );
  reporter.pass("validated l2 payment token deployment", {
    paymentTokenAddress: manifest.l2.paymentTokenAddress,
    adminBalance: adminL2TokenBalance,
    metadata: l2TokenValidation.metadata,
  });
}

async function waitForCustomMessageWitness(runtime, rightsRegistryAddress, contentHash, secret, expectedLeafIndex, config) {
  const startedAt = Date.now();
  let attempt = 0;
  let lastError = "unknown";

  while (Date.now() - startedAt < config.l1MessageWaitMs) {
    attempt += 1;
    try {
      const [messageIndex] = await getNonNullifiedL1ToL2MessageWitness(
        runtime.node,
        AztecAddress.fromString(rightsRegistryAddress),
        Fr.fromHexString(contentHash),
        secret,
      );
      return { messageIndex, attempt, elapsedMs: Date.now() - startedAt, expectedLeafIndex };
    } catch (error) {
      lastError = errorDetails(error);
      await new Promise(resolve => setTimeout(resolve, config.l1MessagePollMs));
    }
  }

  throw new Error(
    `Timeout awaiting L1->L2 message witness after ${config.l1MessageWaitMs}ms. last_error=${lastError}`,
  );
}

function resolveSmokeSponsorAddress(config, manifest, runtime) {
  return (
    config.smokeSponsorAddress ??
    config.smokeSponsorAddresses[0] ??
    manifest?.smoke?.sponsorAddresses?.[0] ??
    manifest?.smoke?.sponsorAddress ??
    runtime.adminAddress.toString()
  );
}

async function runSmokeL1(config, reporter, runtime, manifest, consumeAfterSmoke = false) {
  const { rightsRegistry } = await bindManifestContracts(manifest, runtime);
  const sponsorAddress = AztecAddress.fromString(resolveSmokeSponsorAddress(config, manifest, runtime));
  const rightsAmount = config.smokeRightsAmount;
  const packageIdField = config.smokePackageId ? new Fr(parseBigIntInput(config.smokePackageId, 0n, "package id")) : Fr.random();
  const extraPolicyHash = `0x${randomBytes(32).toString("hex")}`;
  const secret = Fr.random();
  const secretHash = await computeSecretHash(secret);
  const paymentAmount = rightsAmount * BigInt(manifest.config.pricePerVerify);

  const before = toBigIntValue(
    await rightsRegistry.methods.get_remaining_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  const approveTxHash = await runtime.l1Client.writeContract({
    address: manifest.l1.paymentTokenAddress,
    abi: ERC20_DECIMALS_ABI,
    functionName: "approve",
    args: [manifest.l1.portalAddress, paymentAmount],
  });
  await runtime.l1Client.waitForTransactionReceipt({ hash: approveTxHash });

  const portalArtifact = loadL1Artifact("MagnaRightsPortal.sol", "MagnaRightsPortal");
  const purchaseTxHash = await runtime.l1Client.writeContract({
    address: manifest.l1.portalAddress,
    abi: portalArtifact.abi,
    functionName: "purchaseRights",
    args: [
      sponsorAddress.toString(),
      rightsAmount,
      pad(secretHash.toString(), { size: 32 }),
      pad(packageIdField.toString(), { size: 32 }),
      extraPolicyHash,
    ],
  });
  const purchaseReceipt = await runtime.l1Client.waitForTransactionReceipt({ hash: purchaseTxHash });

  const purchasedLogs = await runtime.l1Client.getLogs({
    address: manifest.l1.portalAddress,
    event: PORTAL_EVENT_ABI,
    fromBlock: purchaseReceipt.blockNumber,
    toBlock: purchaseReceipt.blockNumber,
  });
  if (purchasedLogs.length < 1) {
    throw new Error("Portal purchase event not found");
  }
  const purchased = purchasedLogs[0];
  const inboxLogs = await runtime.l1Client.getLogs({
    address: manifest.resolvedAztec.inboxAddress,
    event: INBOX_MESSAGE_SENT_ABI,
    fromBlock: purchaseReceipt.blockNumber,
    toBlock: purchaseReceipt.blockNumber,
  });
  if (inboxLogs.length < 1) {
    throw new Error("Inbox MessageSent event not found");
  }

  const creditNonce = purchased.args.creditNonce;
  const contentHash = purchased.args.contentHash;
  const messageLeafIndex = inboxLogs[0].args.index;
  const witness = await waitForCustomMessageWitness(
    runtime,
    manifest.l2.rightsRegistryAddress,
    contentHash,
    secret,
    messageLeafIndex,
    config,
  );
  reporter.pass("l1 smoke witness ready", witness);

  const claimReceipt = await rightsRegistry.methods
    .claim_l1_credit(
      sponsorAddress,
      rightsAmount,
      packageIdField,
      Fr.fromHexString(creditNonce),
      secret,
      messageLeafIndex,
    )
    .send({ from: runtime.adminAddress });

  const after = toBigIntValue(
    await rightsRegistry.methods.get_remaining_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  if (after !== before + rightsAmount) {
    throw new Error(`L1 smoke rights balance mismatch. before=${before} after=${after} amount=${rightsAmount}`);
  }

  await rightsRegistry.methods
    .claim_l1_credit(
      sponsorAddress,
      rightsAmount,
      packageIdField,
      Fr.fromHexString(creditNonce),
      secret,
      messageLeafIndex,
    )
    .send({ from: runtime.adminAddress })
    .then(() => {
      throw new Error("Replay claim unexpectedly succeeded");
    })
    .catch(() => undefined);

  reporter.pass("l1 smoke purchase and claim", {
    approveTxHash,
    purchaseTxHash,
    claimTxHash: txHashToString(claimReceipt),
    sponsorAddress,
    rightsAmount,
    before,
    after,
    creditNonce,
    contentHash,
    messageLeafIndex,
  });

  if (consumeAfterSmoke) {
    await consumeOneRight(runtime, rightsRegistry, sponsorAddress, reporter, "l1 smoke consume");
  }
}

async function ensureL2PaymentBalance(config, reporter, runtime, manifest, l2PaymentToken, amountNeeded) {
  const currentBalance = toBigIntValue(
    await l2PaymentToken.methods.balance_of_public(runtime.adminAddress).simulate({ from: runtime.adminAddress }),
  );
  if (currentBalance >= amountNeeded) {
    return currentBalance;
  }

  if (!manifest.l2.paymentTokenDeployedByScript) {
    throw new Error(
      `L2 payer balance is below required smoke amount and token is not script-managed. current=${currentBalance} required=${amountNeeded}`,
    );
  }

  const mintAmount = amountNeeded > DEFAULT_L2_SMOKE_MINT_AMOUNT ? amountNeeded : DEFAULT_L2_SMOKE_MINT_AMOUNT;
  const mintReceipt = await l2PaymentToken.methods
    .mint_to_public(runtime.adminAddress, mintAmount)
    .send({ from: runtime.adminAddress });
  const afterMint = toBigIntValue(
    await l2PaymentToken.methods.balance_of_public(runtime.adminAddress).simulate({ from: runtime.adminAddress }),
  );
  reporter.pass("minted l2 smoke payment balance", {
    mintTxHash: txHashToString(mintReceipt),
    mintAmount,
    balanceAfterMint: afterMint,
  });
  return afterMint;
}

async function consumeOneRight(runtime, rightsRegistry, sponsorAddress, reporter, label) {
  const beforeRemaining = toBigIntValue(
    await rightsRegistry.methods.get_remaining_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  const beforeConsumed = toBigIntValue(
    await rightsRegistry.methods.get_consumed_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  const consumeReceipt = await rightsRegistry.methods.consume_right(1n).send({ from: sponsorAddress });
  const afterRemaining = toBigIntValue(
    await rightsRegistry.methods.get_remaining_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  const afterConsumed = toBigIntValue(
    await rightsRegistry.methods.get_consumed_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  if (afterRemaining !== beforeRemaining - 1n || afterConsumed !== beforeConsumed + 1n) {
    throw new Error(`${label} invariants failed`);
  }
  reporter.pass(label, {
    consumeTxHash: txHashToString(consumeReceipt),
    beforeRemaining,
    afterRemaining,
    beforeConsumed,
    afterConsumed,
  });
}

async function runSmokeL2(config, reporter, runtime, manifest, consumeAfterSmoke = false) {
  const { rightsRegistry, rightsPurchase, l2PaymentToken } = await bindManifestContracts(manifest, runtime);
  const sponsorAddress = AztecAddress.fromString(resolveSmokeSponsorAddress(config, manifest, runtime));
  const rightsAmount = config.smokeRightsAmount;
  const packageId = config.smokePackageId ? parseBigIntInput(config.smokePackageId, 0n, "package id") : Fr.random().toBigInt();
  const authwitNonce = Fr.random();
  const paymentAmount = rightsAmount * BigInt(manifest.config.pricePerVerify);

  await ensureL2PaymentBalance(config, reporter, runtime, manifest, l2PaymentToken, paymentAmount);

  const payerBalanceBefore = toBigIntValue(
    await l2PaymentToken.methods.balance_of_public(runtime.adminAddress).simulate({ from: runtime.adminAddress }),
  );
  const treasuryAddress = AztecAddress.fromString(manifest.l2.adminAddress);
  const treasuryBalanceBefore = toBigIntValue(
    await l2PaymentToken.methods.balance_of_public(treasuryAddress).simulate({ from: runtime.adminAddress }),
  );
  const rightsBefore = toBigIntValue(
    await rightsRegistry.methods.get_remaining_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  const nextPurchaseIdBefore = toBigIntValue(
    await rightsPurchase.methods.get_next_purchase_id().simulate({ from: runtime.adminAddress }),
  );

  const action = l2PaymentToken.methods.transfer_in_public(
    runtime.adminAddress,
    treasuryAddress,
    paymentAmount,
    authwitNonce,
  );
  const setAuthwit = await SetPublicAuthwitContractInteraction.create(
    runtime.wallet,
    runtime.adminAddress,
    { caller: rightsPurchase.address, action },
    true,
  );
  const authwitReceipt = await setAuthwit.send();

  const purchaseReceipt = await rightsPurchase.methods
    .purchase_rights_public(sponsorAddress, rightsAmount, packageId, authwitNonce)
    .send({ from: runtime.adminAddress });

  const payerBalanceAfter = toBigIntValue(
    await l2PaymentToken.methods.balance_of_public(runtime.adminAddress).simulate({ from: runtime.adminAddress }),
  );
  const treasuryBalanceAfter = toBigIntValue(
    await l2PaymentToken.methods.balance_of_public(treasuryAddress).simulate({ from: runtime.adminAddress }),
  );
  const rightsAfter = toBigIntValue(
    await rightsRegistry.methods.get_remaining_verifies(sponsorAddress).simulate({ from: runtime.adminAddress }),
  );
  const nextPurchaseIdAfter = toBigIntValue(
    await rightsPurchase.methods.get_next_purchase_id().simulate({ from: runtime.adminAddress }),
  );

  if (payerBalanceAfter !== payerBalanceBefore - paymentAmount) {
    throw new Error("L2 payer balance did not decrease by payment amount");
  }
  if (treasuryBalanceAfter !== treasuryBalanceBefore + paymentAmount) {
    throw new Error("L2 treasury balance did not increase by payment amount");
  }
  if (rightsAfter !== rightsBefore + rightsAmount) {
    throw new Error("L2 rights registry balance did not increase by rights amount");
  }
  if (nextPurchaseIdAfter !== nextPurchaseIdBefore + 1n) {
    throw new Error("L2 purchase id did not increment");
  }

  reporter.pass("l2 smoke authwit purchase and credit", {
    authwitTxHash: txHashToString(authwitReceipt),
    purchaseTxHash: txHashToString(purchaseReceipt),
    sponsorAddress,
    rightsAmount,
    paymentAmount,
    packageId,
    nextPurchaseIdBefore,
    nextPurchaseIdAfter,
    payerBalanceBefore,
    payerBalanceAfter,
    treasuryBalanceBefore,
    treasuryBalanceAfter,
    rightsBefore,
    rightsAfter,
  });

  if (consumeAfterSmoke) {
    await consumeOneRight(runtime, rightsRegistry, sponsorAddress, reporter, "l2 smoke consume");
  }
}

async function main() {
  assertNode24Runtime();
  const cli = parseArgs(process.argv.slice(2));
  const config = buildConfig(cli);
  requireModeInputs(config);

  const reporter = new Reporter(config.mode, config.networkName, config.reportPath);
  let runtime;
  try {
    runtime = await buildRuntime(config, reporter);
    await runPreflight(config, reporter, runtime);

    if (config.mode === "preflight") {
      reporter.write("passed", { config: { network: config.networkName } });
      return;
    }

    if (config.mode === "deploy") {
      const deployment = await deployContracts(config, reporter, runtime);
      const manifest = buildManifest(config, runtime, deployment);
      writeManifest(config.manifestPath, manifest);
      reporter.pass("wrote deployment manifest", { manifestPath: config.manifestPath });
      await validateManifest(config, reporter, runtime, manifest);
      reporter.write("passed", { manifestPath: config.manifestPath, manifest });
      return;
    }

    const manifest = readManifest(config);
    await validateManifest(config, reporter, runtime, manifest);

    if (config.mode === "validate") {
      reporter.write("passed", { manifestPath: config.manifestPath, manifest });
      return;
    }

    if (config.mode === "smoke-l1") {
      await runSmokeL1(config, reporter, runtime, manifest, config.consumeAfterSmoke);
      reporter.write("passed", { manifestPath: config.manifestPath, manifest });
      return;
    }

    if (config.mode === "smoke-l2") {
      await runSmokeL2(config, reporter, runtime, manifest, config.consumeAfterSmoke);
      reporter.write("passed", { manifestPath: config.manifestPath, manifest });
      return;
    }

    if (config.mode === "smoke-full") {
      const sponsorAddress = resolveSmokeSponsorAddress(config, manifest, runtime);
      if (sponsorAddress.toLowerCase() !== runtime.adminAddress.toString().toLowerCase()) {
        throw new Error("smoke-full currently requires smoke sponsor address to equal the Aztec admin address");
      }
      await runSmokeL1(config, reporter, runtime, manifest, true);
      await runSmokeL2(config, reporter, runtime, manifest, true);
      reporter.write("passed", { manifestPath: config.manifestPath, manifest });
      return;
    }

    throw new Error(`Unsupported mode: ${config.mode}`);
  } catch (error) {
    reporter.fail("fatal", error);
    reporter.write("failed", { config: { network: config.networkName } });
    console.error(errorDetails(error));
    process.exit(1);
  } finally {
    try {
      if (runtime?.wallet) {
        await runtime.wallet.stop();
      }
    } catch {
      // best-effort shutdown
    }
  }
}

await main();
