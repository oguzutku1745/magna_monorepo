#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  getContractAddress,
  http,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getInitialTestAccountsData, INITIAL_TEST_SIGNING_KEYS } from "@aztec/accounts/testing";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { createAztecNodeClient, waitForNode } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { RegistryClient } from "@zkpassport/registry";
import { MagnaIssuerContract } from "../packages/contracts-bindings/src/MagnaIssuer.ts";
import {
  ZKPASSPORT_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH,
  ZKPASSPORT_NULLIFIER_TYPE_NON_SALTED_MOCK,
  computeRecoveryTrustContext,
  deriveZkPassportServiceContext,
} from "../packages/magna-recovery-v3/dist/protocol.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portalRoot = resolve(repoRoot, "contracts/magna-recovery-portal");
const manifestPath = resolve(repoRoot, process.env.MAGNA_DEPLOYMENT_MANIFEST ?? "deployments/local.json");
const rpcUrl = process.env.MAGNA_L1_RPC_URL ?? "http://127.0.0.1:8545";
const aztecNodeUrl = process.env.MAGNA_AZTEC_NODE_URL ?? "http://127.0.0.1:8080";
const deployerKey =
  process.env.MAGNA_RECOVERY_V3_DEPLOYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const domain = process.env.MAGNA_ZKPASSPORT_DOMAIN ?? "localhost";
const scope = process.env.MAGNA_ZKPASSPORT_SCOPE ?? "magna-passport-onboarding";
const wrapperVersion = 1n;
const officialRegistryChainId = 11155111;
const officialRegistryRpcUrl =
  process.env.MAGNA_ZKPASSPORT_EVM_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

if (Number(process.versions.node.split(".")[0]) < 24) {
  throw new Error(`Node.js >=24 is required; received ${process.versions.node}.`);
}
if (!existsSync(manifestPath)) throw new Error(`Deployment manifest not found: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const issuer = manifest?.l2?.issuerAddress;
const inbox = manifest?.resolvedAztec?.inboxAddress;
const protocolVersion = BigInt(manifest?.resolvedAztec?.rollupVersion ?? 0);
const manifestChainId = BigInt(manifest?.resolvedAztec?.l1ChainId ?? 0);
if (!/^0x[0-9a-fA-F]{64}$/.test(issuer ?? "")) throw new Error("Manifest is missing the L2 issuer address.");
if (!/^0x[0-9a-fA-F]{40}$/.test(inbox ?? "")) throw new Error("Manifest is missing the canonical Aztec Inbox.");
if (protocolVersion === 0n || manifestChainId === 0n) throw new Error("Manifest is missing Aztec/L1 network identity.");

function stableJson(value) {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Json(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function rootInput(details) {
  return {
    root: details.root,
    validFrom: BigInt(Math.floor(details.validFrom.getTime() / 1000)),
    validTo: details.validTo ? BigInt(Math.floor(details.validTo.getTime() / 1000)) : 0n,
    revoked: details.revoked,
    leaves: BigInt(details.leaves),
    // Root validity does not depend on content-address metadata. Keep the
    // official metadata fields where the client exposes them; CID conversion
    // is intentionally not reimplemented outside the official package.
    cid: `0x${"00".repeat(32)}`,
    metadata1: details.metadata1 ?? `0x${"00".repeat(32)}`,
    metadata2: details.metadata2 ?? `0x${"00".repeat(32)}`,
    metadata3: details.metadata3 ?? `0x${"00".repeat(32)}`,
  };
}

console.log("[recovery-v3] resolving developer trust roots independently from the official Sepolia registry...");
const officialRegistry = new RegistryClient({
  chainId: officialRegistryChainId,
  rpcUrl: officialRegistryRpcUrl,
});
const [certificateRoot, circuitRoot] = await Promise.all([
  officialRegistry.getCertificateRootDetails(),
  officialRegistry.getCircuitRootDetails(),
]);
if (certificateRoot.revoked || circuitRoot.revoked) {
  throw new Error("The official zkPassport developer registry returned a revoked latest root.");
}
const [certificatePackage, circuitManifest] = await Promise.all([
  officialRegistry.getCertificates(certificateRoot.root, { validate: true }),
  officialRegistry.getCircuitManifest(circuitRoot.root, { validate: true }),
]);
const officialRootsEvidence = {
  sourceChainId: officialRegistryChainId,
  rootRegistryAddress: officialRegistry.getRootRegistryAddress(),
  certificate: {
    ...rootInput(certificateRoot),
    validFrom: Math.floor(certificateRoot.validFrom.getTime() / 1000),
    validTo: certificateRoot.validTo ? Math.floor(certificateRoot.validTo.getTime() / 1000) : 0,
    leaves: certificateRoot.leaves,
    officialCid: certificateRoot.cid,
    packagedContentSha256: sha256Json(certificatePackage),
  },
  circuit: {
    ...rootInput(circuitRoot),
    validFrom: Math.floor(circuitRoot.validFrom.getTime() / 1000),
    validTo: circuitRoot.validTo ? Math.floor(circuitRoot.validTo.getTime() / 1000) : 0,
    leaves: circuitRoot.leaves,
    officialCid: circuitRoot.cid,
    manifestSha256: sha256Json(circuitManifest),
  },
};
const officialRootsEvidenceSha256 = sha256Json(officialRootsEvidence);

const build = spawnSync("forge", ["build", "--offline"], { cwd: portalRoot, stdio: "inherit", shell: false });
if (build.error) throw new Error(`Could not start Foundry: ${build.error.message}`);
if ((build.status ?? 1) !== 0) throw new Error("Recovery portal forge build failed.");

function artifact(source, contract) {
  const path = resolve(portalRoot, "out", source, `${contract}.json`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed?.abi || !parsed?.bytecode?.object) throw new Error(`Invalid Foundry artifact: ${path}`);
  return {
    abi: parsed.abi,
    bytecode: parsed.bytecode.object,
    linkReferences: parsed.bytecode.linkReferences ?? {},
  };
}

function linkArtifact(selected, libraries) {
  let linked = selected.bytecode;
  const dataOffset = linked.startsWith("0x") ? 2 : 0;
  for (const sourceReferences of Object.values(selected.linkReferences)) {
    for (const [libraryName, references] of Object.entries(sourceReferences)) {
      const address = libraries[libraryName];
      if (!address) throw new Error(`Missing deployment for verifier library ${libraryName}.`);
      const replacement = address.slice(2).toLowerCase();
      for (const reference of references) {
        if (reference.length !== 20) {
          throw new Error(`Unexpected ${libraryName} link width: ${reference.length}.`);
        }
        const start = dataOffset + reference.start * 2;
        const end = start + reference.length * 2;
        linked = `${linked.slice(0, start)}${replacement}${linked.slice(end)}`;
      }
    }
  }
  if (!/^0x[0-9a-fA-F]+$/.test(linked)) {
    throw new Error("Generated Recovery V3 verifier still contains unresolved library references.");
  }
  return { ...selected, bytecode: linked, linkReferences: {} };
}

const rootArtifact = artifact("RootRegistry.sol", "RootRegistry");
const certificateArtifact = artifact("CertificateRegistry.sol", "CertificateRegistry");
const circuitArtifact = artifact("CircuitRegistry.sol", "CircuitRegistry");
const relationsArtifact = artifact("RecoveryWrapperVerifier.sol", "RelationsLib");
const transcriptArtifact = artifact("RecoveryWrapperVerifier.sol", "ZKTranscriptLib");
const verifierArtifact = artifact("RecoveryWrapperVerifier.sol", "HonkVerifier");
const portalArtifact = artifact("MagnaRecoveryPortal.sol", "MagnaRecoveryPortal");
const account = privateKeyToAccount(deployerKey);
const transport = http(rpcUrl);
const publicClient = createPublicClient({ transport });
const wallet = createWalletClient({ account, transport }).extend(publicActions);
const chainId = BigInt(await publicClient.getChainId());
if (chainId !== manifestChainId) throw new Error(`L1 chain mismatch: RPC=${chainId} manifest=${manifestChainId}.`);
const inboxCode = await publicClient.getCode({ address: inbox });
if (!inboxCode || inboxCode === "0x") throw new Error("Canonical Aztec Inbox has no code.");

async function deploy(label, selected, args = []) {
  const hash = await wallet.deployContract({ account, abi: selected.abi, bytecode: selected.bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${label} deployment failed: ${hash}`);
  console.log(`[recovery-v3] ${label}: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function write(label, address, abi, functionName, args) {
  const hash = await wallet.writeContract({ account, address, abi, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} failed: ${hash}`);
  return hash;
}

const rootRegistry = await deploy("official RootRegistry", rootArtifact, [account.address, account.address]);
const certificateRegistry = await deploy("official CertificateRegistry", certificateArtifact, [
  account.address,
  account.address,
  account.address,
]);
const circuitRegistry = await deploy("official CircuitRegistry", circuitArtifact, [
  account.address,
  account.address,
  account.address,
]);
await write("register certificate registry", rootRegistry, rootArtifact.abi, "addRegistry", [
  `0x${1n.toString(16).padStart(64, "0")}`,
  certificateRegistry,
]);
await write("register circuit registry", rootRegistry, rootArtifact.abi, "addRegistry", [
  `0x${2n.toString(16).padStart(64, "0")}`,
  circuitRegistry,
]);
await write("seed independently resolved certificate root", certificateRegistry, certificateArtifact.abi, "batchUpdateRoots", [
  [rootInput(certificateRoot)],
]);
await write("seed independently resolved circuit root", circuitRegistry, circuitArtifact.abi, "batchUpdateRoots", [
  [rootInput(circuitRoot)],
]);

const rootRegistryReadAbi = rootArtifact.abi;
const unseededRoot = `0x${"f0".repeat(32)}`;
const unseededAccepted = await publicClient.readContract({
  address: rootRegistry,
  abi: rootRegistryReadAbi,
  functionName: "isRootValid",
  args: [`0x${1n.toString(16).padStart(64, "0")}`, unseededRoot, BigInt(Math.floor(Date.now() / 1000))],
});
if (unseededAccepted) throw new Error("Official local RootRegistry accepted an unseeded root.");

// Exercise the exact official revocation path, then restore the independently
// resolved root before the live proof run. This is evidence of behavior, not a
// permanent change to the mirrored developer trust state.
await write("temporarily revoke certificate root", certificateRegistry, certificateArtifact.abi, "setRevocationStatus", [
  certificateRoot.root,
  true,
]);
const revokedAccepted = await publicClient.readContract({
  address: rootRegistry,
  abi: rootRegistryReadAbi,
  functionName: "isRootValid",
  args: [
    `0x${1n.toString(16).padStart(64, "0")}`,
    certificateRoot.root,
    BigInt(Math.floor(Date.now() / 1000)),
  ],
});
if (revokedAccepted) throw new Error("Official local RootRegistry accepted an explicitly revoked root.");
await write("restore certificate root", certificateRegistry, certificateArtifact.abi, "setRevocationStatus", [
  certificateRoot.root,
  false,
]);
const relationsLibrary = await deploy("generated RelationsLib", relationsArtifact);
const transcriptLibrary = await deploy("generated ZKTranscriptLib", transcriptArtifact);
const linkedVerifierArtifact = linkArtifact(verifierArtifact, {
  RelationsLib: relationsLibrary,
  ZKTranscriptLib: transcriptLibrary,
});
const wrapperVerifier = await deploy("generated Recovery V3 HonkVerifier", linkedVerifierArtifact);

const nextNonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
const predictedPortal = getContractAddress({ from: account.address, nonce: BigInt(nextNonce) });
const service = deriveZkPassportServiceContext(domain, scope);
const trustContext = computeRecoveryTrustContext({
  ethereumChainId: chainId,
  recoveryPortalL1Address: predictedPortal,
  aztecProtocolVersion: protocolVersion,
  aztecChainId: manifestChainId,
  issuerL2Address: issuer,
  serviceScopeHash: service.serviceScopeHash,
  serviceSubscopeHash: service.serviceSubscopeHash,
  nullifierType: ZKPASSPORT_NULLIFIER_TYPE_NON_SALTED_MOCK,
  oprfPublicKeyHash: ZKPASSPORT_DEVELOPMENT_OPRF_PUBLIC_KEY_HASH,
  recoveryWrapperVersion: wrapperVersion,
});
const recoveryPortal = await deploy("MagnaRecoveryPortal", portalArtifact, [
  chainId,
  wrapperVersion,
  wrapperVerifier,
  rootRegistry,
  inbox,
  issuer,
  protocolVersion,
  `0x${trustContext.toString(16).padStart(64, "0")}`,
]);
if (recoveryPortal.toLowerCase() !== predictedPortal.toLowerCase()) {
  throw new Error(`Portal CREATE prediction mismatch: predicted=${predictedPortal} actual=${recoveryPortal}.`);
}

// The L1 portal must be pinned by the issuer before any recovery message can
// be consumed. Deployment is intentionally one-time: PublicImmutable rejects
// later replacement, so a relayer/backend cannot redirect the trusted sender.
const aztecNode = createAztecNodeClient(aztecNodeUrl);
await waitForNode(aztecNode, undefined, { timeout: 120 });
const aztecWallet = await EmbeddedWallet.create(aztecNode, {
  ephemeral: true,
  pxeConfig: { proverEnabled: false },
});
let issuerPortalInitializationTxHash;
try {
  const expectedOrchestrator = String(
    manifest?.l2?.webBootstrap?.orchestratorAddress ?? manifest?.l2?.adminAddress ?? "",
  ).toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(expectedOrchestrator)) {
    throw new Error("Manifest is missing the issuer orchestrator address.");
  }
  const initialAccounts = await getInitialTestAccountsData();
  let orchestrator;
  for (let index = 0; index < initialAccounts.length; index += 1) {
    const accountData = initialAccounts[index];
    const manager = await aztecWallet.createSchnorrInitializerlessAccount(
      accountData.secret,
      accountData.salt,
      INITIAL_TEST_SIGNING_KEYS[index] ?? accountData.signingKey,
      `recovery-v3-local-${index}`,
    );
    if (manager.address.toString().toLowerCase() === expectedOrchestrator) {
      orchestrator = manager.address;
      break;
    }
  }
  if (!orchestrator) {
    throw new Error(`Issuer orchestrator ${expectedOrchestrator} is not an official local test account.`);
  }
  await aztecWallet.registerSender(orchestrator, "recovery-v3-orchestrator");
  const issuerContract = MagnaIssuerContract.at(AztecAddress.fromStringUnsafe(issuer), aztecWallet);
  const initResult = await issuerContract.methods
    .initialize_recovery_portal(recoveryPortal)
    .send({ from: orchestrator });
  const initReceipt = initResult.receipt;
  if (!initReceipt.isMined() || !initReceipt.hasExecutionSucceeded()) {
    throw new Error(
      `Issuer recovery portal initialization did not settle successfully: ${initReceipt.txHash.toString()}.`,
    );
  }
  issuerPortalInitializationTxHash = initReceipt.txHash.toString();
  console.log(`[recovery-v3] issuer recovery portal initialized on L2: ${issuerPortalInitializationTxHash}`);
} finally {
  await aztecWallet.stop();
}

manifest.recoveryV3 = {
  profile: "development",
  wrapperVersion: wrapperVersion.toString(),
  ethereumChainId: chainId.toString(),
  aztecChainId: manifestChainId.toString(),
  aztecProtocolVersion: protocolVersion.toString(),
  domain,
  scope,
  serviceScopeHash: service.serviceScopeHash.toString(),
  serviceSubscopeHash: service.serviceSubscopeHash.toString(),
  rootRegistryAddress: rootRegistry,
  certificateRegistryAddress: certificateRegistry,
  circuitRegistryAddress: circuitRegistry,
  wrapperVerifierAddress: wrapperVerifier,
  wrapperVerifierLibraries: {
    relationsLibrary,
    transcriptLibrary,
  },
  portalAddress: recoveryPortal,
  issuerPortalInitializationTxHash,
  trustContext: trustContext.toString(),
  deployerAddress: account.address,
  officialRegistryEvidence: {
    ...officialRootsEvidence,
    sha256: officialRootsEvidenceSha256,
  },
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`[recovery-v3] updated ${manifestPath}`);
console.log(`[recovery-v3] official registry evidence sha256: ${officialRootsEvidenceSha256}`);
console.log("[recovery-v3] local roots were resolved and content-validated independently of the proof under test.");
