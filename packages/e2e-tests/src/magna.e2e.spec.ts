import { createHash, randomBytes, webcrypto } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { L1FeeJuicePortalManager } from "@aztec/aztec.js/ethereum";
import { SetPublicAuthwitContractInteraction } from "@aztec/aztec.js/authorization";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress, EthAddress } from "@aztec/aztec.js/addresses";
import type { FeePaymentMethod } from "@aztec/aztec.js/fee";
import { Fr } from "@aztec/aztec.js/fields";
import { ProtocolContractAddress } from "@aztec/aztec.js/protocol";
import { ExecutionPayload } from "@aztec/aztec.js/tx";
import { AccountManager } from "@aztec/aztec.js/wallet";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import { createExtendedL1Client } from "@aztec/ethereum/client";
import { deployL1Contract } from "@aztec/ethereum/deploy-l1-contract";
import { EthCheatCodes } from "@aztec/ethereum/test";
import { Ecdsa } from "@aztec/foundation/crypto/ecdsa";
import { retryUntil } from "@aztec/foundation/retry";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync";
import { TestDateProvider } from "@aztec/foundation/timer";
import { siloNullifier } from "@aztec/stdlib/hash";
import { getNonNullifiedL1ToL2MessageWitness } from "@aztec/stdlib/messaging";
import { Gas, GasFees, GasSettings } from "@aztec/stdlib/gas";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { createLogger } from "@aztec/foundation/log";
import { FeeJuiceContract } from "@aztec/noir-contracts.js/FeeJuice";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import {
  MagnaCompanySponsorContract,
  MagnaCompanyRightsRegistryContract,
  MagnaRightsPurchaseL2Contract,
  MagnaConsumerContract,
  MagnaVerifyMeterHookInstantContract,
  MagnaVerifyMeterHookContract,
  MagnaIssuerContract,
} from "@magna/contracts-bindings";
import {
  CredentialType,
  MagnaWebAuthnAccountContract,
  computeInstagramClaimsHash,
  computeInstagramHandleHash,
  normalizeSToLow,
  poseidon2FieldHasher,
  type WebAuthnAsserter,
  type WebAuthnRegistration,
} from "@magna/wallet";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runE2E = process.env.AZTEC_E2E === "1";
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL ?? "http://localhost:8080";
const L1_RPC_URLS = (process.env.ETHEREUM_HOSTS ?? "http://localhost:8545")
  .split(",")
  .map(url => url.trim())
  .filter(Boolean);
const L1_MNEMONIC =
  process.env.MNEMONIC ?? "test test test test test test test test test test test junk";
const AZTEC_WAIT_FOR_NODE_MS = Number.parseInt(process.env.AZTEC_WAIT_FOR_NODE_MS ?? "240000", 10);
const E2E_BEFORE_ALL_TIMEOUT_MS = Number.parseInt(
  process.env.AZTEC_E2E_BEFORE_ALL_TIMEOUT_MS ?? "720000",
  10,
);
const AZTEC_FEE_JUICE_WITNESS_WAIT_MS = Number.parseInt(
  process.env.AZTEC_FEE_JUICE_WITNESS_WAIT_MS ?? "420000",
  10,
);
const AZTEC_FEE_JUICE_WITNESS_POLL_MS = Number.parseInt(
  process.env.AZTEC_FEE_JUICE_WITNESS_POLL_MS ?? "15000",
  10,
);
const AZTEC_PXE_SYNC_AFTER_WARP_ATTEMPTS = Number.parseInt(
  process.env.AZTEC_PXE_SYNC_AFTER_WARP_ATTEMPTS ?? "120",
  10,
);
const TRANSIENT_LOCAL_NETWORK_TX_RETRY_ATTEMPTS = Number.parseInt(
  process.env.AZTEC_TRANSIENT_TX_RETRY_ATTEMPTS ?? "3",
  10,
);
const TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS = Number.parseInt(
  process.env.AZTEC_TRANSIENT_TX_RETRY_BACKOFF_MS ?? "250",
  10,
);
const COMPANY_SPONSOR_MAX_FEE_CAP = 1_000_000_000_000_000n;
const INITIAL_SPONSOR_RIGHTS = 1_000_000n;
const L2_PRICE_PER_VERIFY = 150_000n; // 0.15 units at 6 decimals
const INITIAL_L2_STABLE_SUPPLY = 10_000_000_000_000n;
const L1_STABLE_PRICE_PER_VERIFY = 150_000n; // 0.15 units at 6 decimals
const INITIAL_L1_STABLE_SUPPLY = 1_000_000_000_000n;
const MAGNA_CLAIMS_DS = 0x4d414743;
const MAGNA_REVOCATION_DS = 0x4d415247;
const MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS = 300n;
const MAGNA_SPONSOR_RL_WINDOW_SECONDS = 86_400n;
const MAX_CONSTRAINTS = 8;
const TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS = [
  "Invalid tx: Invalid expiration timestamp",
  "Invalid tx: Block header not found",
  "Tx dropped by P2P node",
] as const;

type HintedCredential = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["verify"]
>[1];
type HintedStatus = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["verify"]
>[2];
type HintedRecovery = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["recover"]
>[0];
type HintedRootStatus = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["verify_linked"]
>[1];
type HintedRootAuthority = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["verify_linked"]
>[2];
type HintedLinkedCredential = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["verify_linked"]
>[3];
type HintedLinkedStatus = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["verify_linked"]
>[4];
type HintedRootRecovery = Parameters<
  (typeof MagnaIssuerContract)["prototype"]["methods"]["recover_root"]
>[0];
type FeeJuiceBridgeClaim = {
  claimAmount: bigint;
  claimSecret: Fr;
  messageHash: string;
  messageLeafIndex: bigint;
};

type L1Artifact = {
  abi: readonly unknown[];
  bytecode: {
    object: `0x${string}`;
  };
};

class CompanySponsorFeePaymentMethod implements FeePaymentMethod {
  constructor(private readonly sponsorGateway: AztecAddress) {}

  getAsset(): Promise<AztecAddress> {
    throw new Error("Asset is not required for sponsor gateway fee payment");
  }

  async getExecutionPayload(): Promise<ExecutionPayload> {
    return new ExecutionPayload([], [], [], [], this.sponsorGateway);
  }

  getFeePayer() {
    return Promise.resolve(this.sponsorGateway);
  }

  getGasSettings(): ReturnType<FeePaymentMethod["getGasSettings"]> {
    return undefined;
  }
}

function buildCompanySponsorFeeOptions(companySponsor: AztecAddress) {
  return {
    paymentMethod: new CompanySponsorFeePaymentMethod(companySponsor),
    estimateGas: true,
    estimatedGasPadding: 0.2,
  };
}

async function warpToNextSponsorRateLimitWindow(
  label: string,
  l2Advance?: {
    l2NudgeToken: TokenContract;
    orchestrator: AztecAddress;
    wallet?: EmbeddedWallet;
  },
): Promise<void> {
  const l1Client = createExtendedL1Client(L1_RPC_URLS, L1_MNEMONIC);
  const currentTimestamp = BigInt((await l1Client.getBlock()).timestamp);
  const nextWindowStart =
    currentTimestamp - (currentTimestamp % MAGNA_SPONSOR_RL_WINDOW_SECONDS) + MAGNA_SPONSOR_RL_WINDOW_SECONDS + 1n;
  const cheatCodes = new EthCheatCodes(
    L1_RPC_URLS,
    new TestDateProvider(),
    createLogger("magna:e2e:time-warp"),
  );
  await cheatCodes.warp(nextWindowStart, { silent: true, resetBlockInterval: true });
  console.info(
    `[e2e] ${label} warped sponsor rate-limit window ` +
      `(from_ts=${currentTimestamp.toString()} to_ts=${nextWindowStart.toString()})`,
  );
  if (l2Advance) {
    await syncWalletPxeAfterWarp(label, l2Advance.wallet);
    await mineTwoL2BlocksForBridgeIngestion(
      l2Advance.l2NudgeToken,
      l2Advance.orchestrator,
      `${label} post-warp L2 advance`,
    );
  }
}

async function warpForwardSeconds(label: string, seconds: bigint, wallet?: EmbeddedWallet): Promise<void> {
  const l1Client = createExtendedL1Client(L1_RPC_URLS, L1_MNEMONIC);
  const currentTimestamp = BigInt((await l1Client.getBlock()).timestamp);
  const targetTimestamp = currentTimestamp + seconds + 1n;
  const cheatCodes = new EthCheatCodes(
    L1_RPC_URLS,
    new TestDateProvider(),
    createLogger("magna:e2e:time-warp"),
  );
  await cheatCodes.warp(targetTimestamp, { silent: true, resetBlockInterval: true });
  console.info(
    `[e2e] ${label} warped time ` +
      `(from_ts=${currentTimestamp.toString()} to_ts=${targetTimestamp.toString()})`,
  );
  await syncWalletPxeAfterWarp(label, wallet);
}

function packAlpha3(alpha3: string): bigint {
  if (!/^[A-Z]{3}$/.test(alpha3)) {
    throw new Error(`Invalid alpha3 code: ${alpha3}`);
  }
  const [a, b, c] = alpha3.split("").map(ch => ch.charCodeAt(0));
  return (BigInt(a) << 16n) | (BigInt(b) << 8n) | BigInt(c);
}

function assertNode24Runtime(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < 24) {
    throw new Error(
      `Node.js >=24 is required for this Aztec E2E flow. Current runtime: ${process.versions.node}. ` +
        "Run: nvm use 24",
    );
  }
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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

type UnwrappedStepResult<T> = T extends { result: infer R } ? R : T;

function unwrapStepResult<T>(value: T): UnwrappedStepResult<T> {
  if (value && typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    return (value as unknown as { result: UnwrappedStepResult<T> }).result;
  }
  return value as UnwrappedStepResult<T>;
}

async function runStep<T>(label: string, work: () => Promise<T>): Promise<UnwrappedStepResult<T>> {
  console.info(`[e2e] ${label}`);
  try {
    return unwrapStepResult(await work());
  } catch (error) {
    throw new Error(`[e2e] ${label} failed: ${errorDetails(error)}`);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientLocalNetworkTxError(error: unknown): boolean {
  const details = errorDetails(error);
  return TRANSIENT_LOCAL_NETWORK_TX_ERROR_MARKERS.some(marker => details.includes(marker));
}

async function runRetriedStep<T>(
  label: string,
  work: () => Promise<T>,
): Promise<UnwrappedStepResult<T>> {
  let attempt = 1;
  while (true) {
    console.info(`[e2e] ${label}${attempt > 1 ? ` (retry=${attempt - 1})` : ""}`);
    try {
      return unwrapStepResult(await work());
    } catch (error) {
      const details = errorDetails(error);
      if (!isTransientLocalNetworkTxError(error) || attempt >= TRANSIENT_LOCAL_NETWORK_TX_RETRY_ATTEMPTS) {
        throw new Error(`[e2e] ${label} failed: ${details}`);
      }

      console.info(
        `[e2e] ${label} transient local-network tx error; rebuilding tx ` +
          `(attempt=${attempt} max_attempts=${TRANSIENT_LOCAL_NETWORK_TX_RETRY_ATTEMPTS} backoff_ms=${TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS}): ${details}`,
      );
      if (TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS > 0) {
        await sleep(TRANSIENT_LOCAL_NETWORK_TX_RETRY_BACKOFF_MS);
      }
      attempt += 1;
    }
  }
}

function toPrintable(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toPrintable);

  const candidate = value as {
    toBigInt?: () => bigint;
    toString?: () => string;
  };
  if (typeof candidate.toBigInt === "function") {
    return candidate.toBigInt().toString();
  }
  if (typeof candidate.toString === "function") {
    const asString = candidate.toString();
    if (asString !== "[object Object]") return asString;
  }

  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    result[key] = toPrintable(inner);
  }
  return result;
}

function logTrace(label: string, payload: unknown): void {
  console.info(`[e2e:trace] ${label}`);
  console.info(JSON.stringify(toPrintable(payload), null, 2));
}

function toBigIntValue(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value === "object") {
    const candidate = value as {
      toBigInt?: () => bigint;
      valueOf?: () => unknown;
      toString?: () => string;
    };
    if (typeof candidate.toBigInt === "function") return candidate.toBigInt();
    if (typeof candidate.valueOf === "function") {
      const unwrapped = candidate.valueOf();
      if (unwrapped !== value) return toBigIntValue(unwrapped);
    }
    if (typeof candidate.toString === "function") {
      const asString = candidate.toString();
      if (asString && asString !== "[object Object]") return BigInt(asString);
    }
  }
  throw new Error(`Cannot convert value to bigint: ${String(value)}`);
}

type TxReceiptLike = {
  txHash: unknown;
  blockNumber?: unknown;
  status?: unknown;
  executionResult?: unknown;
};

type TxResultLike = TxReceiptLike | { receipt: TxReceiptLike };

function toTxHashString(txHash: unknown): string {
  const printed = toPrintable(txHash);
  return typeof printed === "string" ? printed : JSON.stringify(printed);
}

function getTxReceipt(receipt: TxResultLike): TxReceiptLike {
  if (receipt && typeof receipt === "object" && "receipt" in receipt) {
    return (receipt as { receipt: TxReceiptLike }).receipt;
  }
  return receipt as TxReceiptLike;
}

function getTxHash(receipt: TxResultLike): any {
  return getTxReceipt(receipt).txHash;
}

function logTxReceipt(label: string, receipt: TxResultLike): string {
  const minedReceipt = getTxReceipt(receipt);
  const txHash = toTxHashString(minedReceipt.txHash);
  logTrace(`tx.${label}`, {
    txHash,
    blockNumber: minedReceipt.blockNumber,
    status: minedReceipt.status,
    executionResult: minedReceipt.executionResult,
  });
  return txHash;
}

function computeRevocationNullifier(
  revocationSecret: unknown,
  credentialType: unknown,
  claimsHash: unknown,
): bigint {
  return poseidon2HashWithSeparator(
    [
      toBigIntValue(revocationSecret),
      toBigIntValue(credentialType),
      toBigIntValue(claimsHash),
    ],
    MAGNA_REVOCATION_DS,
  ).toBigInt();
}

function computeClaimsHash(
  schemaVersion: bigint,
  credentialType: number,
  nationalityPacked: bigint,
  minAgeProven: number,
  expiryTs: bigint,
): bigint {
  return poseidon2HashWithSeparator(
    [
      schemaVersion,
      BigInt(credentialType),
      nationalityPacked,
      BigInt(minAgeProven),
      expiryTs,
    ],
    MAGNA_CLAIMS_DS,
  ).toBigInt();
}

async function waitForNodeWithTimeout(
  node: ReturnType<typeof createAztecNodeClient>,
  timeoutMs: number,
): Promise<void> {
  // aztec.js waitForNode internally retries node.getNodeInfo() with no timeout.
  // Here we use the same readiness probe with an explicit timeout for deterministic test failure.
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

async function syncWalletPxeAfterWarp(label: string, wallet?: EmbeddedWallet): Promise<void> {
  const debug = (
    wallet as EmbeddedWallet & {
      pxe?: {
        debug?: {
          sync?: () => Promise<void>;
        };
      };
    }
  )?.pxe?.debug;
  const debugSync = debug?.sync;

  if (!debugSync) {
    await sleep(1_000);
    return;
  }

  console.info(`[e2e] ${label} syncing PXE after L1 warp`);
  await retryUntil(
    async () => {
      try {
        await debugSync.call(debug);
        return true;
      } catch {
        return undefined;
      }
    },
    `${label} PXE sync after warp`,
    AZTEC_PXE_SYNC_AFTER_WARP_ATTEMPTS,
    1,
  );
}

async function createWallet(node: ReturnType<typeof createAztecNodeClient>): Promise<EmbeddedWallet> {
  return await EmbeddedWallet.create(node, {
    ephemeral: true,
    pxeConfig: {
      proverEnabled: false,
    },
  });
}

async function loadInitialAccount(
  wallet: EmbeddedWallet,
  testAccounts: Awaited<ReturnType<typeof getInitialTestAccountsData>>,
  deployer: AztecAddress,
  alias: string,
): Promise<AztecAddress> {
  const deployerData = testAccounts.find(account => account.address.equals(deployer));
  if (!deployerData) {
    throw new Error(`Deployer ${deployer.toString()} is not one of local network test accounts`);
  }

  const account = await runStep(
    `wallet.createSchnorrAccount(${alias})`,
    async () => await wallet.createSchnorrAccount(
      deployerData.secret,
      deployerData.salt,
      deployerData.signingKey,
      alias,
    ),
  );
  expect(account.address.equals(deployer)).toBe(true);
  return account.address;
}


function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Bytes(input: Uint8Array | Buffer | string): Promise<Uint8Array> {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  return new Uint8Array(await webcrypto.subtle.digest("SHA-256", toArrayBuffer(new Uint8Array(bytes))));
}

async function createSimulatedWebAuthnRegistration(
  rpId: string,
  origin: string,
): Promise<{ registration: WebAuthnRegistration; privateKey: CryptoKey }> {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair)) {
    throw new Error("expected WebAuthn fixture key pair");
  }
  const jwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  if (!jwk.x || !jwk.y) {
    throw new Error("generated P-256 public key is missing coordinates");
  }
  return {
    privateKey: keyPair.privateKey,
    registration: {
      credentialId: webcrypto.getRandomValues(new Uint8Array(32)),
      publicKey: {
        x: new Uint8Array(Buffer.from(jwk.x, "base64url")),
        y: new Uint8Array(Buffer.from(jwk.y, "base64url")),
      },
      rpId,
      rpIdHash: await sha256Bytes(rpId),
      origin,
    },
  };
}

function simulatedAsserter(privateKey: CryptoKey, rpId: string, origin: string): WebAuthnAsserter {
  return async (challenge: Uint8Array) => {
    const challengeB64 = Buffer.from(challenge).toString("base64url");
    const clientDataJSON = Buffer.from(
      `{"type":"webauthn.get","challenge":"${challengeB64}","origin":"${origin}","crossOrigin":false}`,
    );
    const rpIdHash = Buffer.from(createHash("sha256").update(rpId).digest());
    const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, 0])]);
    const clientDataHash = Buffer.from(await sha256Bytes(clientDataJSON));
    const rawSignature = new Uint8Array(
      await webcrypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        toArrayBuffer(Buffer.concat([authenticatorData, clientDataHash])),
      ),
    );
    if (rawSignature.length !== 64) {
      throw new Error(`expected raw P-256 signature length 64, got ${rawSignature.length}`);
    }
    const signatureRS = new Uint8Array(64);
    signatureRS.set(rawSignature.slice(0, 32), 0);
    signatureRS.set(normalizeSToLow(rawSignature.slice(32)), 32);
    return {
      signatureRS,
      authenticatorData: new Uint8Array(authenticatorData),
      clientDataJSON: new Uint8Array(clientDataJSON),
    };
  };
}

async function createAndDeploySchnorrAccount(
  wallet: EmbeddedWallet,
  feePayer: AztecAddress,
  alias: string,
): Promise<{ address: AztecAddress; deployTx: TxResultLike }> {
  const accountManager = await runStep(
    `wallet.createSchnorrAccount(${alias})`,
    async () => await wallet.createSchnorrAccount(Fr.random(), Fr.random(), undefined, alias),
  );
  const deployMethod = await runStep(
    `getDeployMethod(${alias})`,
    async () => await accountManager.getDeployMethod(),
  );
  const deployTx = await runStep(
    `account deployment (${alias})`,
    async () =>
      await deployMethod.send({
        from: feePayer,
      }),
  );
  return { address: accountManager.address, deployTx };
}

async function generateValidSecp256r1SigningKey(): Promise<Buffer> {
  const ecdsa = new Ecdsa("secp256r1");
  for (let i = 0; i < 32; i += 1) {
    const candidate = randomBytes(32);
    try {
      await ecdsa.computePublicKey(candidate);
      return candidate;
    } catch {
      // Retry until we find a valid scalar for secp256r1.
    }
  }
  throw new Error("Failed to generate a valid secp256r1 signing key");
}

async function createAndDeployEcdsaRAccount(
  wallet: EmbeddedWallet,
  feePayer: AztecAddress,
  alias: string,
): Promise<{ address: AztecAddress; deployTx: TxResultLike }> {
  const signingKey = await runStep(
    `generate secp256r1 signing key (${alias})`,
    async () => await generateValidSecp256r1SigningKey(),
  );
  const accountManager = await runStep(
    `wallet.createECDSARAccount(${alias})`,
    async () => await wallet.createECDSARAccount(Fr.random(), Fr.random(), signingKey, alias),
  );
  const deployMethod = await runStep(
    `getDeployMethod(${alias})`,
    async () => await accountManager.getDeployMethod(),
  );
  const deployTx = await runStep(
    `account deployment (${alias})`,
    async () =>
      await deployMethod.send({
        from: feePayer,
      }),
  );
  return { address: accountManager.address, deployTx };
}


async function createAndDeployWebAuthnAccount(
  wallet: EmbeddedWallet,
  feePayer: AztecAddress,
  alias: string,
): Promise<{ address: AztecAddress; deployTx: TxResultLike; accountManager: AccountManager }> {
  const rpId = "localhost";
  const origin = "http://localhost:5184";
  const material = await runStep(
    `simulated WebAuthn registration (${alias})`,
    async () => await createSimulatedWebAuthnRegistration(rpId, origin),
  );
  const accountContract = new MagnaWebAuthnAccountContract(
    material.registration,
    simulatedAsserter(material.privateKey, rpId, origin),
  );
  const accountManager = await runStep(
    `AccountManager.create(WebAuthn ${alias})`,
    async () => await AccountManager.create(wallet, Fr.random(), accountContract, Fr.random()),
  );
  await runStep(`wallet.registerContract(WebAuthn ${alias})`, async () => {
    await wallet.registerContract(
      accountManager.getInstance(),
      await accountManager.getAccountContract().getContractArtifact(),
      accountManager.getSecretKey(),
    );
  });
  const deployMethod = await runStep(
    `getDeployMethod(WebAuthn ${alias})`,
    async () => await accountManager.getDeployMethod(),
  );
  const deployTx = await runStep(
    `account deployment (WebAuthn ${alias})`,
    async () => await deployMethod.send({ from: feePayer }),
  );
  return { address: accountManager.address, deployTx, accountManager };
}

async function bridgeFeeJuiceToAddress(
  node: ReturnType<typeof createAztecNodeClient>,
  recipient: AztecAddress,
): Promise<FeeJuiceBridgeClaim> {
  const l1Client = createExtendedL1Client(L1_RPC_URLS, L1_MNEMONIC);
  const logger = createLogger("magna:e2e:fee-juice");
  const portalManager = await runStep("L1FeeJuicePortalManager.new", async () => {
    return await L1FeeJuicePortalManager.new(node, l1Client, logger);
  });
  const claim = await runStep(`bridge Fee Juice to ${recipient.toString()}`, async () => {
    return await portalManager.bridgeTokensPublic(recipient, undefined, true);
  });
  logTrace("fee_juice.bridge_claim", {
    recipient,
    claimAmount: claim.claimAmount,
    claimSecret: claim.claimSecret,
    messageHash: claim.messageHash,
    messageLeafIndex: claim.messageLeafIndex,
  });

  return {
    claimAmount: claim.claimAmount,
    claimSecret: claim.claimSecret,
    messageHash: claim.messageHash,
    messageLeafIndex: claim.messageLeafIndex,
  };
}

async function claimBridgedFeeJuice(
  node: ReturnType<typeof createAztecNodeClient>,
  wallet: EmbeddedWallet,
  feePayer: AztecAddress,
  recipient: AztecAddress,
  claim: FeeJuiceBridgeClaim,
): Promise<{ claimTxHash: string; claimAmount: bigint; balanceAfterClaim: bigint }> {
  await runStep("wait for Fee Juice bridge message witness", async () => {
    const startedAt = Date.now();
    let attempt = 0;
    let lastError = "unknown";

    // Local devnet message ingestion can lag by several checkpoints after the L1 bridge tx is mined.
    while (Date.now() - startedAt < AZTEC_FEE_JUICE_WITNESS_WAIT_MS) {
      attempt += 1;
      try {
        const [messageIndex] = await getNonNullifiedL1ToL2MessageWitness(
          node,
          ProtocolContractAddress.FeeJuice,
          Fr.fromHexString(claim.messageHash),
          claim.claimSecret,
        );
        logTrace("fee_juice.bridge_witness_ready", {
          attempt,
          elapsedMs: Date.now() - startedAt,
          messageIndex: messageIndex.toString(),
          expectedLeafIndex: claim.messageLeafIndex.toString(),
          messageHash: claim.messageHash,
        });
        return;
      } catch (error) {
        lastError = errorDetails(error);
        console.info(
          `[e2e] Fee Juice bridge witness not ready yet ` +
            `(attempt=${attempt} elapsed_ms=${Date.now() - startedAt} poll_ms=${AZTEC_FEE_JUICE_WITNESS_POLL_MS}): ${lastError}`,
        );
        await sleep(AZTEC_FEE_JUICE_WITNESS_POLL_MS);
      }
    }

    throw new Error(
      `Timeout awaiting Fee Juice bridge message witness after ${AZTEC_FEE_JUICE_WITNESS_WAIT_MS}ms. ` +
        `last_error=${lastError}`,
    );
  });

  const feeJuice = await FeeJuiceContract.at(ProtocolContractAddress.FeeJuice, wallet);
  const claimReceipt = await runStep(`FeeJuice.claim(${recipient.toString()})`, async () => {
    return await feeJuice.methods
      .claim(recipient, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
      .send({ from: feePayer });
  });
  const claimTxHash = logTxReceipt("bootstrap.claim_fee_juice", claimReceipt);
  const balanceAfterClaim = await runStep(`getFeeJuiceBalance(${recipient.toString()})`, async () => {
    return await getFeeJuiceBalance(recipient, node);
  });
  return {
    claimTxHash,
    claimAmount: claim.claimAmount,
    balanceAfterClaim,
  };
}

async function mineTwoL2BlocksForBridgeIngestion(
  l2NudgeToken: TokenContract,
  orchestrator: AztecAddress,
  label = "bridge ingestion",
): Promise<void> {
  const nudgeRecipient = AztecAddress.fromBigInt(Fr.random().toBigInt());
  await runRetriedStep(`${label} L2 nudge #1`, async () => {
    return await l2NudgeToken.methods.mint_to_public(nudgeRecipient, 1n).send({
      from: orchestrator,
    });
  });
  await runRetriedStep(`${label} L2 nudge #2`, async () => {
    return await l2NudgeToken.methods.mint_to_public(nudgeRecipient, 1n).send({
      from: orchestrator,
    });
  });
}

async function topUpRightsFromL2Payment(
  ready: Pick<
    E2EContext,
    | "wallet"
    | "orchestrator"
    | "l2PaymentToken"
    | "l2RightsPurchase"
    | "l2Treasury"
    | "activeOwner"
  >,
  sponsor: AztecAddress,
  rightsAmount: bigint,
  packageId: bigint,
  label: string,
): Promise<{ authwitNonce: Fr; purchaseId: bigint; purchaseTxHash: string }> {
  const authwitNonce = Fr.random();
  const paymentAmount = rightsAmount * L2_PRICE_PER_VERIFY;
  const action = ready.l2PaymentToken.methods.transfer_in_public(
    ready.orchestrator,
    ready.l2Treasury,
    paymentAmount,
    authwitNonce,
  );

  await runRetriedStep(`${label} set public authwit`, async () => {
    const setAuthwit = await SetPublicAuthwitContractInteraction.create(
      ready.wallet,
      ready.orchestrator,
      { caller: ready.l2RightsPurchase.address, action },
      true,
    );
    return await setAuthwit.send();
  });

  const purchaseReceipt = await runRetriedStep(`${label} purchase rights`, async () => {
    return await ready.l2RightsPurchase.methods
      .purchase_rights_public(sponsor, rightsAmount, packageId, authwitNonce)
      .send({ from: ready.orchestrator });
  });
  const purchaseTxHash = logTxReceipt(`${label}.purchase`, purchaseReceipt);
  const purchaseId = toBigIntValue(
    unwrapStepResult(await ready.l2RightsPurchase.methods.get_next_purchase_id().simulate({ from: ready.activeOwner })),
  ) - 1n;
  return { authwitNonce, purchaseId, purchaseTxHash };
}

type PolicyConstraint = {
  claim_id: number;
  op: number;
  value: bigint;
};

type E2EContext = {
  node: ReturnType<typeof createAztecNodeClient>;
  wallet: EmbeddedWallet;
  orchestrator: AztecAddress;
  activeOwner: AztecAddress;
  ghostOwner: AztecAddress;
  newActiveOwner: AztecAddress;
  issuer: MagnaIssuerContract;
  companySponsor: MagnaCompanySponsorContract;
  rightsRegistry: MagnaCompanyRightsRegistryContract;
  l2PaymentToken: TokenContract;
  l2RightsPurchase: MagnaRightsPurchaseL2Contract;
  l2Treasury: AztecAddress;
  verifyMeterHook: MagnaVerifyMeterHookContract;
  consumer: MagnaConsumerContract;
  secondaryConsumer: MagnaConsumerContract;
  unregisteredConsumer: MagnaConsumerContract;
  verifyMeterHookInstant: MagnaVerifyMeterHookInstantContract;
  issuerWithInstantMeterHook: MagnaIssuerContract;
  claimsHash: bigint;
  credentialType: number;
  minAgeProven: number;
  nationalityPacked: bigint;
  constraints: PolicyConstraint[];
  txHashesByPhase: Record<string, string[]>;
  companySponsorFundingClaim?: FeeJuiceBridgeClaim;
  hintedCredential?: HintedCredential;
  hintedStatus?: HintedStatus;
  hintedRecovery?: HintedRecovery;
};

async function ensureCompanySponsorFeeJuice(
  ready: E2EContext,
): Promise<{ sponsorClaimTxHash?: string; balanceAfterClaim: bigint }> {
  const sponsorFeeJuice = await runStep("getFeeJuiceBalance(company sponsor)", async () =>
    getFeeJuiceBalance(ready.companySponsor.address, ready.node),
  );
  logTrace("company_sponsor.fee_juice_balance.before_claim", { balance: sponsorFeeJuice.toString() });
  if (sponsorFeeJuice > 0n) {
    return { balanceAfterClaim: sponsorFeeJuice };
  }

  if (!ready.companySponsorFundingClaim) {
    throw new Error("Missing company sponsor Fee Juice bridge claim in test context");
  }

  const sponsorFunding = await claimBridgedFeeJuice(
    ready.node,
    ready.wallet,
    ready.orchestrator,
    ready.companySponsor.address,
    ready.companySponsorFundingClaim,
  );
  logTrace("company_sponsor.fee_juice_funding", sponsorFunding);
  return {
    sponsorClaimTxHash: sponsorFunding.claimTxHash,
    balanceAfterClaim: sponsorFunding.balanceAfterClaim,
  };
}

function buildConstraints(): PolicyConstraint[] {
  const constraints = Array.from({ length: MAX_CONSTRAINTS }, () => ({
    claim_id: 0,
    op: 0,
    value: 0n,
  }));
  constraints[0] = { claim_id: 1, op: 3, value: 18n }; // age >= 18
  constraints[1] = { claim_id: 2, op: 2, value: packAlpha3("USA") }; // nationality != USA
  constraints[2] = { claim_id: 3, op: 3, value: 1_800_000_000n }; // expiry >= threshold
  return constraints;
}

function buildConstraintsWithoutExpiry(): PolicyConstraint[] {
  const constraints = buildConstraints();
  constraints[2] = { claim_id: 0, op: 0, value: 0n };
  return constraints;
}

function buildInstagramConstraints(handleHash: bigint): PolicyConstraint[] {
  const constraints = Array.from({ length: MAX_CONSTRAINTS }, () => ({
    claim_id: 0,
    op: 0,
    value: 0n,
  }));
  constraints[0] = { claim_id: 4, op: 1, value: handleHash };
  constraints[1] = { claim_id: 3, op: 3, value: 1_800_000_000n };
  return constraints;
}

function requireContext(ctx: E2EContext | undefined): E2EContext {
  if (!ctx) {
    throw new Error("E2E context missing; bootstrap phase did not complete");
  }
  return ctx;
}

function requireHintedContext(
  ctx: E2EContext | undefined,
): E2EContext & {
  hintedCredential: HintedCredential;
  hintedStatus: HintedStatus;
  hintedRecovery: HintedRecovery;
} {
  const ready = requireContext(ctx);
  if (!ready.hintedCredential || !ready.hintedStatus || !ready.hintedRecovery) {
    throw new Error("Hinted note context missing; note-discovery phase did not complete");
  }
  return ready as E2EContext & {
    hintedCredential: HintedCredential;
    hintedStatus: HintedStatus;
    hintedRecovery: HintedRecovery;
  };
}

const suite = runE2E ? describe.sequential : describe.skip;

suite("Magna issuer + verify meter hook live-network e2e", () => {
  let ctx: E2EContext | undefined;
  let wallet: EmbeddedWallet | undefined;

  beforeAll(async () => {
    assertNode24Runtime();

    const node = createAztecNodeClient(AZTEC_NODE_URL);
    await runStep(
      `waitForNode url=${AZTEC_NODE_URL} timeout_ms=${AZTEC_WAIT_FOR_NODE_MS}`,
      async () => await waitForNodeWithTimeout(node, AZTEC_WAIT_FOR_NODE_MS),
    );

    const embeddedWallet = await runStep(
      "EmbeddedWallet.create",
      async () => await createWallet(node),
    );
    wallet = embeddedWallet;

    const testAccounts = await runStep(
      "getInitialTestAccountsData",
      async () => await getInitialTestAccountsData(),
    );
    expect(testAccounts.length).toBeGreaterThanOrEqual(3);

    const orchestrator = await loadInitialAccount(
      embeddedWallet,
      testAccounts,
      testAccounts[0].address,
      "orchestrator",
    );
    const activeOwner = await loadInitialAccount(
      embeddedWallet,
      testAccounts,
      testAccounts[1].address,
      "active-owner",
    );
    const ghostOwner = await loadInitialAccount(
      embeddedWallet,
      testAccounts,
      testAccounts[2].address,
      "ghost-owner",
    );
    const newActiveOwnerDeployment = await createAndDeploySchnorrAccount(
      embeddedWallet,
      orchestrator,
      "new-active-owner",
    );
    const newActiveOwner = newActiveOwnerDeployment.address;
    const accountDeployTxHash = logTxReceipt(
      "bootstrap.new_active_owner_deploy",
      newActiveOwnerDeployment.deployTx,
    );

    await runStep(
      "wallet.registerSender(orchestrator)",
      async () => await embeddedWallet.registerSender(orchestrator, "orchestrator"),
    );

    const l1Client = createExtendedL1Client(L1_RPC_URLS, L1_MNEMONIC);
    const nodeInfo = await runStep("node.getNodeInfo", async () => await node.getNodeInfo());
    const registryAddress = nodeInfo.l1ContractAddresses.registryAddress.toString() as `0x${string}`;
    const portalArtifact = await runStep(
      "load L1 MagnaRightsPortal artifact",
      async () => loadL1Artifact("MagnaRightsPortal.sol", "MagnaRightsPortal"),
    );
    const paymentTokenArtifact = await runStep(
      "load L1 MockERC20 artifact",
      async () => loadL1Artifact("MockERC20.sol", "MockERC20"),
    );
    const l1PaymentTokenDeployment = await runStep(
      "deploy L1 payment token",
      async () =>
        await deployL1Contract(
          l1Client,
          paymentTokenArtifact.abi,
          paymentTokenArtifact.bytecode.object,
          ["Mock USD Coin", "mUSDC", 6, l1Client.account.address, INITIAL_L1_STABLE_SUPPLY],
        ),
    );
    const l1PaymentTokenAddress = l1PaymentTokenDeployment.address.toString() as `0x${string}`;
    const l1PortalDeployment = await runStep(
      "deploy L1 MagnaRightsPortal",
      async () =>
        await deployL1Contract(
          l1Client,
          portalArtifact.abi,
          portalArtifact.bytecode.object,
          [l1Client.account.address, l1PaymentTokenAddress, L1_STABLE_PRICE_PER_VERIFY],
        ),
    );
    const l1PortalAddress = l1PortalDeployment.address.toString() as `0x${string}`;

    const issuerDeployReceipt = await runStep(
      "deploy MagnaIssuer",
      async () =>
        await (MagnaIssuerContract.deploy as unknown as (
          wallet: EmbeddedWallet,
          orchestratorAddress: AztecAddress,
          verifyMeterHookAddress: AztecAddress,
        ) => {
          send: (opts: { from: AztecAddress }) => Promise<{
            contract: MagnaIssuerContract;
            receipt: TxReceiptLike;
          }>;
        })(embeddedWallet, orchestrator, AztecAddress.ZERO).send({
          from: orchestrator,
        }),
    );
    const verifyMeterHookDeployReceipt = await runStep(
      "deploy MagnaVerifyMeterHook",
      async () =>
        await MagnaVerifyMeterHookContract.deploy(embeddedWallet, orchestrator, 1n << 1n).send({
          from: orchestrator,
        }),
    );
    const companySponsorDeployReceipt = await runStep(
      "deploy MagnaCompanySponsor",
      async () =>
        await MagnaCompanySponsorContract.deploy(
          embeddedWallet,
          orchestrator,
          COMPANY_SPONSOR_MAX_FEE_CAP,
        ).send({
          from: orchestrator,
        }),
    );
    const rightsRegistryDeployReceipt = await runStep(
      "deploy MagnaCompanyRightsRegistry",
      async () =>
        await MagnaCompanyRightsRegistryContract.deploy(
          embeddedWallet,
          EthAddress.fromString(l1PortalAddress),
          orchestrator,
        ).send({
          from: orchestrator,
        }),
    );
    const l2PaymentTokenDeployReceipt = await runStep(
      "deploy L2 payment token",
      async () =>
        await TokenContract.deploy(
          embeddedWallet,
          orchestrator,
          "Magna USD",
          "mUSD",
          6,
        ).send({
          from: orchestrator,
        }),
    );
    const l2RightsPurchaseDeployReceipt = await runStep(
      "deploy MagnaRightsPurchaseL2",
      async () =>
        await MagnaRightsPurchaseL2Contract.deploy(
          embeddedWallet,
          orchestrator,
          orchestrator,
          l2PaymentTokenDeployReceipt.contract.address,
          rightsRegistryDeployReceipt.contract.address,
          L2_PRICE_PER_VERIFY,
        ).send({
          from: orchestrator,
        }),
    );
    const consumerDeployReceipt = await runStep(
      "deploy MagnaConsumer",
      async () =>
        await MagnaConsumerContract.deploy(embeddedWallet, issuerDeployReceipt.contract.address).send({
          from: orchestrator,
        }),
    );
    const secondaryConsumerDeployReceipt = await runStep(
      "deploy secondary MagnaConsumer",
      async () =>
        await MagnaConsumerContract.deploy(embeddedWallet, issuerDeployReceipt.contract.address).send({
          from: orchestrator,
        }),
    );
    const unregisteredConsumerDeployReceipt = await runStep(
      "deploy unregistered MagnaConsumer",
      async () =>
        await MagnaConsumerContract.deploy(embeddedWallet, issuerDeployReceipt.contract.address).send({
          from: orchestrator,
        }),
    );
    const verifyMeterHookInstantDeployReceipt = await runStep(
      "deploy MagnaVerifyMeterHookInstant",
      async () =>
        await MagnaVerifyMeterHookInstantContract.deploy(embeddedWallet, orchestrator, 1n << 1n).send({
          from: orchestrator,
        }),
    );
    const issuerWithInstantMeterHookDeployReceipt = await runStep(
      "deploy MagnaIssuer(with instant verify meter hook)",
      async () =>
        await (MagnaIssuerContract.deploy as unknown as (
          wallet: EmbeddedWallet,
          orchestratorAddress: AztecAddress,
          verifyMeterHookAddress: AztecAddress,
        ) => {
          send: (opts: { from: AztecAddress }) => Promise<{
            contract: MagnaIssuerContract;
            receipt: TxReceiptLike;
          }>;
        })(embeddedWallet, orchestrator, verifyMeterHookInstantDeployReceipt.contract.address).send({
          from: orchestrator,
        }),
    );
    const issuer = issuerDeployReceipt.contract;
    const companySponsor = companySponsorDeployReceipt.contract;
    const rightsRegistry = rightsRegistryDeployReceipt.contract;
    const l2PaymentToken = l2PaymentTokenDeployReceipt.contract;
    const l2RightsPurchase = l2RightsPurchaseDeployReceipt.contract;
    const l2Treasury = orchestrator;
    const verifyMeterHook = verifyMeterHookDeployReceipt.contract;
    const consumer = consumerDeployReceipt.contract;
    const secondaryConsumer = secondaryConsumerDeployReceipt.contract;
    const unregisteredConsumer = unregisteredConsumerDeployReceipt.contract;
    const verifyMeterHookInstant = verifyMeterHookInstantDeployReceipt.contract;
    const issuerWithInstantMeterHook = issuerWithInstantMeterHookDeployReceipt.contract;
    const initPortalTxHash = await runStep(
      "initialize L1 portal with Aztec registry and L2 rights registry",
      async () =>
        await (l1Client.writeContract as (...args: any[]) => Promise<`0x${string}`>)({
          address: l1PortalAddress,
          abi: portalArtifact.abi,
          functionName: "initialize",
          args: [registryAddress, rightsRegistry.address.toString() as `0x${string}`],
        }),
    );
    await runStep(
      "wait for L1 portal initialization tx receipt",
      async () => await l1Client.waitForTransactionReceipt({ hash: initPortalTxHash }),
    );
    const configuredPortal = (await runStep(
      "rightsRegistry.get_portal (main live e2e bootstrap)",
      async () => await rightsRegistry.methods.get_portal().simulate({ from: activeOwner }),
    )) as EthAddress;
    expect(configuredPortal.toString().toLowerCase()).toEqual(l1PortalAddress.toLowerCase());
    logTrace("bootstrap.l1_portal_wiring", {
      paymentTokenAddress: l1PaymentTokenAddress,
      portalAddress: l1PortalAddress,
      registryAddress,
      portalInitializeTxHash: initPortalTxHash,
    });
    const issuerDeployTxHash = logTxReceipt("bootstrap.deploy_magna_issuer", issuerDeployReceipt);
    const companySponsorDeployTxHash = logTxReceipt(
      "bootstrap.deploy_magna_company_sponsor",
      companySponsorDeployReceipt,
    );
    const rightsRegistryDeployTxHash = logTxReceipt(
      "bootstrap.deploy_magna_company_rights_registry",
      rightsRegistryDeployReceipt,
    );
    const l2PaymentTokenDeployTxHash = logTxReceipt(
      "bootstrap.deploy_l2_payment_token",
      l2PaymentTokenDeployReceipt,
    );
    const l2RightsPurchaseDeployTxHash = logTxReceipt(
      "bootstrap.deploy_magna_rights_purchase_l2",
      l2RightsPurchaseDeployReceipt,
    );
    const verifyMeterHookDeployTxHash = logTxReceipt(
      "bootstrap.deploy_magna_verify_meter_hook",
      verifyMeterHookDeployReceipt,
    );
    const consumerDeployTxHash = logTxReceipt("bootstrap.deploy_magna_consumer", consumerDeployReceipt);
    const secondaryConsumerDeployTxHash = logTxReceipt("bootstrap.deploy_secondary_magna_consumer", secondaryConsumerDeployReceipt);
    const unregisteredConsumerDeployTxHash = logTxReceipt("bootstrap.deploy_unregistered_magna_consumer", unregisteredConsumerDeployReceipt);
    const verifyMeterHookInstantDeployTxHash = logTxReceipt(
      "bootstrap.deploy_magna_verify_meter_hook_instant",
      verifyMeterHookInstantDeployReceipt,
    );
    const issuerWithInstantMeterHookDeployTxHash = logTxReceipt(
      "bootstrap.deploy_magna_issuer_with_instant_verify_meter_hook",
      issuerWithInstantMeterHookDeployReceipt,
    );
    const sponsorFundingClaim = await bridgeFeeJuiceToAddress(
      node,
      companySponsor.address,
    );

    const setVerifyMeterHookIssuerReceipt = await runStep("verifyMeterHook.set_issuer(orchestrator for direct-call tests)", async () => {
      return await verifyMeterHook.methods.set_issuer(orchestrator).send({ from: orchestrator });
    });
    const setVerifyMeterHookIssuerTxHash = logTxReceipt(
      "bootstrap.set_verify_meter_hook_issuer_for_direct_calls",
      setVerifyMeterHookIssuerReceipt,
    );

    const setInstantVerifyMeterHookIssuerReceipt = await runStep("verifyMeterHookInstant.set_issuer(issuerWithInstantMeterHook)", async () => {
      return await verifyMeterHookInstant.methods
        .set_issuer(issuerWithInstantMeterHook.address)
        .send({ from: orchestrator });
    });
    const setInstantVerifyMeterHookIssuerTxHash = logTxReceipt(
      "bootstrap.set_verify_meter_hook_instant_issuer",
      setInstantVerifyMeterHookIssuerReceipt,
    );

    const initializeCompanySponsorIssuerReceipt = await runStep("companySponsor.initialize_issuer(issuer)", async () => {
      return await companySponsor.methods
        .initialize_issuer(issuer.address)
        .send({ from: orchestrator });
    });
    const initializeCompanySponsorIssuerTxHash = logTxReceipt(
      "bootstrap.company_sponsor_initialize_issuer",
      initializeCompanySponsorIssuerReceipt,
    );

    const initializeIssuerGatewayReceipt = await runStep("issuer.add_company_sponsor_gateway(companySponsor)", async () => {
      return await issuer.methods
        .add_company_sponsor_gateway(companySponsor.address)
        .send({ from: orchestrator });
    });
    const initializeIssuerGatewayTxHash = logTxReceipt(
      "bootstrap.issuer_add_company_sponsor_gateway",
      initializeIssuerGatewayReceipt,
    );
    const initializeCompanySponsorRightsRegistryReceipt = await runStep(
      "companySponsor.initialize_rights_registry(rightsRegistry)",
      async () => {
        return await companySponsor.methods
          .initialize_rights_registry(rightsRegistry.address)
          .send({ from: orchestrator });
      },
    );
    const initializeCompanySponsorRightsRegistryTxHash = logTxReceipt(
      "bootstrap.company_sponsor_initialize_rights_registry",
      initializeCompanySponsorRightsRegistryReceipt,
    );
    const mintL2StableReceipt = await runStep("l2PaymentToken.mint_to_public(orchestrator)", async () => {
      return await l2PaymentToken.methods
        .mint_to_public(orchestrator, INITIAL_L2_STABLE_SUPPLY)
        .send({ from: orchestrator });
    });
    const mintL2StableTxHash = logTxReceipt("bootstrap.mint_l2_stable_orchestrator", mintL2StableReceipt);
    const initializeL2PurchaseAdapterReceipt = await runStep(
      "rightsRegistry.initialize_l2_purchase_adapter(l2RightsPurchase)",
      async () => {
        return await rightsRegistry.methods
          .initialize_l2_purchase_adapter(l2RightsPurchase.address)
          .send({ from: orchestrator });
      },
    );
    const initializeL2PurchaseAdapterTxHash = logTxReceipt(
      "bootstrap.rights_registry_initialize_l2_purchase_adapter",
      initializeL2PurchaseAdapterReceipt,
    );
    const seedSponsorTopup = await topUpRightsFromL2Payment(
      {
        wallet: embeddedWallet,
        orchestrator,
        l2PaymentToken,
        l2RightsPurchase,
        l2Treasury,
        activeOwner,
      },
      companySponsor.address,
      INITIAL_SPONSOR_RIGHTS,
      0n,
      "bootstrap.seed_company_sponsor_rights",
    );
    const seedSponsorRightsTxHash = seedSponsorTopup.purchaseTxHash;

    const addConsumerGatewayReceipt = await runStep("issuer.add_consumer_gateway(consumer)", async () => {
      return await issuer.methods
        .add_consumer_gateway(consumer.address)
        .send({ from: orchestrator });
    });
    const addConsumerGatewayTxHash = logTxReceipt(
      "bootstrap.issuer_add_consumer_gateway",
      addConsumerGatewayReceipt,
    );
    const addSecondaryConsumerGatewayReceipt = await runStep("issuer.add_consumer_gateway(secondary consumer)", async () => {
      return await issuer.methods
        .add_consumer_gateway(secondaryConsumer.address)
        .send({ from: orchestrator });
    });
    const addSecondaryConsumerGatewayTxHash = logTxReceipt(
      "bootstrap.issuer_add_secondary_consumer_gateway",
      addSecondaryConsumerGatewayReceipt,
    );
    await runStep("warp for issuer.add_consumer_gateway activation", async () => {
      await warpForwardSeconds(
        "issuer.add_consumer_gateway activation",
        MAGNA_CONSUMER_GATEWAY_DELAY_SECONDS,
        wallet,
      );
    });

    const credentialType = 1;
    const nationalityPacked = packAlpha3("CAN");
    const minAgeProven = 21;
    const expiryTs = 1_893_456_000n;
    const claimsHash = computeClaimsHash(
      1n,
      credentialType,
      nationalityPacked,
      minAgeProven,
      expiryTs,
    );

    ctx = {
      node,
      wallet: embeddedWallet,
      orchestrator,
      activeOwner,
      ghostOwner,
      newActiveOwner,
      issuer,
      companySponsor,
      rightsRegistry,
      l2PaymentToken,
      l2RightsPurchase,
      l2Treasury,
      verifyMeterHook,
      consumer,
      secondaryConsumer,
      unregisteredConsumer,
      verifyMeterHookInstant,
      issuerWithInstantMeterHook,
      claimsHash,
      credentialType,
      minAgeProven,
      nationalityPacked,
      constraints: buildConstraints(),
      companySponsorFundingClaim: sponsorFundingClaim,
      txHashesByPhase: {
        bootstrap: [
          accountDeployTxHash,
          issuerDeployTxHash,
          companySponsorDeployTxHash,
          rightsRegistryDeployTxHash,
          l2PaymentTokenDeployTxHash,
          l2RightsPurchaseDeployTxHash,
          verifyMeterHookDeployTxHash,
          consumerDeployTxHash,
          secondaryConsumerDeployTxHash,
          unregisteredConsumerDeployTxHash,
          verifyMeterHookInstantDeployTxHash,
          issuerWithInstantMeterHookDeployTxHash,
          setVerifyMeterHookIssuerTxHash,
          setInstantVerifyMeterHookIssuerTxHash,
          initializeCompanySponsorIssuerTxHash,
          initializeCompanySponsorRightsRegistryTxHash,
          initializeIssuerGatewayTxHash,
          mintL2StableTxHash,
          initializeL2PurchaseAdapterTxHash,
          seedSponsorRightsTxHash,
          addConsumerGatewayTxHash,
          addSecondaryConsumerGatewayTxHash,
        ],
      },
    };
  }, E2E_BEFORE_ALL_TIMEOUT_MS);

  afterAll(async () => {
    await wallet?.stop().catch(() => undefined);
  }, 30_000);

  it("bootstraps accounts and deploys contracts", async () => {
    const ready = requireContext(ctx);
    expect(ready.orchestrator).toBeDefined();
    expect(ready.issuer.address).toBeDefined();
    expect(ready.companySponsor.address).toBeDefined();
    expect(ready.verifyMeterHook.address).toBeDefined();
    expect(ready.consumer.address).toBeDefined();
    expect(ready.secondaryConsumer.address).toBeDefined();
    expect(ready.unregisteredConsumer.address).toBeDefined();
    expect(ready.verifyMeterHookInstant.address).toBeDefined();
    expect(ready.issuerWithInstantMeterHook.address).toBeDefined();
    logTrace("passed.bootstraps accounts and deploys contracts.tx_ids", ready.txHashesByPhase.bootstrap);
  });

  it("credits sponsor rights via L2 token authwit purchase", async () => {
    const ready = requireContext(ctx);
    const before = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(company sponsor) before top-up", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(ready.companySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    const topup = await topUpRightsFromL2Payment(
      ready,
      ready.companySponsor.address,
      2n,
      0n,
      "l2_topup.integration_happy_path",
    );
    const after = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(company sponsor) after top-up", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(ready.companySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(after).toEqual(before + 2n);
    expect(topup.purchaseId).toBeGreaterThan(0n);
  }, 240_000);

  it("rejects L2 purchase when authwit is missing", async () => {
    const ready = requireContext(ctx);
    const missingAuthwitNonce = Fr.random();
    await expect(
      ready.l2RightsPurchase.methods
        .purchase_rights_public(ready.companySponsor.address, 1n, 0n, missingAuthwitNonce)
        .send({ from: ready.orchestrator }),
    ).rejects.toBeDefined();
  }, 240_000);

  it("rejects L2 purchase when payer public balance is insufficient", async () => {
    const ready = requireContext(ctx);
    const lowBalancePayerDeployment = await createAndDeploySchnorrAccount(
      ready.wallet,
      ready.orchestrator,
      "l2-topup-low-balance-payer",
    );
    const lowBalancePayer = lowBalancePayerDeployment.address;
    await runStep("wallet.registerSender(low-balance payer)", async () => {
      return await ready.wallet.registerSender(lowBalancePayer, "l2-topup-low-balance-payer");
    });
    await runStep("mint small public stable balance to low-balance payer", async () => {
      return await ready.l2PaymentToken.methods.mint_to_public(lowBalancePayer, 1n).send({
        from: ready.orchestrator,
      });
    });
    const lowBalancePayerFundingClaim = await bridgeFeeJuiceToAddress(ready.node, lowBalancePayer);
    await runStep("mine L2 blocks for low-balance payer Fee Juice bridge ingestion", async () => {
      await mineTwoL2BlocksForBridgeIngestion(
        ready.l2PaymentToken,
        ready.orchestrator,
        "low-balance payer Fee Juice bridge ingestion",
      );
    });
    const lowBalancePayerFunding = await claimBridgedFeeJuice(
      ready.node,
      ready.wallet,
      ready.orchestrator,
      lowBalancePayer,
      lowBalancePayerFundingClaim,
    );
    expect(lowBalancePayerFunding.balanceAfterClaim).toBeGreaterThan(0n);
    const insufficientNonce = Fr.random();
    const excessiveAmount = 10n * L2_PRICE_PER_VERIFY;
    const action = ready.l2PaymentToken.methods.transfer_in_public(
      lowBalancePayer,
      ready.l2Treasury,
      excessiveAmount,
      insufficientNonce,
    );
    const setAuthwit = await SetPublicAuthwitContractInteraction.create(
      ready.wallet,
      lowBalancePayer,
      { caller: ready.l2RightsPurchase.address, action },
      true,
    );
    await setAuthwit.send();

    await expect(
      ready.l2RightsPurchase.methods
        .purchase_rights_public(ready.companySponsor.address, 10n, 0n, insufficientNonce)
        .send({ from: lowBalancePayer }),
    ).rejects.toBeDefined();
  }, 300_000);

  it("registers credential and discovers hinted notes", async () => {
    const ready = requireContext(ctx);

    const registerTx = await runStep(
      "register_credential",
      async () =>
        await ready.issuer.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            ready.claimsHash,
            ready.credentialType,
            1_893_456_000n,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerTxHash = logTxReceipt("register_credential", registerTx);

    ready.hintedCredential = (await runStep(
      "get_credential_hinted",
      async () =>
        await ready.issuer.methods
          .get_credential_hinted(ready.activeOwner, ready.claimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedCredential;

    ready.hintedStatus = (await runStep(
      "get_status_hinted",
      async () =>
        await ready.issuer.methods
          .get_status_hinted(ready.activeOwner, ready.claimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedStatus;

    ready.hintedRecovery = (await runStep(
      "get_recovery_hinted",
      async () =>
        await ready.issuer.methods
          .get_recovery_hinted(ready.ghostOwner, ready.claimsHash)
          .simulate({ from: ready.ghostOwner }),
    )) as HintedRecovery;

    expect(ready.hintedRecovery.note.claims_hash).toEqual(ready.claimsHash);
    expect(ready.hintedRecovery.owner).toEqual(ready.ghostOwner);

    const statusRevocationNullifier = computeRevocationNullifier(
      ready.hintedStatus.note.revocation_secret,
      ready.hintedStatus.note.credential_type,
      ready.hintedStatus.note.claims_hash,
    );
    const recoveryKillSwitchNullifier = computeRevocationNullifier(
      ready.hintedRecovery.note.revocation_secret,
      ready.hintedRecovery.note.credential_type,
      ready.hintedRecovery.note.claims_hash,
    );
    logTrace("created_notes_and_calculated_nullifiers", {
      credential_note: ready.hintedCredential.note,
      status_note: ready.hintedStatus.note,
      recovery_note: ready.hintedRecovery.note,
      calculated_nullifiers: {
        status_revocation_nullifier: statusRevocationNullifier,
        recovery_kill_switch_nullifier: recoveryKillSwitchNullifier,
      },
    });

    ready.txHashesByPhase.register_and_discover = [registerTxHash];
    logTrace(
      "passed.registers credential and discovers hinted notes.tx_ids",
      ready.txHashesByPhase.register_and_discover,
    );
  }, 120_000);

  it("verifies credential before recovery", async () => {
    const ready = requireHintedContext(ctx);
    const meterBefore = toBigIntValue(
      await runStep(
        "get_verify_meter_count (before pre-recovery verify)",
        async () => await ready.issuer.methods.get_verify_meter_count().simulate({ from: ready.activeOwner }),
      ),
    );
    const verifyTx = await runStep(
      "verify pre-recovery",
      async () =>
        await ready.issuer.methods
          .verify(
            { credential_type: ready.credentialType, constraints: ready.constraints },
            ready.hintedCredential,
            ready.hintedStatus,
            ready.minAgeProven,
            ready.nationalityPacked,
            0,
          )
          .send({ from: ready.activeOwner }),
    );
    const meterAfter = toBigIntValue(
      await runStep(
        "get_verify_meter_count (after pre-recovery verify)",
        async () => await ready.issuer.methods.get_verify_meter_count().simulate({ from: ready.activeOwner }),
      ),
    );
    expect(meterAfter).toEqual(meterBefore + 1n);
    logTrace("verify_meter_count.pre_recovery", {
      before: meterBefore,
      after: meterAfter,
    });
    const verifyTxHash = logTxReceipt("verify_pre_recovery", verifyTx);
    ready.txHashesByPhase.verify_pre_recovery = [verifyTxHash];
    logTrace(
      "passed.verifies credential before recovery.tx_ids",
      ready.txHashesByPhase.verify_pre_recovery,
    );
  }, 90_000);

  it("registered consumer gateways accept Magna-compatible claims and unregistered gateway is rejected", async () => {
    const ready = requireHintedContext(ctx);
    const loginCountBefore = toBigIntValue(
      await runStep(
        "consumer.get_gated_login_count (before)",
        async () =>
          await ready.consumer.methods.get_gated_login_count().simulate({ from: ready.activeOwner }),
      ),
    );
    const secondaryLoginCountBefore = toBigIntValue(
      await runStep(
        "secondaryConsumer.get_gated_login_count (before)",
        async () =>
          await ready.secondaryConsumer.methods.get_gated_login_count().simulate({ from: ready.activeOwner }),
      ),
    );

    const loginArgs = [
      { credential_type: ready.credentialType, constraints: ready.constraints },
      ready.hintedCredential,
      ready.hintedStatus,
      ready.minAgeProven,
      ready.nationalityPacked,
      0,
    ] as const;

    const consumerGateTx = await runStep(
      "consumer.login_with_magna",
      async () => await ready.consumer.methods.login_with_magna(...loginArgs).send({ from: ready.activeOwner }),
    );
    const secondaryConsumerGateTx = await runStep(
      "secondaryConsumer.login_with_magna",
      async () => await ready.secondaryConsumer.methods.login_with_magna(...loginArgs).send({ from: ready.activeOwner }),
    );
    await expect(
      runStep(
        "unregisteredConsumer.login_with_magna rejects",
        async () => await ready.unregisteredConsumer.methods.login_with_magna(...loginArgs).send({ from: ready.activeOwner }),
      ),
    ).rejects.toThrow(/consumer only/);

    const loginCountAfter = toBigIntValue(
      await runStep(
        "consumer.get_gated_login_count (after)",
        async () =>
          await ready.consumer.methods.get_gated_login_count().simulate({ from: ready.activeOwner }),
      ),
    );
    const secondaryLoginCountAfter = toBigIntValue(
      await runStep(
        "secondaryConsumer.get_gated_login_count (after)",
        async () =>
          await ready.secondaryConsumer.methods.get_gated_login_count().simulate({ from: ready.activeOwner }),
      ),
    );
    expect(loginCountAfter).toEqual(loginCountBefore + 1n);
    expect(secondaryLoginCountAfter).toEqual(secondaryLoginCountBefore + 1n);
    const consumerGateTxHash = logTxReceipt("consumer_login_with_magna", consumerGateTx);
    const secondaryConsumerGateTxHash = logTxReceipt("secondary_consumer_login_with_magna", secondaryConsumerGateTx);
    ready.txHashesByPhase.consumer_gate = [consumerGateTxHash, secondaryConsumerGateTxHash];
    logTrace(
      "passed.registered consumer gateways accept Magna-compatible claims.tx_ids",
      ready.txHashesByPhase.consumer_gate,
    );
  }, 120_000);

  it("rejects recover when called by wrong caller", async () => {
    const ready = requireHintedContext(ctx);
    await expect(
      runStep(
        "recover wrong caller (active owner)",
        async () =>
          await ready.issuer.methods
            .recover(ready.hintedRecovery, ready.newActiveOwner, true)
            .send({ from: ready.activeOwner }),
      ),
    ).rejects.toBeDefined();
    ready.txHashesByPhase.adversarial_wrong_recover_caller = [];
    logTrace(
      "passed.rejects recover when called by wrong caller.tx_ids",
      ready.txHashesByPhase.adversarial_wrong_recover_caller,
    );
  }, 90_000);

  it("rejects verify when called by wrong caller", async () => {
    const ready = requireHintedContext(ctx);
    await expect(
      runStep(
        "verify wrong caller (ghost owner)",
        async () =>
          await ready.issuer.methods
            .verify(
              { credential_type: ready.credentialType, constraints: ready.constraints },
              ready.hintedCredential,
              ready.hintedStatus,
              ready.minAgeProven,
              ready.nationalityPacked,
              0,
            )
            .simulate({ from: ready.ghostOwner }),
      ),
    ).rejects.toBeDefined();
    ready.txHashesByPhase.adversarial_wrong_verify_caller = [];
    logTrace(
      "passed.rejects verify when called by wrong caller.tx_ids",
      ready.txHashesByPhase.adversarial_wrong_verify_caller,
    );
  }, 90_000);

  it("recovers and invalidates old status note", async () => {
    const ready = requireHintedContext(ctx);
    const expectedKillSwitchInner = computeRevocationNullifier(
      ready.hintedRecovery.note.revocation_secret,
      ready.hintedRecovery.note.credential_type,
      ready.hintedRecovery.note.claims_hash,
    );
    const expectedKillSwitchSiloed = (
      await runStep("silo expected kill-switch nullifier", async () =>
        await siloNullifier(ready.issuer.address, new Fr(expectedKillSwitchInner)),
      )
    ).toBigInt();

    const recoverTx = await runStep(
      "recover",
      async () =>
        await ready.issuer.methods
          .recover(ready.hintedRecovery, ready.newActiveOwner, true)
          .send({ from: ready.ghostOwner }),
    );
    const recoverTxHash = logTxReceipt("recover", recoverTx);
    const recoverTxEffect = await runStep(
      "node.getTxEffect(recover)",
      async () => await ready.node.getTxEffect(getTxHash(recoverTx)),
    );
    expect(recoverTxEffect).toBeDefined();

    const emittedNullifiers = (recoverTxEffect?.data.nullifiers ?? []).map(value =>
      value.toBigInt(),
    );
    logTrace("recover_tx_effect.nullifiers", {
      expected_inner_kill_switch_nullifier: expectedKillSwitchInner,
      expected_siloed_kill_switch_nullifier: expectedKillSwitchSiloed,
      emitted_nullifiers: emittedNullifiers,
    });
    expect(emittedNullifiers).toContain(expectedKillSwitchSiloed);

    const killSwitchWitness = await runStep(
      "node.getNullifierMembershipWitness(expected siloed kill-switch)",
      async () =>
        await ready.node.getNullifierMembershipWitness("latest", new Fr(expectedKillSwitchSiloed)),
    );
    expect(killSwitchWitness).toBeDefined();

    const recoveredCredential = (await runStep(
      "get_recovered_credential_hinted",
      async () =>
        await ready.issuer.methods
          .get_credential_hinted(ready.newActiveOwner, ready.claimsHash)
          .simulate({ from: ready.newActiveOwner }),
    )) as HintedCredential;
    const recoveredStatus = (await runStep(
      "get_recovered_status_hinted",
      async () =>
        await ready.issuer.methods
          .get_status_hinted(ready.newActiveOwner, ready.claimsHash)
          .simulate({ from: ready.newActiveOwner }),
    )) as HintedStatus;
    // Contract keeps recovery ownership at ghost owner after rotation.
    const rotatedRecovery = (await runStep(
      "get_rotated_recovery_hinted",
      async () =>
        await ready.issuer.methods
          .get_recovery_hinted(ready.ghostOwner, ready.claimsHash)
          .simulate({ from: ready.ghostOwner }),
    )) as HintedRecovery;

    const recoveredStatusNullifier = computeRevocationNullifier(
      recoveredStatus.note.revocation_secret,
      recoveredStatus.note.credential_type,
      recoveredStatus.note.claims_hash,
    );
    logTrace("recovered_notes_and_calculated_nullifier", {
      recovered_credential_note: recoveredCredential.note,
      recovered_status_note: recoveredStatus.note,
      rotated_recovery_note: rotatedRecovery.note,
      calculated_nullifier: {
        recovered_status_revocation_nullifier: recoveredStatusNullifier,
        expected_recovery_kill_switch_inner: expectedKillSwitchInner,
        expected_recovery_kill_switch_siloed: expectedKillSwitchSiloed,
      },
    });

    await expect(
      ready.issuer.methods
        .verify(
          { credential_type: ready.credentialType, constraints: ready.constraints },
          ready.hintedCredential,
          ready.hintedStatus,
          ready.minAgeProven,
          ready.nationalityPacked,
          0,
        )
        .simulate({ from: ready.activeOwner }),
    ).rejects.toBeDefined();

    ready.txHashesByPhase.recover_and_invalidate = [recoverTxHash];
    logTrace(
      "passed.recovers and invalidates old status note.tx_ids",
      ready.txHashesByPhase.recover_and_invalidate,
    );
  }, 120_000);

  it("rejects replay of old hinted status after recovery", async () => {
    const ready = requireHintedContext(ctx);
    await expect(
      runStep(
        "verify old hinted status after recovery",
        async () =>
          await ready.issuer.methods
            .verify(
              { credential_type: ready.credentialType, constraints: ready.constraints },
              ready.hintedCredential,
              ready.hintedStatus,
              ready.minAgeProven,
              ready.nationalityPacked,
              0,
            )
            .send({ from: ready.activeOwner }),
      ),
    ).rejects.toBeDefined();
    ready.txHashesByPhase.adversarial_replay_old_status = [];
    logTrace(
      "passed.rejects replay of old hinted status after recovery.tx_ids",
      ready.txHashesByPhase.adversarial_replay_old_status,
    );
  }, 90_000);

  it("rejects double-recover attempt with consumed recovery note", async () => {
    const ready = requireHintedContext(ctx);
    await expect(
      runStep(
        "recover replay",
        async () =>
          await ready.issuer.methods
            .recover(ready.hintedRecovery, ready.newActiveOwner, true)
            .send({ from: ready.ghostOwner }),
      ),
    ).rejects.toBeDefined();
    ready.txHashesByPhase.adversarial_double_recover = [];
    logTrace(
      "passed.rejects double-recover attempt with consumed recovery note.tx_ids",
      ready.txHashesByPhase.adversarial_double_recover,
    );
  }, 120_000);

  it("rejects verify when credential scope is already expired", async () => {
    const ready = requireContext(ctx);
    const expiredExpiryTs = 1n;
    const expiredClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      ready.nationalityPacked,
      ready.minAgeProven,
      expiredExpiryTs,
    );
    const registerExpiredTx = await runStep(
      "register_credential(expired scope)",
      async () =>
        await ready.issuer.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            expiredClaimsHash,
            ready.credentialType,
            expiredExpiryTs,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerExpiredTxHash = logTxReceipt("register_credential_expired_scope", registerExpiredTx);
    const expiredCredential = (await runStep(
      "get_credential_hinted(expired scope)",
      async () =>
        await ready.issuer.methods
          .get_credential_hinted(ready.activeOwner, expiredClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedCredential;
    const expiredStatus = (await runStep(
      "get_status_hinted(expired scope)",
      async () =>
        await ready.issuer.methods
          .get_status_hinted(ready.activeOwner, expiredClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedStatus;

    await expect(
      runStep(
        "verify expired scope",
        async () =>
          await ready.issuer.methods
            .verify(
              { credential_type: ready.credentialType, constraints: buildConstraintsWithoutExpiry() },
              expiredCredential,
              expiredStatus,
              ready.minAgeProven,
              ready.nationalityPacked,
              0,
            )
            .send({ from: ready.activeOwner }),
      ),
    ).rejects.toBeDefined();
    ready.txHashesByPhase.expiry_negative = [registerExpiredTxHash];
    logTrace("passed.rejects verify when credential scope is already expired.tx_ids", ready.txHashesByPhase.expiry_negative);
  }, 120_000);

  it("returns one hinted note under duplicate scope (set_limit(1) semantics)", async () => {
    const ready = requireContext(ctx);
    const duplicateNationality = packAlpha3("FRA");
    const duplicateMinAge = 25;
    const duplicateExpiryTs = 1_993_456_000n;
    const duplicateClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      duplicateNationality,
      duplicateMinAge,
      duplicateExpiryTs,
    );

    const registerDuplicate1 = await runStep(
      "register_credential(duplicate scope #1)",
      async () =>
        await ready.issuer.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            duplicateClaimsHash,
            ready.credentialType,
            duplicateExpiryTs,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerDuplicate2 = await runStep(
      "register_credential(duplicate scope #2)",
      async () =>
        await ready.issuer.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            duplicateClaimsHash,
            ready.credentialType,
            duplicateExpiryTs,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerDuplicateTxHash1 = logTxReceipt("register_credential_duplicate_scope_1", registerDuplicate1);
    const registerDuplicateTxHash2 = logTxReceipt("register_credential_duplicate_scope_2", registerDuplicate2);

    const duplicateCredential = (await runStep(
      "get_credential_hinted(duplicate scope)",
      async () =>
        await ready.issuer.methods
          .get_credential_hinted(ready.activeOwner, duplicateClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedCredential;
    const duplicateStatus = (await runStep(
      "get_status_hinted(duplicate scope)",
      async () =>
        await ready.issuer.methods
          .get_status_hinted(ready.activeOwner, duplicateClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedStatus;
    const duplicateRecovery = (await runStep(
      "get_recovery_hinted(duplicate scope)",
      async () =>
        await ready.issuer.methods
          .get_recovery_hinted(ready.ghostOwner, duplicateClaimsHash)
          .simulate({ from: ready.ghostOwner }),
    )) as HintedRecovery;
    expect(duplicateCredential.note.claims_hash).toEqual(duplicateClaimsHash);
    expect(duplicateStatus.note.claims_hash).toEqual(duplicateClaimsHash);
    expect(duplicateRecovery.note.claims_hash).toEqual(duplicateClaimsHash);

    const duplicateVerifyTx = await runStep(
      "verify duplicate scope",
      async () =>
        await ready.issuer.methods
          .verify(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            duplicateCredential,
            duplicateStatus,
            duplicateMinAge,
            duplicateNationality,
            0,
          )
          .send({ from: ready.activeOwner }),
    );
    const duplicateVerifyTxHash = logTxReceipt("verify_duplicate_scope", duplicateVerifyTx);
    ready.txHashesByPhase.duplicate_scope = [
      registerDuplicateTxHash1,
      registerDuplicateTxHash2,
      duplicateVerifyTxHash,
    ];
    logTrace(
      "passed.returns one hinted note under duplicate scope (set_limit(1) semantics).tx_ids",
      ready.txHashesByPhase.duplicate_scope,
    );
  }, 180_000);

  it("supports linked root verify and disables it after root recovery", async () => {
    const ready = requireContext(ctx);
    const rootCommitment = 999n;
    const linkedMinAge = 27;
    const linkedNationality = packAlpha3("FRA");
    const linkedExpiryTs = 2_093_456_000n;
    const linkedClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      linkedNationality,
      linkedMinAge,
      linkedExpiryTs,
    );

    const registerRootTx = await runStep("register_rooted_passport(linked root scope)", async () => {
      return await ready.issuer.methods
        .register_rooted_passport(
          ready.activeOwner,
          ready.ghostOwner,
          rootCommitment,
          linkedClaimsHash,
          linkedExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerRootTxHash = logTxReceipt("register_rooted_passport_linked_scope", registerRootTx);

    const hintedRootStatus = (await runStep("get_root_status_hinted(linked root scope)", async () => {
      return await ready.issuer.methods
        .get_root_status_hinted(ready.activeOwner, rootCommitment)
        .simulate({ from: ready.activeOwner });
    })) as HintedRootStatus;
    const hintedRootAuthority = (await runStep("get_root_authority_hinted(linked root scope)", async () => {
      return await ready.issuer.methods
        .get_root_authority_hinted(ready.activeOwner, rootCommitment, linkedClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedRootAuthority;
    const hintedRootRecovery = (await runStep("get_root_recovery_hinted(linked root scope)", async () => {
      return await ready.issuer.methods
        .get_root_recovery_hinted(ready.ghostOwner, rootCommitment)
        .simulate({ from: ready.ghostOwner });
    })) as HintedRootRecovery;
    const hintedLinkedCredential = (await runStep(
      "get_linked_credential_hinted(linked root scope)",
      async () => {
        return await ready.issuer.methods
          .get_linked_credential_hinted(ready.activeOwner, rootCommitment, linkedClaimsHash)
          .simulate({ from: ready.activeOwner });
      },
    )) as HintedLinkedCredential;
    const hintedLinkedStatus = (await runStep("get_linked_status_hinted(linked root scope)", async () => {
      return await ready.issuer.methods
        .get_linked_status_hinted(ready.activeOwner, rootCommitment, linkedClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedLinkedStatus;

    const linkedVerifyTx = await runStep("verify_linked(linked root scope)", async () => {
      return await ready.issuer.methods
        .verify_linked(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          hintedRootStatus,
          hintedRootAuthority,
          hintedLinkedCredential,
          hintedLinkedStatus,
          linkedMinAge,
          linkedNationality,
          0,
        )
        .send({ from: ready.activeOwner });
    });
    const linkedVerifyTxHash = logTxReceipt("verify_linked_root_scope", linkedVerifyTx);

    const rootRecoverTx = await runStep("recover_root(linked root scope)", async () => {
      return await ready.issuer.methods
        .recover_root(hintedRootRecovery, ready.newActiveOwner)
        .send({ from: ready.ghostOwner });
    });
    const rootRecoverTxHash = logTxReceipt("recover_root_linked_scope", rootRecoverTx);

    const rotatedRootStatus = (await runStep("get_root_status_hinted(rotated linked root scope)", async () => {
      return await ready.issuer.methods
        .get_root_status_hinted(ready.newActiveOwner, rootCommitment)
        .simulate({ from: ready.newActiveOwner });
    })) as HintedRootStatus;
    expect(toBigIntValue(rotatedRootStatus.note.root_commitment)).toEqual(rootCommitment);

    await expect(
      runStep("verify_linked(linked root scope) [should fail after root recovery]", async () => {
        return await ready.issuer.methods
          .verify_linked(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            hintedRootStatus,
            hintedRootAuthority,
            hintedLinkedCredential,
            hintedLinkedStatus,
            linkedMinAge,
            linkedNationality,
            0,
          )
          .send({ from: ready.activeOwner });
      }),
    ).rejects.toBeDefined();

    ready.txHashesByPhase.root_linked = [
      registerRootTxHash,
      linkedVerifyTxHash,
      rootRecoverTxHash,
    ];
    logTrace(
      "passed.supports linked root verify and disables it after root recovery.tx_ids",
      ready.txHashesByPhase.root_linked,
    );
  }, 240_000);

  it("allows rooted lineage to be re-issued after root recovery using fresh hints", async () => {
    const ready = requireContext(ctx);
    const rootCommitment = 1_010_101n;
    const initialExpiryTs = 2_193_456_000n;
    const initialClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      packAlpha3("FRA"),
      27,
      initialExpiryTs,
    );
    const reissuedMinAge = 29;
    const reissuedNationality = packAlpha3("DEU");
    const reissuedExpiryTs = 2_293_456_000n;
    const reissuedClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      reissuedNationality,
      reissuedMinAge,
      reissuedExpiryTs,
    );

    const registerRootedTx = await runStep("register_rooted_passport(root recovery reissue scope)", async () => {
      return await ready.issuer.methods
        .register_rooted_passport(
          ready.activeOwner,
          ready.ghostOwner,
          rootCommitment,
          initialClaimsHash,
          initialExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerRootedTxHash = logTxReceipt("register_rooted_passport_root_recovery_reissue_scope", registerRootedTx);

    const hintedRootRecovery = (await runStep("get_root_recovery_hinted(root recovery reissue scope)", async () => {
      return await ready.issuer.methods
        .get_root_recovery_hinted(ready.ghostOwner, rootCommitment)
        .simulate({ from: ready.ghostOwner });
    })) as HintedRootRecovery;

    const rootRecoverTx = await runStep("recover_root(root recovery reissue scope)", async () => {
      return await ready.issuer.methods
        .recover_root(hintedRootRecovery, ready.newActiveOwner)
        .send({ from: ready.ghostOwner });
    });
    const rootRecoverTxHash = logTxReceipt("recover_root_root_recovery_reissue_scope", rootRecoverTx);

    const rotatedRootStatus = (await runStep("get_root_status_hinted(rotated root recovery reissue scope)", async () => {
      return await ready.issuer.methods
        .get_root_status_hinted(ready.newActiveOwner, rootCommitment)
        .simulate({ from: ready.newActiveOwner });
    })) as HintedRootStatus;
    const rotatedRootRecovery = (await runStep("get_root_recovery_hinted(rotated root recovery reissue scope)", async () => {
      return await ready.issuer.methods
        .get_root_recovery_hinted(ready.ghostOwner, rootCommitment)
        .simulate({ from: ready.ghostOwner });
    })) as HintedRootRecovery;
    expect(toBigIntValue(rotatedRootStatus.note.root_commitment)).toEqual(rootCommitment);
    expect(toBigIntValue(rotatedRootRecovery.note.root_commitment)).toEqual(rootCommitment);

    await expect(
      runStep("get_root_authority_hinted(rotated root recovery reissue scope) [should fail pre-reissue]", async () => {
        return await ready.issuer.methods
          .get_root_authority_hinted(ready.newActiveOwner, rootCommitment, initialClaimsHash)
          .simulate({ from: ready.newActiveOwner });
      }),
    ).rejects.toBeDefined();

    const reissueAuthorityTx = await runStep("register_root_authority(root recovery reissue scope)", async () => {
      return await ready.issuer.methods
        .register_root_authority(ready.newActiveOwner, rootCommitment, reissuedClaimsHash, reissuedExpiryTs)
        .send({ from: ready.orchestrator });
    });
    const reissueAuthorityTxHash = logTxReceipt(
      "register_root_authority_root_recovery_reissue_scope",
      reissueAuthorityTx,
    );

    const reissueLinkedTx = await runStep("register_linked_credential(root recovery reissue scope)", async () => {
      return await ready.issuer.methods
        .register_linked_credential(
          ready.newActiveOwner,
          ready.ghostOwner,
          rootCommitment,
          reissuedClaimsHash,
          ready.credentialType,
          reissuedExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const reissueLinkedTxHash = logTxReceipt("register_linked_credential_root_recovery_reissue_scope", reissueLinkedTx);

    const reissuedRootAuthority = (await runStep(
      "get_root_authority_hinted(reissued root recovery reissue scope)",
      async () =>
        await ready.issuer.methods
          .get_root_authority_hinted(ready.newActiveOwner, rootCommitment, reissuedClaimsHash)
          .simulate({ from: ready.newActiveOwner }),
    )) as HintedRootAuthority;
    const reissuedLinkedCredential = (await runStep(
      "get_linked_credential_hinted(reissued root recovery reissue scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_credential_hinted(ready.newActiveOwner, rootCommitment, reissuedClaimsHash)
          .simulate({ from: ready.newActiveOwner }),
    )) as HintedLinkedCredential;
    const reissuedLinkedStatus = (await runStep(
      "get_linked_status_hinted(reissued root recovery reissue scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_status_hinted(ready.newActiveOwner, rootCommitment, reissuedClaimsHash)
          .simulate({ from: ready.newActiveOwner }),
    )) as HintedLinkedStatus;

    await runStep("verify_linked(root recovery reissue scope after reissue)", async () => {
      await ready.issuer.methods
        .verify_linked(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          rotatedRootStatus,
          reissuedRootAuthority,
          reissuedLinkedCredential,
          reissuedLinkedStatus,
          reissuedMinAge,
          reissuedNationality,
          0,
        )
        .simulate({ from: ready.newActiveOwner });
    });

    ready.txHashesByPhase.root_linked_reissue_after_recovery = [
      registerRootedTxHash,
      rootRecoverTxHash,
      reissueAuthorityTxHash,
      reissueLinkedTxHash,
    ];
    logTrace(
      "passed.allows rooted lineage to be re-issued after root recovery using fresh hints.tx_ids",
      ready.txHashesByPhase.root_linked_reissue_after_recovery,
    );
  }, 240_000);

  it("supports linked company sponsor gateway verify path for instagram ownership", async () => {
    const ready = requireContext(ctx);
    const instagramCredentialType = 3;
    const instagramHandleHash = computeInstagramHandleHash("denemedeneme581");
    const instagramExpiryTs = 2_393_456_000n;
    const instagramClaimsHash = computeInstagramClaimsHash(
      {
        schemaVersion: 1,
        credentialType: CredentialType.Instagram,
        handleHash: instagramHandleHash,
        expiryTs: instagramExpiryTs,
      },
      poseidon2FieldHasher,
    );
    const rootCommitment = 555_555n;
    const authorityClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      packAlpha3("CAN"),
      21,
      instagramExpiryTs,
    );

    const registerRootTx = await runStep("register_root(instagram linked sponsor scope)", async () => {
      return await ready.issuer.methods
        .register_root(ready.activeOwner, ready.ghostOwner, rootCommitment)
        .send({ from: ready.orchestrator });
    });
    const registerRootTxHash = logTxReceipt("register_root_instagram_linked_company_sponsor_scope", registerRootTx);

    const registerRootAuthorityTx = await runStep(
      "register_root_authority(instagram linked sponsor scope)",
      async () =>
        await ready.issuer.methods
          .register_root_authority(
            ready.activeOwner,
            rootCommitment,
            authorityClaimsHash,
            instagramExpiryTs,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerRootAuthorityTxHash = logTxReceipt(
      "register_root_authority_instagram_linked_company_sponsor_scope",
      registerRootAuthorityTx,
    );

    const registerLinkedTx = await runStep("register_linked_credential(instagram linked sponsor scope)", async () => {
      return await ready.issuer.methods
        .register_linked_credential(
          ready.activeOwner,
          ready.ghostOwner,
          rootCommitment,
          instagramClaimsHash,
          instagramCredentialType,
          instagramExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerLinkedTxHash = logTxReceipt(
      "register_linked_credential_instagram_linked_company_sponsor_scope",
      registerLinkedTx,
    );

    const hintedRootStatus = (await runStep(
      "get_root_status_hinted(instagram linked sponsor scope)",
      async () =>
        await ready.issuer.methods
          .get_root_status_hinted(ready.activeOwner, rootCommitment)
          .simulate({ from: ready.activeOwner }),
    )) as HintedRootStatus;
    const hintedRootAuthority = (await runStep(
      "get_root_authority_hinted(instagram linked sponsor scope)",
      async () =>
        await ready.issuer.methods
          .get_root_authority_hinted(ready.activeOwner, rootCommitment, authorityClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedRootAuthority;
    const hintedLinkedCredential = (await runStep(
      "get_linked_credential_hinted(instagram linked sponsor scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_credential_hinted(ready.activeOwner, rootCommitment, instagramClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedLinkedCredential;
    const hintedLinkedStatus = (await runStep(
      "get_linked_status_hinted(instagram linked sponsor scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_status_hinted(ready.activeOwner, rootCommitment, instagramClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedLinkedStatus;

    const { sponsorClaimTxHash, balanceAfterClaim } = await ensureCompanySponsorFeeJuice(ready);
    expect(balanceAfterClaim).toBeGreaterThan(0n);

    const issuerMeterBefore = toBigIntValue(
      await runStep("issuer.get_verify_meter_count (before linked instagram sponsor verify)", async () => {
        return await ready.issuer.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorMeterBefore = toBigIntValue(
      await runStep("companySponsor.get_sponsored_verify_count (before linked instagram sponsor verify)", async () => {
        return await ready.companySponsor.methods
          .get_sponsored_verify_count()
          .simulate({ from: ready.activeOwner });
      }),
    );

    const sponsorVerifyTx = await runRetriedStep("companySponsor.sponsored_verify_linked_instagram", async () => {
      return await ready.companySponsor.methods
        .sponsored_verify_linked_instagram(
          { credential_type: instagramCredentialType, constraints: buildInstagramConstraints(instagramHandleHash) },
          hintedRootStatus,
          hintedRootAuthority,
          hintedLinkedCredential,
          hintedLinkedStatus,
          instagramHandleHash,
          0,
        )
        .send({
          from: ready.activeOwner,
          fee: buildCompanySponsorFeeOptions(ready.companySponsor.address),
        });
    });
    const sponsorVerifyTxHash = logTxReceipt("company_sponsor_verify_linked_instagram", sponsorVerifyTx);

    const issuerMeterAfter = toBigIntValue(
      await runStep("issuer.get_verify_meter_count (after linked instagram sponsor verify)", async () => {
        return await ready.issuer.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorMeterAfter = toBigIntValue(
      await runStep("companySponsor.get_sponsored_verify_count (after linked instagram sponsor verify)", async () => {
        return await ready.companySponsor.methods
          .get_sponsored_verify_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(issuerMeterAfter).toEqual(issuerMeterBefore + 1n);
    expect(sponsorMeterAfter).toEqual(sponsorMeterBefore + 1n);

    ready.txHashesByPhase.instagram_linked_company_sponsor = sponsorClaimTxHash
      ? [registerRootTxHash, registerRootAuthorityTxHash, registerLinkedTxHash, sponsorClaimTxHash, sponsorVerifyTxHash]
      : [registerRootTxHash, registerRootAuthorityTxHash, registerLinkedTxHash, sponsorVerifyTxHash];
    logTrace(
      "passed.supports linked company sponsor gateway verify path for instagram ownership.tx_ids",
      ready.txHashesByPhase.instagram_linked_company_sponsor,
    );
  }, 240_000);

  it("rejects linked instagram verify when rooted passport authority has expired", async () => {
    const ready = requireContext(ctx);
    const expiredAuthorityOwnerDeployment = await createAndDeploySchnorrAccount(
      ready.wallet,
      ready.orchestrator,
      "instagram-authority-expiry-owner",
    );
    const expiredAuthorityOwner = expiredAuthorityOwnerDeployment.address;
    const expiredAuthorityOwnerDeployTxHash = logTxReceipt(
      "deploy_instagram_authority_expiry_owner",
      expiredAuthorityOwnerDeployment.deployTx,
    );
    const instagramCredentialType = 3;
    const instagramHandleHash = computeInstagramHandleHash("expiredauthority581");
    const instagramExpiryTs = 2_393_456_000n;
    const instagramClaimsHash = computeInstagramClaimsHash(
      {
        schemaVersion: 1,
        credentialType: CredentialType.Instagram,
        handleHash: instagramHandleHash,
        expiryTs: instagramExpiryTs,
      },
      poseidon2FieldHasher,
    );
    const rootCommitment = 666_666n;
    const expiredAuthorityExpiryTs = 1n;
    const authorityClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      packAlpha3("CAN"),
      21,
      expiredAuthorityExpiryTs,
    );

    const registerRootTx = await runStep("register_root(instagram authority expiry scope)", async () => {
      return await ready.issuer.methods
        .register_root(expiredAuthorityOwner, ready.ghostOwner, rootCommitment)
        .send({ from: ready.orchestrator });
    });
    const registerRootTxHash = logTxReceipt("register_root_instagram_authority_expiry_scope", registerRootTx);

    const registerRootAuthorityTx = await runStep(
      "register_root_authority(instagram authority expiry scope)",
      async () =>
        await ready.issuer.methods
          .register_root_authority(
            expiredAuthorityOwner,
            rootCommitment,
            authorityClaimsHash,
            expiredAuthorityExpiryTs,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerRootAuthorityTxHash = logTxReceipt(
      "register_root_authority_instagram_authority_expiry_scope",
      registerRootAuthorityTx,
    );

    const registerLinkedTx = await runStep("register_linked_credential(instagram authority expiry scope)", async () => {
      return await ready.issuer.methods
        .register_linked_credential(
          expiredAuthorityOwner,
          ready.ghostOwner,
          rootCommitment,
          instagramClaimsHash,
          instagramCredentialType,
          instagramExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerLinkedTxHash = logTxReceipt(
      "register_linked_credential_instagram_authority_expiry_scope",
      registerLinkedTx,
    );

    const hintedRootStatus = (await runStep(
      "get_root_status_hinted(instagram authority expiry scope)",
      async () =>
        await ready.issuer.methods
          .get_root_status_hinted(expiredAuthorityOwner, rootCommitment)
          .simulate({ from: expiredAuthorityOwner }),
    )) as HintedRootStatus;
    const hintedRootAuthority = (await runStep(
      "get_root_authority_hinted(instagram authority expiry scope)",
      async () =>
        await ready.issuer.methods
          .get_root_authority_hinted(expiredAuthorityOwner, rootCommitment, authorityClaimsHash)
          .simulate({ from: expiredAuthorityOwner }),
    )) as HintedRootAuthority;
    const hintedLinkedCredential = (await runStep(
      "get_linked_credential_hinted(instagram authority expiry scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_credential_hinted(expiredAuthorityOwner, rootCommitment, instagramClaimsHash)
          .simulate({ from: expiredAuthorityOwner }),
    )) as HintedLinkedCredential;
    const hintedLinkedStatus = (await runStep(
      "get_linked_status_hinted(instagram authority expiry scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_status_hinted(expiredAuthorityOwner, rootCommitment, instagramClaimsHash)
          .simulate({ from: expiredAuthorityOwner }),
    )) as HintedLinkedStatus;

    await expect(
      runStep("verify_linked_instagram [should fail after authority expiry]", async () => {
        return await ready.issuer.methods
          .verify_linked_instagram(
            { credential_type: instagramCredentialType, constraints: buildInstagramConstraints(instagramHandleHash) },
            hintedRootStatus,
            hintedRootAuthority,
            hintedLinkedCredential,
            hintedLinkedStatus,
            instagramHandleHash,
            0,
          )
          .send({ from: expiredAuthorityOwner });
      }),
    ).rejects.toBeDefined();

    ready.txHashesByPhase.instagram_authority_expiry = [
      expiredAuthorityOwnerDeployTxHash,
      registerRootTxHash,
      registerRootAuthorityTxHash,
      registerLinkedTxHash,
    ];
    logTrace(
      "passed.rejects linked instagram verify when rooted passport authority has expired.tx_ids",
      ready.txHashesByPhase.instagram_authority_expiry,
    );
  }, 240_000);

  it("refreshes rooted passport authority and keeps linked instagram valid", async () => {
    const ready = requireContext(ctx);
    const rootOwner = ready.ghostOwner;
    const recoveryOwner = ready.newActiveOwner;
    const instagramCredentialType = 3;
    const instagramHandleHash = computeInstagramHandleHash("renewauthority581");
    const instagramExpiryTs = 2_393_456_000n;
    const refreshedAuthorityExpiryTs = 2_493_456_000n;
    const instagramClaimsHash = computeInstagramClaimsHash(
      {
        schemaVersion: 1,
        credentialType: CredentialType.Instagram,
        handleHash: instagramHandleHash,
        expiryTs: instagramExpiryTs,
      },
      poseidon2FieldHasher,
    );
    const rootCommitment = 777_777n;
    const initialAuthorityClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      packAlpha3("CAN"),
      21,
      instagramExpiryTs,
    );
    const refreshedAuthorityClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      packAlpha3("CAN"),
      22,
      refreshedAuthorityExpiryTs,
    );

    const registerRootTx = await runStep("register_root(instagram authority refresh scope)", async () => {
      return await ready.issuer.methods
        .register_root(rootOwner, recoveryOwner, rootCommitment)
        .send({ from: ready.orchestrator });
    });
    const registerRootTxHash = logTxReceipt("register_root_instagram_authority_refresh_scope", registerRootTx);

    const registerRootAuthorityTx = await runStep(
      "register_root_authority(instagram authority refresh scope)",
      async () =>
        await ready.issuer.methods
          .register_root_authority(
            rootOwner,
            rootCommitment,
            initialAuthorityClaimsHash,
            instagramExpiryTs,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerRootAuthorityTxHash = logTxReceipt(
      "register_root_authority_instagram_authority_refresh_scope",
      registerRootAuthorityTx,
    );

    const registerLinkedTx = await runStep("register_linked_credential(instagram authority refresh scope)", async () => {
      return await ready.issuer.methods
        .register_linked_credential(
          rootOwner,
          recoveryOwner,
          rootCommitment,
          instagramClaimsHash,
          instagramCredentialType,
          instagramExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerLinkedTxHash = logTxReceipt(
      "register_linked_credential_instagram_authority_refresh_scope",
      registerLinkedTx,
    );

    const hintedRootStatus = (await runStep(
      "get_root_status_hinted(instagram authority refresh scope)",
      async () =>
        await ready.issuer.methods
          .get_root_status_hinted(rootOwner, rootCommitment)
          .simulate({ from: rootOwner }),
    )) as HintedRootStatus;
    const hintedRootAuthority = (await runStep(
      "get_root_authority_hinted(instagram authority refresh scope)",
      async () =>
        await ready.issuer.methods
          .get_root_authority_hinted(rootOwner, rootCommitment, initialAuthorityClaimsHash)
          .simulate({ from: rootOwner }),
    )) as HintedRootAuthority;
    const hintedLinkedCredential = (await runStep(
      "get_linked_credential_hinted(instagram authority refresh scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_credential_hinted(rootOwner, rootCommitment, instagramClaimsHash)
          .simulate({ from: rootOwner }),
    )) as HintedLinkedCredential;
    const hintedLinkedStatus = (await runStep(
      "get_linked_status_hinted(instagram authority refresh scope)",
      async () =>
        await ready.issuer.methods
          .get_linked_status_hinted(rootOwner, rootCommitment, instagramClaimsHash)
          .simulate({ from: rootOwner }),
    )) as HintedLinkedStatus;

    const initialVerifyTx = await runStep("verify_linked_instagram(before authority refresh)", async () => {
      return await ready.issuer.methods
        .verify_linked_instagram(
          { credential_type: instagramCredentialType, constraints: buildInstagramConstraints(instagramHandleHash) },
          hintedRootStatus,
          hintedRootAuthority,
          hintedLinkedCredential,
          hintedLinkedStatus,
          instagramHandleHash,
          0,
        )
        .send({ from: rootOwner });
    });
    const initialVerifyTxHash = logTxReceipt("verify_linked_instagram_before_authority_refresh", initialVerifyTx);

    const refreshAuthorityTx = await runStep("refresh_root_authority(instagram authority refresh scope)", async () => {
      return await ready.issuer.methods
        .refresh_root_authority(
          recoveryOwner,
          hintedRootStatus,
          hintedRootAuthority,
          refreshedAuthorityClaimsHash,
          refreshedAuthorityExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const refreshAuthorityTxHash = logTxReceipt(
      "refresh_root_authority_instagram_authority_refresh_scope",
      refreshAuthorityTx,
    );

    const refreshedRootAuthority = (await runStep(
      "get_root_authority_hinted(refreshed instagram authority scope)",
      async () =>
        await ready.issuer.methods
          .get_root_authority_hinted(rootOwner, rootCommitment, refreshedAuthorityClaimsHash)
          .simulate({ from: rootOwner }),
    )) as HintedRootAuthority;

    const refreshedVerifyTx = await runStep("verify_linked_instagram(after authority refresh)", async () => {
      return await ready.issuer.methods
        .verify_linked_instagram(
          { credential_type: instagramCredentialType, constraints: buildInstagramConstraints(instagramHandleHash) },
          hintedRootStatus,
          refreshedRootAuthority,
          hintedLinkedCredential,
          hintedLinkedStatus,
          instagramHandleHash,
          0,
        )
        .send({ from: rootOwner });
    });
    const refreshedVerifyTxHash = logTxReceipt("verify_linked_instagram_after_authority_refresh", refreshedVerifyTx);

    ready.txHashesByPhase.instagram_authority_refresh = [
      registerRootTxHash,
      registerRootAuthorityTxHash,
      registerLinkedTxHash,
      initialVerifyTxHash,
      refreshAuthorityTxHash,
      refreshedVerifyTxHash,
    ];
    logTrace(
      "passed.refreshes rooted passport authority and keeps linked instagram valid.tx_ids",
      ready.txHashesByPhase.instagram_authority_refresh,
    );
  }, 240_000);

  it("enforces delayed verify meter hook allowlist policy", async () => {
    const ready = requireContext(ctx);
    const delayedHookDeployReceipt = await runStep(
      "deploy fresh delayed MagnaVerifyMeterHook",
      async () =>
        await MagnaVerifyMeterHookContract.deploy(ready.wallet, ready.orchestrator, 0n).send({
          from: ready.orchestrator,
        }),
    );
    const delayedHook = delayedHookDeployReceipt.contract;
    const delayedHookDeployTxHash = logTxReceipt(
      "deploy_fresh_delayed_verify_meter_hook",
      delayedHookDeployReceipt,
    );
    const setDelayedHookIssuerReceipt = await runStep(
      "fresh delayed verifyMeterHook.set_issuer(orchestrator)",
      async () => await delayedHook.methods.set_issuer(ready.orchestrator).send({ from: ready.orchestrator }),
    );
    const setDelayedHookIssuerTxHash = logTxReceipt(
      "fresh_delayed_verify_meter_hook_set_issuer",
      setDelayedHookIssuerReceipt,
    );
    const scheduleAllowlistReceipt = await runStep(
      "fresh delayed verifyMeterHook.schedule_allowlist_mask(current credential type)",
      async () => await delayedHook.methods.schedule_allowlist_mask(1n << BigInt(ready.credentialType)).send({
        from: ready.orchestrator,
      }),
    );
    const scheduleAllowlistTxHash = logTxReceipt(
      "fresh_delayed_verify_meter_hook_schedule_allowlist",
      scheduleAllowlistReceipt,
    );

    const isAllowed = await runStep(
      "is_credential_type_allowed",
      async () =>
        await delayedHook.methods
          .is_credential_type_allowed(ready.credentialType)
          .simulate({ from: ready.orchestrator }),
    );

    // This fresh hook scheduled the allowlist in the current test, so the delayed
    // policy should not be active yet.
    expect(isAllowed).toBe(false);

    // Meter-only: even when allowlist hasn't become active yet, metering should not revert.
    await runStep("meter_verify_or_revert (simulate)", async () => {
      return await delayedHook.methods
        .meter_verify_or_revert(ready.credentialType)
        .simulate({ from: ready.orchestrator });
    });
    ready.txHashesByPhase.verify_meter_hook_policy = [
      delayedHookDeployTxHash,
      setDelayedHookIssuerTxHash,
      scheduleAllowlistTxHash,
    ];
    logTrace(
      "passed.enforces delayed verify meter hook allowlist policy.tx_ids",
      ready.txHashesByPhase.verify_meter_hook_policy,
    );
  }, 60_000);

  it("enforces positive verify meter hook sponsorship path with instant policy", async () => {
    const ready = requireContext(ctx);
    const sponsoredMinAge = 30;
    const sponsoredNationality = packAlpha3("BRA");
    const sponsoredExpiryTs = 2_093_456_000n;
    const sponsoredClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      sponsoredNationality,
      sponsoredMinAge,
      sponsoredExpiryTs,
    );

    const registerSponsoredTx = await runStep(
      "register_credential (instant verify-meter-hook issuer)",
      async () =>
        await ready.issuerWithInstantMeterHook.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            sponsoredClaimsHash,
            ready.credentialType,
            sponsoredExpiryTs,
          )
          .send({ from: ready.orchestrator }),
    );
    const registerSponsoredTxHash = logTxReceipt(
      "register_credential_instant_verify_meter_hook_issuer",
      registerSponsoredTx,
    );

    const sponsoredCredential = (await runStep(
      "get_credential_hinted (instant verify-meter-hook issuer)",
      async () =>
        await ready.issuerWithInstantMeterHook.methods
          .get_credential_hinted(ready.activeOwner, sponsoredClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedCredential;
    const sponsoredStatus = (await runStep(
      "get_status_hinted (instant verify-meter-hook issuer)",
      async () =>
        await ready.issuerWithInstantMeterHook.methods
          .get_status_hinted(ready.activeOwner, sponsoredClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedStatus;

    const issuerMeterBefore = toBigIntValue(
      await runStep(
        "issuerWithInstantMeterHook.get_verify_meter_count (before verify)",
        async () =>
          await ready.issuerWithInstantMeterHook.methods
            .get_verify_meter_count()
            .simulate({ from: ready.activeOwner }),
      ),
    );
    const verifyMeterHookMeterBefore = toBigIntValue(
      await runStep(
        "verifyMeterHookInstant.get_metered_verify_count (before verify)",
        async () =>
          await ready.verifyMeterHookInstant.methods
            .get_metered_verify_count()
            .simulate({ from: ready.orchestrator }),
      ),
    );

    const sponsoredVerifyTx = await runStep(
      "verify via issuerWithInstantMeterHook",
      async () =>
        await ready.issuerWithInstantMeterHook.methods
          .verify(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            sponsoredCredential,
            sponsoredStatus,
            sponsoredMinAge,
            sponsoredNationality,
            0,
          )
          .send({ from: ready.activeOwner }),
    );
    const sponsoredVerifyTxHash = logTxReceipt("verify_instant_verify_meter_hook_issuer", sponsoredVerifyTx);

    const issuerMeterAfter = toBigIntValue(
      await runStep(
        "issuerWithInstantMeterHook.get_verify_meter_count (after verify)",
        async () =>
          await ready.issuerWithInstantMeterHook.methods
            .get_verify_meter_count()
            .simulate({ from: ready.activeOwner }),
      ),
    );
    const verifyMeterHookMeterAfter = toBigIntValue(
      await runStep(
        "verifyMeterHookInstant.get_metered_verify_count (after verify)",
        async () =>
          await ready.verifyMeterHookInstant.methods
            .get_metered_verify_count()
            .simulate({ from: ready.orchestrator }),
      ),
    );
    expect(issuerMeterAfter).toEqual(issuerMeterBefore + 1n);
    expect(verifyMeterHookMeterAfter).toEqual(verifyMeterHookMeterBefore + 1n);

    ready.txHashesByPhase.verify_meter_hook_policy_positive = [registerSponsoredTxHash, sponsoredVerifyTxHash];
    logTrace(
      "passed.enforces positive verify meter hook sponsorship path with instant policy.tx_ids",
      ready.txHashesByPhase.verify_meter_hook_policy_positive,
    );
  }, 180_000);

  it("enforces sponsored verify rate-limit (5 per 24h window)", async () => {
    const ready = requireContext(ctx);

    const rlMinAge = 31;
    const rlNationality = packAlpha3("DEU");
    const rlExpiryTs = 2_193_456_000n;
    const rlClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      rlNationality,
      rlMinAge,
      rlExpiryTs,
    );

    const registerTx = await runStep("register_credential (rate-limit scope)", async () => {
      return await ready.issuerWithInstantMeterHook.methods
        .register_credential(
          ready.activeOwner,
          ready.ghostOwner,
          rlClaimsHash,
          ready.credentialType,
          rlExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerTxHash = logTxReceipt("register_credential_rate_limit_scope", registerTx);

    const hintedCredential = (await runStep("get_credential_hinted (rate-limit scope)", async () => {
      return await ready.issuerWithInstantMeterHook.methods
        .get_credential_hinted(ready.activeOwner, rlClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedCredential;
    const hintedStatus = (await runStep("get_status_hinted (rate-limit scope)", async () => {
      return await ready.issuerWithInstantMeterHook.methods
        .get_status_hinted(ready.activeOwner, rlClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedStatus;

    const issuerMeterBefore = toBigIntValue(
      await runStep("issuerWithInstantMeterHook.get_verify_meter_count (before rate-limit verifies)", async () => {
        return await ready.issuerWithInstantMeterHook.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );

    // 5 allowed verifies (slots 0..4)
    const verifyTxHashes: string[] = [];
    for (let slot = 0; slot < 5; slot++) {
      const tx = await runRetriedStep(`verify sponsored (slot=${slot})`, async () => {
        return await ready.issuerWithInstantMeterHook.methods
          .verify(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            hintedCredential,
            hintedStatus,
            rlMinAge,
            rlNationality,
            slot,
          )
          .send({ from: ready.activeOwner });
      });
      verifyTxHashes.push(logTxReceipt(`verify_rate_limit_slot_${slot}`, tx));
    }

    const issuerMeterAfter = toBigIntValue(
      await runStep("issuerWithInstantMeterHook.get_verify_meter_count (after 5 verifies)", async () => {
        return await ready.issuerWithInstantMeterHook.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(issuerMeterAfter).toEqual(issuerMeterBefore + 5n);

    // 6th attempt in same window must fail (reusing slot 0).
    await expect(
      runStep("verify sponsored (slot=0) [should fail - duplicate rate-limit nullifier]", async () => {
        return await ready.issuerWithInstantMeterHook.methods
          .verify(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            hintedCredential,
            hintedStatus,
            rlMinAge,
            rlNationality,
            0,
          )
          .send({ from: ready.activeOwner });
      }),
    ).rejects.toBeDefined();

    const issuerMeterFinal = toBigIntValue(
      await runStep("issuerWithInstantMeterHook.get_verify_meter_count (after failed 6th verify)", async () => {
        return await ready.issuerWithInstantMeterHook.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(issuerMeterFinal).toEqual(issuerMeterAfter);

    ready.txHashesByPhase.sponsored_rate_limit = [registerTxHash, ...verifyTxHashes];
    logTrace(
      "passed.enforces sponsored verify rate-limit (5 per 24h window).tx_ids",
      ready.txHashesByPhase.sponsored_rate_limit,
    );
  }, 300_000);

  it("supports company sponsor gateway verify path", async () => {
    const ready = requireContext(ctx);
    const sponsoredMinAge = 29;
    const sponsoredNationality = packAlpha3("FRA");
    const sponsoredExpiryTs = 2_293_456_000n;
    const sponsoredClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      sponsoredNationality,
      sponsoredMinAge,
      sponsoredExpiryTs,
    );

    const registerTx = await runStep("register_credential (company sponsor scope)", async () => {
      return await ready.issuer.methods
        .register_credential(
          ready.activeOwner,
          ready.ghostOwner,
          sponsoredClaimsHash,
          ready.credentialType,
          sponsoredExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerTxHash = logTxReceipt("register_credential_company_sponsor_scope", registerTx);

    const scopedSponsorDeployReceipt = await runStep(
      "deploy scoped MagnaCompanySponsor",
      async () =>
        await MagnaCompanySponsorContract.deploy(
          ready.wallet,
          ready.orchestrator,
          COMPANY_SPONSOR_MAX_FEE_CAP,
        ).send({
          from: ready.orchestrator,
        }),
    );
    const scopedSponsor = scopedSponsorDeployReceipt.contract;
    await runStep("scoped sponsor initialize issuer", async () => {
      return await scopedSponsor.methods
        .initialize_issuer(ready.issuer.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("scoped sponsor initialize rights registry", async () => {
      return await scopedSponsor.methods
        .initialize_rights_registry(ready.rightsRegistry.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("issuer add scoped sponsor gateway", async () => {
      return await ready.issuer.methods
        .add_company_sponsor_gateway(scopedSponsor.address)
        .send({ from: ready.orchestrator });
    });
    const scopedRightsTopUp = await topUpRightsFromL2Payment(
      ready,
      scopedSponsor.address,
      3n,
      0n,
      "scoped_company_sponsor.top_up",
    );
    const scopedSponsorClaim = await bridgeFeeJuiceToAddress(ready.node, scopedSponsor.address);
    await runStep("mine L2 blocks for scoped sponsor Fee Juice bridge ingestion", async () => {
      await mineTwoL2BlocksForBridgeIngestion(
        ready.l2PaymentToken,
        ready.orchestrator,
        "scoped sponsor Fee Juice bridge ingestion",
      );
    });
    const scopedSponsorFunding = await claimBridgedFeeJuice(
      ready.node,
      ready.wallet,
      ready.orchestrator,
      scopedSponsor.address,
      scopedSponsorClaim,
    );
    expect(scopedSponsorFunding.balanceAfterClaim).toBeGreaterThan(0n);

    const hintedCredential = (await runStep("get_credential_hinted (company sponsor scope)", async () => {
      return await ready.issuer.methods
        .get_credential_hinted(ready.activeOwner, sponsoredClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedCredential;
    const hintedStatus = (await runStep("get_status_hinted (company sponsor scope)", async () => {
      return await ready.issuer.methods
        .get_status_hinted(ready.activeOwner, sponsoredClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedStatus;

    const issuerMeterBefore = toBigIntValue(
      await runStep("issuer.get_verify_meter_count (before company sponsor verify)", async () => {
        return await ready.issuer.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorMeterBefore = toBigIntValue(
      await runStep("scoped sponsor get_sponsored_verify_count (before verify)", async () => {
        return await scopedSponsor.methods
          .get_sponsored_verify_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorRightsBefore = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies (before scoped sponsor verify)", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(scopedSponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );

    const sponsorVerifyTx = await runRetriedStep("scoped sponsor sponsored_verify", async () => {
      return await scopedSponsor.methods
        .sponsored_verify(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          hintedCredential,
          hintedStatus,
          sponsoredMinAge,
          sponsoredNationality,
          0,
        )
        .send({
          from: ready.activeOwner,
          fee: buildCompanySponsorFeeOptions(scopedSponsor.address),
        });
    });
    const sponsorVerifyTxHash = logTxReceipt("company_sponsor_verify", sponsorVerifyTx);

    const issuerMeterAfter = toBigIntValue(
      await runStep("issuer.get_verify_meter_count (after company sponsor verify)", async () => {
        return await ready.issuer.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorMeterAfter = toBigIntValue(
      await runStep("scoped sponsor get_sponsored_verify_count (after verify)", async () => {
        return await scopedSponsor.methods
          .get_sponsored_verify_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorRightsAfter = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies (after scoped sponsor verify)", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(scopedSponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(issuerMeterAfter).toEqual(issuerMeterBefore + 1n);
    expect(sponsorMeterAfter).toEqual(sponsorMeterBefore + 1n);
    expect(sponsorRightsAfter).toEqual(sponsorRightsBefore - 1n);

    ready.txHashesByPhase.company_sponsor = [
      registerTxHash,
      scopedRightsTopUp.purchaseTxHash,
      scopedSponsorFunding.claimTxHash,
      sponsorVerifyTxHash,
    ];

    logTrace(
      "passed.supports company sponsor gateway verify path.tx_ids",
      ready.txHashesByPhase.company_sponsor,
    );
  }, 240_000);

  it("supports two company sponsors on one issuer with isolated rights", async () => {
    const ready = requireContext(ctx);

    const secondarySponsorDeployReceipt = await runStep(
      "deploy secondary MagnaCompanySponsor",
      async () =>
        await MagnaCompanySponsorContract.deploy(
          ready.wallet,
          ready.orchestrator,
          COMPANY_SPONSOR_MAX_FEE_CAP,
        ).send({
          from: ready.orchestrator,
        }),
    );
    const secondarySponsor = secondarySponsorDeployReceipt.contract;
    await runStep("secondary sponsor initialize issuer", async () => {
      return await secondarySponsor.methods
        .initialize_issuer(ready.issuer.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("secondary sponsor initialize rights registry", async () => {
      return await secondarySponsor.methods
        .initialize_rights_registry(ready.rightsRegistry.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("issuer add secondary sponsor gateway", async () => {
      return await ready.issuer.methods
        .add_company_sponsor_gateway(secondarySponsor.address)
        .send({ from: ready.orchestrator });
    });
    const secondaryGatewayAllowed = await runStep("issuer.is_company_sponsor_gateway(secondary)", async () => {
      return await ready.issuer.methods
        .is_company_sponsor_gateway(secondarySponsor.address)
        .simulate({ from: ready.activeOwner });
    });
    expect(secondaryGatewayAllowed).toBe(true);

    const primaryRightsBefore = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(primary sponsor) before secondary top-up", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(ready.companySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    const secondaryRightsBefore = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(secondary sponsor) before top-up", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(secondarySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );

    const secondaryTopUp = await topUpRightsFromL2Payment(
      ready,
      secondarySponsor.address,
      3n,
      0n,
      "secondary_company_sponsor.top_up",
    );
    const primaryRightsAfterTopUp = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(primary sponsor) after secondary top-up", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(ready.companySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    const secondaryRightsAfterTopUp = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(secondary sponsor) after top-up", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(secondarySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(primaryRightsAfterTopUp).toEqual(primaryRightsBefore);
    expect(secondaryRightsAfterTopUp).toEqual(secondaryRightsBefore + 3n);

    const secondarySponsorClaim = await bridgeFeeJuiceToAddress(
      ready.node,
      secondarySponsor.address,
    );
    await runStep("mine L2 blocks for secondary sponsor Fee Juice bridge ingestion", async () => {
      await mineTwoL2BlocksForBridgeIngestion(
        ready.l2PaymentToken,
        ready.orchestrator,
        "secondary sponsor Fee Juice bridge ingestion",
      );
    });
    const secondarySponsorFunding = await claimBridgedFeeJuice(
      ready.node,
      ready.wallet,
      ready.orchestrator,
      secondarySponsor.address,
      secondarySponsorClaim,
    );
    expect(secondarySponsorFunding.balanceAfterClaim).toBeGreaterThan(0n);

    const sponsoredMinAge = 31;
    const sponsoredNationality = packAlpha3("DEU");
    const sponsoredExpiryTs = 2_593_456_000n;
    const sponsoredClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      sponsoredNationality,
      sponsoredMinAge,
      sponsoredExpiryTs,
    );

    await runStep("register_credential (secondary sponsor scope)", async () => {
      return await ready.issuer.methods
        .register_credential(
          ready.activeOwner,
          ready.ghostOwner,
          sponsoredClaimsHash,
          ready.credentialType,
          sponsoredExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });

    const hintedCredential = (await runStep("get_credential_hinted (secondary sponsor scope)", async () => {
      return await ready.issuer.methods
        .get_credential_hinted(ready.activeOwner, sponsoredClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedCredential;
    const hintedStatus = (await runStep("get_status_hinted (secondary sponsor scope)", async () => {
      return await ready.issuer.methods
        .get_status_hinted(ready.activeOwner, sponsoredClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedStatus;

    await runRetriedStep("secondary company sponsor sponsored_verify", async () => {
      return await secondarySponsor.methods
        .sponsored_verify(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          hintedCredential,
          hintedStatus,
          sponsoredMinAge,
          sponsoredNationality,
          0,
        )
        .send({
          from: ready.activeOwner,
          fee: buildCompanySponsorFeeOptions(secondarySponsor.address),
        });
    });

    const primaryRightsAfterVerify = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(primary sponsor) after secondary verify", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(ready.companySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    const secondaryRightsAfterVerify = toBigIntValue(
      await runStep("rightsRegistry.get_remaining_verifies(secondary sponsor) after verify", async () => {
        return await ready.rightsRegistry.methods
          .get_remaining_verifies(secondarySponsor.address)
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(primaryRightsAfterVerify).toEqual(primaryRightsAfterTopUp);
    expect(secondaryRightsAfterVerify).toEqual(secondaryRightsAfterTopUp - 1n);

    ready.txHashesByPhase.multi_sponsor_same_issuer = [secondaryTopUp.purchaseTxHash];
  }, 540_000);

  it("rejects sponsored verify when company rights are exhausted", async () => {
    const ready = requireContext(ctx);

    const exhaustedIssuerDeployReceipt = await runStep(
      "deploy exhausted-rights MagnaIssuer",
      async () =>
        await (MagnaIssuerContract.deploy as unknown as (
          wallet: EmbeddedWallet,
          orchestratorAddress: AztecAddress,
          verifyMeterHookAddress: AztecAddress,
        ) => {
          send: (opts: { from: AztecAddress }) => Promise<{
            contract: MagnaIssuerContract;
            receipt: TxReceiptLike;
          }>;
        })(ready.wallet, ready.orchestrator, AztecAddress.ZERO).send({
          from: ready.orchestrator,
        }),
    );
    const exhaustedSponsorDeployReceipt = await runStep(
      "deploy exhausted-rights MagnaCompanySponsor",
      async () =>
        await MagnaCompanySponsorContract.deploy(
          ready.wallet,
          ready.orchestrator,
          COMPANY_SPONSOR_MAX_FEE_CAP,
        ).send({
          from: ready.orchestrator,
        }),
    );

    const exhaustedIssuer = exhaustedIssuerDeployReceipt.contract;
    const exhaustedSponsor = exhaustedSponsorDeployReceipt.contract;

    await runStep("exhausted sponsor initialize issuer", async () => {
      return await exhaustedSponsor.methods
        .initialize_issuer(exhaustedIssuer.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("exhausted sponsor initialize rights registry", async () => {
      return await exhaustedSponsor.methods
        .initialize_rights_registry(ready.rightsRegistry.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("exhausted issuer add company sponsor gateway", async () => {
      return await exhaustedIssuer.methods
        .add_company_sponsor_gateway(exhaustedSponsor.address)
        .send({ from: ready.orchestrator });
    });
    await topUpRightsFromL2Payment(
      ready,
      exhaustedSponsor.address,
      1n,
      0n,
      "seed exhausted sponsor with one right",
    );

    const exhaustedSponsorFundingClaim = await bridgeFeeJuiceToAddress(
      ready.node,
      exhaustedSponsor.address,
    );
    await runStep("mine L2 blocks for exhausted sponsor Fee Juice bridge ingestion", async () => {
      await mineTwoL2BlocksForBridgeIngestion(ready.l2PaymentToken, ready.orchestrator);
    });
    const exhaustedSponsorFunding = await claimBridgedFeeJuice(
      ready.node,
      ready.wallet,
      ready.orchestrator,
      exhaustedSponsor.address,
      exhaustedSponsorFundingClaim,
    );
    logTrace("company_sponsor.exhausted_rights_funding", exhaustedSponsorFunding);

    const exhaustedMinAge = 34;
    const exhaustedNationality = packAlpha3("BEL");
    const exhaustedExpiryTs = 2_393_456_000n;
    const exhaustedClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      exhaustedNationality,
      exhaustedMinAge,
      exhaustedExpiryTs,
    );

    await runStep("register_credential (exhausted rights scope)", async () => {
      return await exhaustedIssuer.methods
        .register_credential(
          ready.activeOwner,
          ready.ghostOwner,
          exhaustedClaimsHash,
          ready.credentialType,
          exhaustedExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });

    const hintedCredential = (await runStep("get_credential_hinted (exhausted rights scope)", async () => {
      return await exhaustedIssuer.methods
        .get_credential_hinted(ready.activeOwner, exhaustedClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedCredential;
    const hintedStatus = (await runStep("get_status_hinted (exhausted rights scope)", async () => {
      return await exhaustedIssuer.methods
        .get_status_hinted(ready.activeOwner, exhaustedClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedStatus;

    const firstVerifyReceipt = await runRetriedStep("exhausted sponsor first verify (consumes only right)", async () => {
      return await exhaustedSponsor.methods
        .sponsored_verify(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          hintedCredential,
          hintedStatus,
          exhaustedMinAge,
          exhaustedNationality,
          0,
        )
        .send({
          from: ready.activeOwner,
          fee: buildCompanySponsorFeeOptions(exhaustedSponsor.address),
        });
    });
    logTxReceipt("company_sponsor_exhausted_rights_first_verify", firstVerifyReceipt);

    await expect(
      exhaustedSponsor.methods
        .sponsored_verify(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          hintedCredential,
          hintedStatus,
          exhaustedMinAge,
          exhaustedNationality,
          1,
        )
        .send({
          from: ready.activeOwner,
          fee: buildCompanySponsorFeeOptions(exhaustedSponsor.address),
        }),
    ).rejects.toBeDefined();
  }, 540_000);

  it("enforces company sponsor rate-limit (5 per 24h window)", async () => {
    const ready = requireContext(ctx);
    const rateLimitIssuerDeployReceipt = await runStep(
      "deploy rate-limit MagnaIssuer",
      async () =>
        await (MagnaIssuerContract.deploy as unknown as (
          wallet: EmbeddedWallet,
          orchestratorAddress: AztecAddress,
          verifyMeterHookAddress: AztecAddress,
        ) => {
          send: (opts: { from: AztecAddress }) => Promise<{
            contract: MagnaIssuerContract;
            receipt: TxReceiptLike;
          }>;
        })(ready.wallet, ready.orchestrator, AztecAddress.ZERO).send({
          from: ready.orchestrator,
        }),
    );
    const rateLimitSponsorDeployReceipt = await runStep(
      "deploy rate-limit MagnaCompanySponsor",
      async () =>
        await MagnaCompanySponsorContract.deploy(
          ready.wallet,
          ready.orchestrator,
          COMPANY_SPONSOR_MAX_FEE_CAP,
        ).send({
          from: ready.orchestrator,
        }),
    );
    const rateLimitIssuer = rateLimitIssuerDeployReceipt.contract;
    const rateLimitSponsor = rateLimitSponsorDeployReceipt.contract;

    await runStep("rate-limit sponsor initialize issuer", async () => {
      return await rateLimitSponsor.methods.initialize_issuer(rateLimitIssuer.address).send({ from: ready.orchestrator });
    });
    await runStep("rate-limit sponsor initialize rights registry", async () => {
      return await rateLimitSponsor.methods
        .initialize_rights_registry(ready.rightsRegistry.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("rate-limit issuer add company sponsor gateway", async () => {
      return await rateLimitIssuer.methods
        .add_company_sponsor_gateway(rateLimitSponsor.address)
        .send({ from: ready.orchestrator });
    });
    await topUpRightsFromL2Payment(
      ready,
      rateLimitSponsor.address,
      10n,
      0n,
      "seed rate-limit sponsor rights",
    );

    const rateLimitSponsorFundingClaim = await bridgeFeeJuiceToAddress(
      ready.node,
      rateLimitSponsor.address,
    );
    await runStep("mine L2 blocks for company sponsor rate-limit Fee Juice bridge ingestion", async () => {
      await mineTwoL2BlocksForBridgeIngestion(
        ready.l2PaymentToken,
        ready.orchestrator,
        "company sponsor rate-limit Fee Juice bridge ingestion",
      );
    });
    const rateLimitSponsorFunding = await claimBridgedFeeJuice(
      ready.node,
      ready.wallet,
      ready.orchestrator,
      rateLimitSponsor.address,
      rateLimitSponsorFundingClaim,
    );
    logTrace("company_sponsor.rate_limit_funding", rateLimitSponsorFunding);
    expect(rateLimitSponsorFunding.balanceAfterClaim).toBeGreaterThan(0n);

    const sponsorRlMinAge = 33;
    const sponsorRlNationality = packAlpha3("ESP");
    const sponsorRlExpiryTs = 2_493_456_000n;
    const sponsorRlClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      sponsorRlNationality,
      sponsorRlMinAge,
      sponsorRlExpiryTs,
    );
    const registerTx = await runRetriedStep("register_credential (company sponsor rate-limit scope)", async () => {
      return await rateLimitIssuer.methods
        .register_credential(
          ready.activeOwner,
          ready.ghostOwner,
          sponsorRlClaimsHash,
          ready.credentialType,
          sponsorRlExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });
    const registerTxHash = logTxReceipt("register_credential_company_sponsor_rate_limit_scope", registerTx);

    const hintedCredential = (await runStep(
      "get_credential_hinted (company sponsor rate-limit scope)",
      async () => {
        return await rateLimitIssuer.methods
          .get_credential_hinted(ready.activeOwner, sponsorRlClaimsHash)
          .simulate({ from: ready.activeOwner });
      },
    )) as HintedCredential;
    const hintedStatus = (await runStep("get_status_hinted (company sponsor rate-limit scope)", async () => {
      return await rateLimitIssuer.methods
        .get_status_hinted(ready.activeOwner, sponsorRlClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedStatus;

    const issuerMeterBefore = toBigIntValue(
      await runStep("rate-limit issuer.get_verify_meter_count (before company sponsor verifies)", async () => {
        return await rateLimitIssuer.methods.get_verify_meter_count().simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorMeterBefore = toBigIntValue(
      await runStep(
        "rate-limit companySponsor.get_sponsored_verify_count (before verifies)",
        async () => {
          return await rateLimitSponsor.methods
            .get_sponsored_verify_count()
            .simulate({ from: ready.activeOwner });
        },
      ),
    );

    const verifyTxHashes: string[] = [];
    for (let slot = 0; slot < 5; slot += 1) {
      const tx = await runRetriedStep(`rate-limit companySponsor.sponsored_verify (slot=${slot})`, async () => {
        return await rateLimitSponsor.methods
          .sponsored_verify(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            hintedCredential,
            hintedStatus,
            sponsorRlMinAge,
            sponsorRlNationality,
            slot,
          )
          .send({
            from: ready.activeOwner,
            fee: buildCompanySponsorFeeOptions(rateLimitSponsor.address),
          });
      });
      verifyTxHashes.push(logTxReceipt(`company_sponsor_rate_limit_slot_${slot}`, tx));
    }

    const issuerMeterAfter = toBigIntValue(
      await runStep("rate-limit issuer.get_verify_meter_count (after 5 company sponsor verifies)", async () => {
        return await rateLimitIssuer.methods.get_verify_meter_count().simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorMeterAfter = toBigIntValue(
      await runStep("rate-limit companySponsor.get_sponsored_verify_count (after 5 verifies)", async () => {
        return await rateLimitSponsor.methods
          .get_sponsored_verify_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(issuerMeterAfter).toEqual(issuerMeterBefore + 5n);
    expect(sponsorMeterAfter).toEqual(sponsorMeterBefore + 5n);

    await expect(
      runStep(
        "rate-limit companySponsor.sponsored_verify (slot=0) [should fail - duplicate rate-limit nullifier]",
        async () => {
          return await rateLimitSponsor.methods
          .sponsored_verify(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            hintedCredential,
            hintedStatus,
            sponsorRlMinAge,
            sponsorRlNationality,
            0,
          )
          .send({
            from: ready.activeOwner,
            fee: buildCompanySponsorFeeOptions(rateLimitSponsor.address),
          });
        },
      ),
    ).rejects.toBeDefined();

    const issuerMeterFinal = toBigIntValue(
      await runStep("rate-limit issuer.get_verify_meter_count (after failed 6th company sponsor verify)", async () => {
        return await rateLimitIssuer.methods.get_verify_meter_count().simulate({ from: ready.activeOwner });
      }),
    );
    const sponsorMeterFinal = toBigIntValue(
      await runStep("rate-limit companySponsor.get_sponsored_verify_count (after failed 6th verify)", async () => {
        return await rateLimitSponsor.methods
          .get_sponsored_verify_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(issuerMeterFinal).toEqual(issuerMeterAfter);
    expect(sponsorMeterFinal).toEqual(sponsorMeterAfter);

    ready.txHashesByPhase.company_sponsor_rate_limit = [
      registerTxHash,
      rateLimitSponsorFunding.claimTxHash,
      ...verifyTxHashes,
    ];
    logTrace(
      "passed.enforces company sponsor rate-limit (5 per 24h window).tx_ids",
      ready.txHashesByPhase.company_sponsor_rate_limit,
    );
  }, 300_000);

  it("rejects company sponsor verifies above the sponsor fee cap", async () => {
    const ready = requireContext(ctx);
    const overBudgetMinAge = 31;
    const overBudgetNationality = packAlpha3("DEU");
    const overBudgetExpiryTs = 2_393_456_000n;
    const overBudgetClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      overBudgetNationality,
      overBudgetMinAge,
      overBudgetExpiryTs,
    );

    await runStep("register_credential (over-budget company sponsor scope)", async () => {
      return await ready.issuer.methods
        .register_credential(
          ready.activeOwner,
          ready.ghostOwner,
          overBudgetClaimsHash,
          ready.credentialType,
          overBudgetExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });

    const hintedCredential = (await runStep("get_credential_hinted (over-budget company sponsor scope)", async () => {
      return await ready.issuer.methods
        .get_credential_hinted(ready.activeOwner, overBudgetClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedCredential;
    const hintedStatus = (await runStep("get_status_hinted (over-budget company sponsor scope)", async () => {
      return await ready.issuer.methods
        .get_status_hinted(ready.activeOwner, overBudgetClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedStatus;

    const sponsorBalanceBefore = await runStep("getFeeJuiceBalance(company sponsor before over-budget verify)", async () =>
      getFeeJuiceBalance(ready.companySponsor.address, ready.node),
    );
    const issuerMeterBefore = toBigIntValue(
      await runStep("issuer.get_verify_meter_count (before over-budget company sponsor verify)", async () => {
        return await ready.issuer.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );

    await expect(
      ready.companySponsor.methods
        .sponsored_verify(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          hintedCredential,
          hintedStatus,
          overBudgetMinAge,
          overBudgetNationality,
          1,
        )
        .send({
          from: ready.activeOwner,
          fee: {
            paymentMethod: new CompanySponsorFeePaymentMethod(ready.companySponsor.address),
            gasSettings: new GasSettings(
              new Gas(1_000_000_000, 1_000_000_000),
              new Gas(1_000_000_000, 1_000_000_000),
              new GasFees(1_000_000_000n, 1_000_000_000n),
              new GasFees(0n, 0n),
            ),
          },
        }),
    ).rejects.toBeDefined();

    const sponsorBalanceAfter = await runStep("getFeeJuiceBalance(company sponsor after over-budget verify)", async () =>
      getFeeJuiceBalance(ready.companySponsor.address, ready.node),
    );
    const issuerMeterAfter = toBigIntValue(
      await runStep("issuer.get_verify_meter_count (after over-budget company sponsor verify)", async () => {
        return await ready.issuer.methods
          .get_verify_meter_count()
          .simulate({ from: ready.activeOwner });
      }),
    );
    expect(sponsorBalanceAfter).toEqual(sponsorBalanceBefore);
    expect(issuerMeterAfter).toEqual(issuerMeterBefore);
  }, 240_000);

  it("rejects company sponsor verifies when the sponsor has no FeeJuice", async () => {
    const ready = requireContext(ctx);
    const unfundedIssuerDeployReceipt = await runStep(
      "deploy unfunded MagnaIssuer",
      async () =>
        await (MagnaIssuerContract.deploy as unknown as (
          wallet: EmbeddedWallet,
          orchestratorAddress: AztecAddress,
          fpcPolicyAddress: AztecAddress,
        ) => {
          send: (opts: { from: AztecAddress }) => Promise<{
            contract: MagnaIssuerContract;
            receipt: TxReceiptLike;
          }>;
        })(ready.wallet, ready.orchestrator, AztecAddress.ZERO).send({
          from: ready.orchestrator,
        }),
    );
    const unfundedSponsorDeployReceipt = await runStep(
      "deploy unfunded MagnaCompanySponsor",
      async () =>
        await MagnaCompanySponsorContract.deploy(
          ready.wallet,
          ready.orchestrator,
          COMPANY_SPONSOR_MAX_FEE_CAP,
        ).send({
          from: ready.orchestrator,
        }),
    );
    const unfundedIssuer = unfundedIssuerDeployReceipt.contract;
    const unfundedSponsor = unfundedSponsorDeployReceipt.contract;

    await runStep("unfunded companySponsor.initialize_issuer(unfunded issuer)", async () => {
      return await unfundedSponsor.methods
        .initialize_issuer(unfundedIssuer.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("unfunded companySponsor.initialize_rights_registry(rightsRegistry)", async () => {
      return await unfundedSponsor.methods
        .initialize_rights_registry(ready.rightsRegistry.address)
        .send({ from: ready.orchestrator });
    });
    await runStep("unfunded issuer.add_company_sponsor_gateway(unfunded sponsor)", async () => {
      return await unfundedIssuer.methods
        .add_company_sponsor_gateway(unfundedSponsor.address)
        .send({ from: ready.orchestrator });
    });
    await topUpRightsFromL2Payment(
      ready,
      unfundedSponsor.address,
      1n,
      0n,
      "seed unfunded sponsor rights",
    );

    const unfundedMinAge = 27;
    const unfundedNationality = packAlpha3("ESP");
    const unfundedExpiryTs = 2_493_456_000n;
    const unfundedClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      unfundedNationality,
      unfundedMinAge,
      unfundedExpiryTs,
    );

    await runStep("register_credential (unfunded company sponsor scope)", async () => {
      return await unfundedIssuer.methods
        .register_credential(
          ready.activeOwner,
          ready.ghostOwner,
          unfundedClaimsHash,
          ready.credentialType,
          unfundedExpiryTs,
        )
        .send({ from: ready.orchestrator });
    });

    const hintedCredential = (await runStep("get_credential_hinted (unfunded company sponsor scope)", async () => {
      return await unfundedIssuer.methods
        .get_credential_hinted(ready.activeOwner, unfundedClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedCredential;
    const hintedStatus = (await runStep("get_status_hinted (unfunded company sponsor scope)", async () => {
      return await unfundedIssuer.methods
        .get_status_hinted(ready.activeOwner, unfundedClaimsHash)
        .simulate({ from: ready.activeOwner });
    })) as HintedStatus;

    const unfundedSponsorBalance = await runStep("getFeeJuiceBalance(unfunded company sponsor)", async () =>
      getFeeJuiceBalance(unfundedSponsor.address, ready.node),
    );
    expect(unfundedSponsorBalance).toEqual(0n);

    await expect(
      unfundedSponsor.methods
        .sponsored_verify(
          { credential_type: ready.credentialType, constraints: buildConstraints() },
          hintedCredential,
          hintedStatus,
          unfundedMinAge,
          unfundedNationality,
          0,
        )
        .send({
          from: ready.activeOwner,
          fee: buildCompanySponsorFeeOptions(unfundedSponsor.address),
        }),
    ).rejects.toBeDefined();
  }, 300_000);

  it("supports secp256r1 account-contract orchestrator flow", async () => {
    const ready = requireContext(ctx);
    const passkeyOrchestratorDeployment = await createAndDeployEcdsaRAccount(
      ready.wallet,
      ready.orchestrator,
      "orchestrator-passkey-r1",
    );
    const passkeyOrchestrator = passkeyOrchestratorDeployment.address;
    const passkeyOrchestratorDeployTxHash = logTxReceipt(
      "bootstrap.passkey_orchestrator_deploy",
      passkeyOrchestratorDeployment.deployTx,
    );
    await runStep(
      "wallet.registerSender(passkey orchestrator)",
      async () => await ready.wallet.registerSender(passkeyOrchestrator, "orchestrator-passkey-r1"),
    );

    const passkeyFeeJuiceBeforeFunding = await runStep("getFeeJuiceBalance(passkey orchestrator before funding)", async () =>
      getFeeJuiceBalance(passkeyOrchestrator, ready.node),
    );
    logTrace("passkey_orchestrator.fee_juice_balance_before_funding", {
      balance: passkeyFeeJuiceBeforeFunding.toString(),
    });

    const issuerPasskeyDeployReceipt = await runStep(
      "deploy MagnaIssuer (allowlist passkey orchestrator)",
      async () =>
        await (MagnaIssuerContract.deploy as unknown as (
          wallet: EmbeddedWallet,
          orchestratorAddress: AztecAddress,
          fpcPolicyAddress: AztecAddress,
        ) => {
          send: (opts: { from: AztecAddress }) => Promise<{
            contract: MagnaIssuerContract;
            receipt: TxReceiptLike;
          }>;
        })(ready.wallet, passkeyOrchestrator, AztecAddress.ZERO).send({
          // Use a pre-funded account to pay deployment fees, but *configure* the issuer to allowlist the passkey address.
          from: ready.orchestrator,
        }),
    );
    const issuerPasskey = issuerPasskeyDeployReceipt.contract;
    const issuerPasskeyDeployTxHash = logTxReceipt(
      "deploy_magna_issuer_passkey_orchestrator",
      issuerPasskeyDeployReceipt,
    );

    const passkeyMinAge = 28;
    const passkeyNationality = packAlpha3("AUS");
    const passkeyExpiryTs = 2_193_456_000n;
    const passkeyClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      passkeyNationality,
      passkeyMinAge,
      passkeyExpiryTs,
    );

    // Sanity: non-orchestrator caller must be rejected.
    await expect(
      runStep("register_credential rejects wrong orchestrator", async () => {
        return await issuerPasskey.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            passkeyClaimsHash,
            ready.credentialType,
            passkeyExpiryTs,
          )
          .simulate({ from: ready.orchestrator });
      }),
    ).rejects.toBeDefined();

    const passkeyFundingClaim = await bridgeFeeJuiceToAddress(ready.node, passkeyOrchestrator);
    await runStep("mine L2 blocks for passkey orchestrator Fee Juice bridge ingestion", async () => {
      await mineTwoL2BlocksForBridgeIngestion(
        ready.l2PaymentToken,
        ready.orchestrator,
        "passkey orchestrator Fee Juice bridge ingestion",
      );
    });
    const passkeyFunding = await claimBridgedFeeJuice(
      ready.node,
      ready.wallet,
      ready.orchestrator,
      passkeyOrchestrator,
      passkeyFundingClaim,
    );
    expect(passkeyFunding.balanceAfterClaim).toBeGreaterThan(0n);

    const registerPasskeyTx = await runStep(
      "register_credential (passkey orchestrator issuer)",
      async () =>
        await issuerPasskey.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            passkeyClaimsHash,
            ready.credentialType,
            passkeyExpiryTs,
          )
          .send({ from: passkeyOrchestrator }),
    );
    const registerPasskeyTxHash = logTxReceipt("register_credential_passkey_orchestrator", registerPasskeyTx);

    const passkeyCredential = (await runStep(
      "get_credential_hinted (passkey orchestrator issuer)",
      async () =>
        await issuerPasskey.methods
          .get_credential_hinted(ready.activeOwner, passkeyClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedCredential;
    const passkeyStatus = (await runStep(
      "get_status_hinted (passkey orchestrator issuer)",
      async () =>
        await issuerPasskey.methods
          .get_status_hinted(ready.activeOwner, passkeyClaimsHash)
          .simulate({ from: ready.activeOwner }),
    )) as HintedStatus;

    const verifyPasskeyTx = await runStep(
      "verify (passkey orchestrator issuer)",
      async () =>
        await issuerPasskey.methods
          .verify(
            { credential_type: ready.credentialType, constraints: buildConstraints() },
            passkeyCredential,
            passkeyStatus,
            passkeyMinAge,
            passkeyNationality,
            0,
          )
          .send({ from: ready.activeOwner }),
    );
    const verifyPasskeyTxHash = logTxReceipt("verify_passkey_orchestrator", verifyPasskeyTx);

    ready.txHashesByPhase.passkey_orchestrator = [
      passkeyOrchestratorDeployTxHash,
      issuerPasskeyDeployTxHash,
      registerPasskeyTxHash,
      verifyPasskeyTxHash,
    ];
    logTrace(
      "passed.supports secp256r1 account-contract orchestrator flow.tx_ids",
      ready.txHashesByPhase.passkey_orchestrator,
    );
  }, 240_000);

  it("supports WebAuthn account-contract orchestrator flow", async () => {
    const ready = requireContext(ctx);
    const webAuthnOrchestratorDeployment = await createAndDeployWebAuthnAccount(
      ready.wallet,
      ready.orchestrator,
      "orchestrator-webauthn",
    );
    const webAuthnOrchestrator = webAuthnOrchestratorDeployment.address;
    const webAuthnOrchestratorDeployTxHash = logTxReceipt(
      "bootstrap.webauthn_orchestrator_deploy",
      webAuthnOrchestratorDeployment.deployTx,
    );
    await runStep(
      "wallet.registerSender(webauthn orchestrator)",
      async () => await ready.wallet.registerSender(webAuthnOrchestrator, "orchestrator-webauthn"),
    );
    const walletWithAccountOverride = ready.wallet as EmbeddedWallet & {
      getAccountFromAddress: (address: AztecAddress) => Promise<unknown>;
    };
    const fallbackGetAccountFromAddress = walletWithAccountOverride.getAccountFromAddress.bind(ready.wallet);
    walletWithAccountOverride.getAccountFromAddress = async (address: AztecAddress) => {
      if (address.equals(webAuthnOrchestrator)) {
        return await webAuthnOrchestratorDeployment.accountManager.getAccount();
      }
      return await fallbackGetAccountFromAddress(address);
    };

    const issuerWebAuthnDeployReceipt = await runStep(
      "deploy MagnaIssuer (allowlist WebAuthn orchestrator)",
      async () =>
        await (MagnaIssuerContract.deploy as unknown as (
          wallet: EmbeddedWallet,
          orchestratorAddress: AztecAddress,
          fpcPolicyAddress: AztecAddress,
        ) => {
          send: (opts: { from: AztecAddress }) => Promise<{
            contract: MagnaIssuerContract;
            receipt: TxReceiptLike;
          }>;
        })(ready.wallet, webAuthnOrchestrator, AztecAddress.ZERO).send({
          from: ready.orchestrator,
        }),
    );
    const issuerWebAuthn = issuerWebAuthnDeployReceipt.contract;
    const issuerWebAuthnDeployTxHash = logTxReceipt(
      "deploy_magna_issuer_webauthn_orchestrator",
      issuerWebAuthnDeployReceipt,
    );

    const webAuthnMinAge = 31;
    const webAuthnNationality = packAlpha3("NZL");
    const webAuthnExpiryTs = 2_293_456_000n;
    const webAuthnClaimsHash = computeClaimsHash(
      1n,
      ready.credentialType,
      webAuthnNationality,
      webAuthnMinAge,
      webAuthnExpiryTs,
    );

    const webAuthnFundingClaim = await bridgeFeeJuiceToAddress(ready.node, webAuthnOrchestrator);
    await runStep("mine L2 blocks for WebAuthn orchestrator Fee Juice bridge ingestion", async () => {
      await mineTwoL2BlocksForBridgeIngestion(
        ready.l2PaymentToken,
        ready.orchestrator,
        "WebAuthn orchestrator Fee Juice bridge ingestion",
      );
    });
    const webAuthnFunding = await claimBridgedFeeJuice(
      ready.node,
      ready.wallet,
      ready.orchestrator,
      webAuthnOrchestrator,
      webAuthnFundingClaim,
    );
    expect(webAuthnFunding.balanceAfterClaim).toBeGreaterThan(0n);

    const registerWebAuthnTx = await runStep(
      "register_credential (WebAuthn orchestrator issuer)",
      async () =>
        await issuerWebAuthn.methods
          .register_credential(
            ready.activeOwner,
            ready.ghostOwner,
            webAuthnClaimsHash,
            ready.credentialType,
            webAuthnExpiryTs,
          )
          .send({ from: webAuthnOrchestrator }),
    );
    const registerWebAuthnTxHash = logTxReceipt("register_credential_webauthn_orchestrator", registerWebAuthnTx);

    ready.txHashesByPhase.webauthn_orchestrator = [
      webAuthnOrchestratorDeployTxHash,
      issuerWebAuthnDeployTxHash,
      registerWebAuthnTxHash,
    ];
    logTrace(
      "passed.supports WebAuthn account-contract orchestrator flow.tx_ids",
      ready.txHashesByPhase.webauthn_orchestrator,
    );
  }, 300_000);

});
