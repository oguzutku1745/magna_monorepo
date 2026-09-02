import type { RecoveryWrapperLocalWitness, RecoveryWrapperProofArtifact } from "@magna/recovery-wrapper-proof/safe";
import {
  RECOVERY_WRAPPER_VERSION,
  serializeRecoveryProofForEvm,
} from "@magna/recovery-wrapper-proof/safe";
import {
  PASSPORT_A2_INNER_PROOF_FIELD_COUNT,
  PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT,
} from "@magna/passport-wrapper-proof/safe";
import {
  MAGNA_RECOVERY_PROOF_MAX_AGE_SECONDS,
  computeRecoveryIntent,
  computeRecoveryMessageSecretHash,
  formatRecoveryBindCustomData,
} from "@magna/recovery-v3/protocol";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createAztecNodeDebugClient } from "@aztec/stdlib/interfaces/client";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import {
  compressedOuterProof,
  localDisclosures,
  profileFacematch,
  secureRandomField,
  type VerifiedPassportCompletion,
} from "./passport-issuance";

export type RecoveryV3NetworkContext = {
  ethereumChainId: bigint;
  recoveryPortalL1Address: Hex;
  aztecProtocolVersion: bigint;
  aztecChainId: bigint;
  issuerL2Address: Hex;
};

export type PreparedRecoveryV3Request = {
  destination: Hex;
  recoveryNonce: bigint;
  messageSecret: bigint;
  messageSecretHash: bigint;
  recoveryIntent: bigint;
  bindCustomData: string;
};

export type RecoveryV3MutationEvidence = {
  privateWitnessMutationsRejected: string[];
  evmMutationsRejected: string[];
  replayRejected: boolean;
  wrapperProofHash: Hex;
};

const LOCAL_ANVIL_CHAIN_ID = 31_337n;
// Keep this aligned with scripts/check-localnet-drift.mjs. The Aztec node's
// default Ethereum-client tolerance is 300s; 180s leaves room to stop before
// the local sequencer starts rejecting otherwise valid transactions.
export const LOCAL_RECOVERY_CLOCK_DRIFT_DANGER_SECONDS = 180n;

export function assertLocalRecoveryClockReadyForScan(
  latestBlockTimestamp: bigint,
  wallTimestamp: bigint,
  ethereumChainId: bigint,
): bigint {
  const drift = latestBlockTimestamp - wallTimestamp;
  if (
    ethereumChainId === LOCAL_ANVIL_CHAIN_ID &&
    drift >= LOCAL_RECOVERY_CLOCK_DRIFT_DANGER_SECONDS
  ) {
    throw new Error(
      `Local Aztec chain clock is ${drift}s ahead of the host before zkPassport scanning ` +
        `(L1 ${latestBlockTimestamp}, host ${wallTimestamp}). Either restart the local network and rerun both local ` +
        "bootstraps, or leave it idle until npm run localnet:drift reports healthy, before requesting a proof. " +
        "A fresh passport scan by itself cannot repair a monotonic chain clock.",
    );
  }
  return drift;
}

export async function preflightRecoveryV3LocalClock(
  l1RpcUrl: string,
  expectedEthereumChainId: bigint,
): Promise<bigint> {
  const client = createPublicClient({ transport: http(l1RpcUrl) });
  const actualChainId = BigInt(await client.getChainId());
  if (actualChainId !== expectedEthereumChainId) {
    throw new Error(
      `Recovery V3 L1 chain mismatch before zkPassport scanning. expected=${expectedEthereumChainId} actual=${actualChainId}`,
    );
  }
  const latestBlock = await client.getBlock();
  return assertLocalRecoveryClockReadyForScan(
    latestBlock.timestamp,
    BigInt(Math.floor(Date.now() / 1_000)),
    actualChainId,
  );
}

export function recoveryL1ClockNeedsWarp(latestBlockTimestamp: bigint, proofTimestamp: bigint): boolean {
  return latestBlockTimestamp < proofTimestamp;
}

export function recoveryDevClockWarpTarget(proofTimestamp: bigint, wallTimestamp: bigint): number {
  if (proofTimestamp > wallTimestamp) {
    throw new Error(
      `Authenticated proof date is ahead of the browser wall clock (${proofTimestamp} > ${wallTimestamp}). ` +
        "Correct the host clock before retrying; the local chain will not be advanced into the future to accept it.",
    );
  }
  if (proofTimestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Authenticated proof date cannot be represented safely by the Aztec debug API.");
  }
  // Advance only as far as the authenticated proof requires. Using browser
  // wall time here unnecessarily burns part (or all) of the portal's strict
  // freshness window when a developer machine or an earlier run has a clock
  // offset. Aztec may round this up to its next slot boundary; the post-warp
  // freshness check below measures the actual resulting L1 block.
  return Number(proofTimestamp);
}

export function assertRecoveryProofFreshAtL1(
  latestBlockTimestamp: bigint,
  proofTimestamp: bigint,
  ethereumChainId: bigint,
  wallTimestamp: bigint = BigInt(Math.floor(Date.now() / 1_000)),
): bigint {
  if (proofTimestamp > wallTimestamp) {
    throw new Error(
      `Authenticated recovery proof date is ahead of the host clock (${proofTimestamp} > ${wallTimestamp}).`,
    );
  }
  if (latestBlockTimestamp < proofTimestamp) {
    throw new Error(
      `L1 block timestamp is still behind the authenticated recovery proof date ` +
        `(${latestBlockTimestamp} < ${proofTimestamp}).`,
    );
  }

  const proofAge = latestBlockTimestamp - proofTimestamp;
  if (proofAge >= MAGNA_RECOVERY_PROOF_MAX_AGE_SECONDS) {
    const policy = `the portal requires age < ${MAGNA_RECOVERY_PROOF_MAX_AGE_SECONDS}s`;
    if (ethereumChainId === LOCAL_ANVIL_CHAIN_ID) {
      const chainDrift = latestBlockTimestamp - wallTimestamp;
      const hostProofAge = wallTimestamp - proofTimestamp;
      throw new Error(
        `Local L1 rejected a host-fresh recovery proof because its clock is drifted: the proof is ` +
          `${hostProofAge}s old by host time, but L1 ${latestBlockTimestamp} is ${chainDrift}s ahead of host time ` +
          `and therefore sees proof age ${proofAge}s; ${policy}. Restart the local Aztec network and rerun both ` +
          "local bootstraps, or leave the network idle until npm run localnet:drift reports healthy and then scan " +
          "again. Magna will not rewrite the authenticated proof date or weaken the portal freshness policy.",
      );
    }
    throw new Error(
      `Authenticated recovery proof is stale on L1: block timestamp ${latestBlockTimestamp} is ` +
        `${proofAge}s after proof date ${proofTimestamp}, and ${policy}. Request a fresh proof.`,
    );
  }
  return proofAge;
}

export type RecoveryV3LocalClockSyncEvidence = {
  method: "aztecDebug_warpL2TimeAtLeastTo";
  requestedTimestamp: bigint;
  fromBlockNumber: bigint;
  fromBlockHash: Hex;
  fromBlockTimestamp: bigint;
  toBlockNumber: bigint;
  toBlockHash: Hex;
  toBlockTimestamp: bigint;
};

export type RecoveryV3LocalContracts = {
  rootRegistryAddress: Hex;
  certificateRegistryAddress: Hex;
  circuitRegistryAddress: Hex;
  recoveryPortalAddress: Hex;
};

const inboxAbi = parseAbi(["function LAG() view returns (uint256)"]);

export function recoveryLocalCheckpointAdvanceLimit(inboxLag: bigint): number {
  if (inboxLag < 1n || inboxLag > 64n) {
    throw new Error(`Canonical Inbox returned an invalid local checkpoint lag: ${inboxLag}.`);
  }
  // One checkpoint can be needed for the archiver to observe the L1 event,
  // followed by the configured Inbox lag. Keep one final bounded attempt for
  // the checkpoint that makes the resulting tree membership queryable.
  return Number(inboxLag) + 2;
}

export function recoveryLocalCheckpointWaitSeconds(
  latestBlockTimestamp: bigint,
  wallTimestamp: bigint,
): bigint {
  return latestBlockTimestamp >= wallTimestamp
    ? latestBlockTimestamp - wallTimestamp + 1n
    : 0n;
}

export async function waitForRecoveryV3InboxMessage(input: {
  aztecNodeUrl: string;
  l1RpcUrl: string;
  inboxLeaf: Hex;
  expectedLeafIndex: bigint;
  enableLocalCheckpointAdvancement: boolean;
  attempts?: number;
  pollMs?: number;
}): Promise<{ localCheckpointsAdvanced: number }> {
  const node = createAztecNodeClient(input.aztecNodeUrl);
  const messageLeaf = Fr.fromHexString(input.inboxLeaf);
  const attempts = input.attempts ?? 180;
  const pollMs = input.pollMs ?? 2_000;
  let lastError: unknown;

  const assertWitnessIndex = (
    witness: Awaited<ReturnType<typeof node.getL1ToL2MessageMembershipWitness>>,
  ) => {
    if (witness && witness[0] !== input.expectedLeafIndex) {
      throw new Error(
        `Canonical Inbox index mismatch: portal=${input.expectedLeafIndex} Aztec=${witness[0]}.`,
      );
    }
  };

  if (input.enableLocalCheckpointAdvancement) {
    const nodeInfo = await node.getNodeInfo();
    const nodeChainId = BigInt(nodeInfo.l1ChainId);
    if (nodeChainId !== LOCAL_ANVIL_CHAIN_ID) {
      throw new Error(
        `Refusing Recovery V3 debug checkpoint advancement on chain ${nodeChainId}; ` +
          `only local Anvil chain ${LOCAL_ANVIL_CHAIN_ID} is allowed.`,
      );
    }
    const l1 = createPublicClient({ transport: http(input.l1RpcUrl) });
    const l1ChainId = BigInt(await l1.getChainId());
    if (l1ChainId !== LOCAL_ANVIL_CHAIN_ID) {
      throw new Error(`Recovery V3 local L1 RPC reports unexpected chain ${l1ChainId}.`);
    }
    const inboxAddress = nodeInfo.l1ContractAddresses.inboxAddress.toString() as Hex;
    const inboxLag = await l1.readContract({
      address: inboxAddress,
      abi: inboxAbi,
      functionName: "LAG",
    });
    const advanceLimit = recoveryLocalCheckpointAdvanceLimit(inboxLag);
    const debug = createAztecNodeDebugClient(input.aztecNodeUrl);
    const advanceClockPacedCheckpoint = async () => {
      while (true) {
        const latestBlock = await l1.getBlock();
        const wallTimestamp = BigInt(Math.floor(Date.now() / 1_000));
        const drift = latestBlock.timestamp - wallTimestamp;
        if (drift >= LOCAL_RECOVERY_CLOCK_DRIFT_DANGER_SECONDS) {
          throw new Error(
            `Refusing another local Recovery V3 checkpoint while L1 is ${drift}s ahead of the host. ` +
              "Restart with npm run network:local and rerun both local bootstraps; checkpoint pacing cannot " +
              "move an existing monotonic chain backwards.",
          );
        }
        const waitSeconds = recoveryLocalCheckpointWaitSeconds(latestBlock.timestamp, wallTimestamp);
        if (waitSeconds === 0n) {
          const beforeL2Block = await node.getBlockNumber();
          await debug.warpL2TimeAtLeastTo(Number(wallTimestamp));
          if ((await node.getBlockNumber()) > beforeL2Block) return;
          // An unrelated L1 update can win the race and make the absolute
          // target a no-op. Re-read both clocks without consuming the bounded
          // checkpoint allowance.
          continue;
        }
        await new Promise(resolve => setTimeout(resolve, Number(waitSeconds > 1n ? 1_000n : waitSeconds * 1_000n)));
      }
    };
    for (let advanced = 0; advanced <= advanceLimit; advanced += 1) {
      const witness = await node.getL1ToL2MessageMembershipWitness("latest", messageLeaf);
      assertWitnessIndex(witness);
      if (witness) return { localCheckpointsAdvanced: advanced };
      if (advanced === advanceLimit) break;
      await advanceClockPacedCheckpoint();
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let witness: Awaited<ReturnType<typeof node.getL1ToL2MessageMembershipWitness>>;
    try {
      witness = await node.getL1ToL2MessageMembershipWitness("latest", messageLeaf);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }
    assertWitnessIndex(witness);
    if (witness) {
      return { localCheckpointsAdvanced: 0 };
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  const suffix = lastError instanceof Error ? ` Last node error: ${lastError.message}` : "";
  throw new Error(
    `Canonical Recovery V3 Inbox message was not committed on Aztec after ${attempts} checks.${suffix}`,
  );
}

const rootRegistryAbi = parseAbi([
  "function isRootValid(bytes32 registryId, bytes32 root, uint256 timestamp) view returns (bool)",
]);
const portalAbi = parseAbi([
  "function authorizeRecovery(uint256 proofVersion, bytes wrapperProof, bytes32[7] publicInputs) returns (bytes32 inboxLeaf, uint256 globalLeafIndex)",
  "event RecoveryAuthorizationSent(bytes32 indexed authorization, bytes32 indexed inboxLeaf, uint256 globalLeafIndex, bytes32 messageSecretHash, uint256 proofVersion, uint256 sourceBlock)",
]);
const registryId = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const noirFieldModulus =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// UltraKeccakZK recursive artifacts begin with eight pairing-point fields,
// followed by ten four-field G1 commitments. The next field is libraSum.
// This ordering is fixed by bb.js 5.0.0's generated ZKTranscriptLib; unlike
// the pairing-point prefix, libraSum is absorbed into the Fiat-Shamir
// transcript and used as the initial sumcheck target.
const ZKPASSPORT_LIBRA_SUM_PRIVATE_PROOF_INDEX = 8 + 10 * 4;

export async function prepareRecoveryV3Request(
  network: RecoveryV3NetworkContext,
  destination: Hex,
): Promise<PreparedRecoveryV3Request> {
  const recoveryNonce = secureRandomField();
  const messageSecret = secureRandomField();
  const messageSecretHash = await computeRecoveryMessageSecretHash(messageSecret);
  const recoveryIntent = computeRecoveryIntent({ ...network, destination, recoveryNonce, messageSecretHash });
  return {
    destination,
    recoveryNonce,
    messageSecret,
    messageSecretHash,
    recoveryIntent,
    bindCustomData: formatRecoveryBindCustomData(recoveryIntent),
  };
}

export async function buildRecoveryV3DeveloperProof(
  completion: VerifiedPassportCompletion,
  ageThreshold: number,
  network: RecoveryV3NetworkContext,
  prepared: PreparedRecoveryV3Request,
  prove: (witness: RecoveryWrapperLocalWitness) => Promise<RecoveryWrapperProofArtifact>,
): Promise<RecoveryWrapperProofArtifact> {
  const witness = recoveryV3DeveloperWitness(completion, ageThreshold, network, prepared);
  const artifact = await prove(witness);
  if (artifact.metadata.bindCustomData !== prepared.bindCustomData) {
    throw new Error("Generated wrapper metadata does not match the pre-proof Recovery V3 Bind.");
  }
  return artifact;
}

function recoveryV3DeveloperWitness(
  completion: VerifiedPassportCompletion,
  ageThreshold: number,
  network: RecoveryV3NetworkContext,
  prepared: PreparedRecoveryV3Request,
): RecoveryWrapperLocalWitness {
  if (completion.proofProfile !== "development") {
    throw new Error("Gate B-dev accepts only the official zkPassport development proof profile.");
  }
  const disclosed = localDisclosures(completion, ageThreshold);
  const facematch = profileFacematch(completion);
  return {
    zkPassportOuterProof: compressedOuterProof(completion),
    nationalityAlpha3: disclosed.nationalityAlpha3,
    expiryTs: disclosed.expiryTs,
    minAgeProven: disclosed.minAgeProven,
    agePredicate: { minAge: ageThreshold, maxAge: 0 },
    facematch: {
      rootKeyLeaf: facematch.rootKeyLeaf,
      environment: "production",
      appIdHash: facematch.appIdHash,
      integrityPublicKeyHash: facematch.integrityPubkeyHash,
      mode: "regular",
    },
    recovery: {
      ...network,
      destination: prepared.destination,
      recoveryNonce: prepared.recoveryNonce,
      messageSecretHash: prepared.messageSecretHash,
    },
  };
}

function mutateHex(value: string, label: string): string {
  const offset = value.startsWith("0x") ? 2 : 0;
  const relative = value.slice(offset).search(/[0-9a-fA-F]/);
  if (relative < 0) throw new Error(`${label} is not a mutable hexadecimal value.`);
  const index = offset + relative;
  const replacement = value[index].toLowerCase() === "f" ? "e" : "f";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

/** zkPassport serializes the outer public inputs before the private proof
 * fields. Mutate the transcript-bound libraSum scalar while preserving
 * canonical field encoding so recursive verification—not parsing—rejects it. */
export function mutateZkPassportPrivateProofField(value: string): string {
  const prefix = value.startsWith("0x") ? "0x" : "";
  const hex = value.slice(prefix.length);
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 64 !== 0) {
    throw new Error("inner proof must be a field-aligned hexadecimal value.");
  }
  const totalFieldCount = PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT + PASSPORT_A2_INNER_PROOF_FIELD_COUNT;
  if (hex.length !== totalFieldCount * 64) {
    throw new Error(
      `inner proof must contain exactly ${PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT} public and ` +
        `${PASSPORT_A2_INNER_PROOF_FIELD_COUNT} private fields.`,
    );
  }
  const offset =
    (PASSPORT_A2_INNER_PUBLIC_INPUT_COUNT + ZKPASSPORT_LIBRA_SUM_PRIVATE_PROOF_INDEX) * 64;
  const original = BigInt(`0x${hex.slice(offset, offset + 64)}`);
  if (original >= noirFieldModulus) {
    throw new Error("inner proof libraSum is outside the Noir field modulus.");
  }
  const mutated = original + 1n < noirFieldModulus ? original + 1n : original - 1n;
  const encoded = mutated.toString(16).padStart(64, "0");
  return `${prefix}${hex.slice(0, offset)}${encoded}${hex.slice(offset + 64)}`;
}

export async function assertRecoveryV3PrivateMutationsRejected(input: {
  completion: VerifiedPassportCompletion;
  ageThreshold: number;
  network: RecoveryV3NetworkContext;
  prepared: PreparedRecoveryV3Request;
  assertRejected: (witness: RecoveryWrapperLocalWitness) => Promise<void>;
}): Promise<string[]> {
  const original = recoveryV3DeveloperWitness(
    input.completion,
    input.ageThreshold,
    input.network,
    input.prepared,
  );
  const mutations: Array<[string, RecoveryWrapperLocalWitness]> = [
    ["destination", { ...original, recovery: { ...original.recovery, destination: BigInt(original.recovery.destination) + 1n } }],
    ["nonce", { ...original, recovery: { ...original.recovery, recoveryNonce: BigInt(original.recovery.recoveryNonce) + 1n } }],
    ["message secret hash", { ...original, recovery: { ...original.recovery, messageSecretHash: BigInt(original.recovery.messageSecretHash) + 1n } }],
    ["expiry", { ...original, expiryTs: BigInt(original.expiryTs) + 86_400n }],
    [
      "inner proof",
      {
        ...original,
        zkPassportOuterProof: {
          ...original.zkPassportOuterProof,
          proof: mutateZkPassportPrivateProofField(original.zkPassportOuterProof.proof),
        },
      },
    ],
    [
      "inner VK hash",
      {
        ...original,
        zkPassportOuterProof: {
          ...original.zkPassportOuterProof,
          vkeyHash: mutateHex(original.zkPassportOuterProof.vkeyHash, "inner VK hash"),
        },
      },
    ],
  ];
  for (const [label, witness] of mutations) {
    try {
      await input.assertRejected(witness);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Recovery V3 ${label} mutation was not safely rejected: ${message}`, { cause: error });
    }
  }
  return mutations.map(([label]) => label);
}

async function writeAndWait(
  wallet: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  request: Parameters<typeof wallet.writeContract>[0],
): Promise<Hex> {
  const hash = await wallet.writeContract({ ...request, chain: null });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Local Recovery V3 transaction reverted: ${hash}`);
  return hash;
}

export async function submitRecoveryV3DeveloperAuthorization(input: {
  aztecNodeUrl: string;
  l1RpcUrl: string;
  relayerPrivateKey: Hex;
  network: RecoveryV3NetworkContext;
  contracts: RecoveryV3LocalContracts;
  artifact: RecoveryWrapperProofArtifact;
  sdkVerified: true;
}): Promise<{
  transactionHash: Hex;
  clockSync?: RecoveryV3LocalClockSyncEvidence;
  inboxLeaf: Hex;
  messageLeafIndex: bigint;
  evmMutationsRejected: string[];
  replayRejected: boolean;
  wrapperProofHash: Hex;
}> {
  if (!input.sdkVerified) throw new Error("Official SDK verification must pass before portal submission.");
  const account = privateKeyToAccount(input.relayerPrivateKey);
  const transport = http(input.l1RpcUrl);
  const publicClient = createPublicClient({ transport });
  const wallet = createWalletClient({ account, transport });
  if (BigInt(await publicClient.getChainId()) !== input.network.ethereumChainId) {
    throw new Error("Recovery V3 local L1 chain does not match the proof-bound network.");
  }
  const evm = serializeRecoveryProofForEvm(input.artifact.proof);
  const proofTimestamp = BigInt(input.artifact.outputs.proofCurrentDate);
  const wallTimestamp = BigInt(Math.floor(Date.now() / 1_000));
  let clockSync: RecoveryV3LocalClockSyncEvidence | undefined;

  // The Aztec local network owns a shared L1/L2 test clock. A plain Anvil
  // transaction advances only one second in this configuration and can leave
  // both chains hours behind after a suspended development session. Aztec
  // 5.1's debug warp is the supported local-network operation: it advances L1
  // and builds an empty L2 checkpoint at the next slot boundary atomically.
  // The target is the authenticated proof date, not browser wall time, so the
  // synchronization does not unnecessarily consume the one-hour proof window.
  let latestBlock = await publicClient.getBlock();
  if (recoveryL1ClockNeedsWarp(latestBlock.timestamp, proofTimestamp)) {
    if (input.network.ethereumChainId !== LOCAL_ANVIL_CHAIN_ID) {
      throw new Error(
        `Refusing to warp L1 time on chain ${input.network.ethereumChainId}; ` +
          `automatic Recovery V3 clock synchronization is restricted to local Anvil chain ${LOCAL_ANVIL_CHAIN_ID}.`,
      );
    }
    if (latestBlock.hash === null) throw new Error("Latest local L1 block has no hash.");
    const warpTarget = recoveryDevClockWarpTarget(proofTimestamp, wallTimestamp);
    const requestedTimestamp = BigInt(warpTarget);
    const fromBlock = latestBlock;
    try {
      await createAztecNodeDebugClient(input.aztecNodeUrl).warpL2TimeAtLeastTo(warpTarget);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Aztec local-node clock synchronization failed through aztecDebug_warpL2TimeAtLeastTo: ${message}`,
        { cause: error },
      );
    }
    latestBlock = await publicClient.getBlock();
    if (latestBlock.hash === null) throw new Error("Warped local L1 block has no hash.");
    if (recoveryL1ClockNeedsWarp(latestBlock.timestamp, proofTimestamp)) {
      throw new Error(
        `Aztec local-node clock synchronization completed but L1 is still behind the authenticated proof date ` +
          `(${latestBlock.timestamp} < ${proofTimestamp}).`,
      );
    }
    clockSync = {
      method: "aztecDebug_warpL2TimeAtLeastTo",
      requestedTimestamp,
      fromBlockNumber: fromBlock.number,
      fromBlockHash: fromBlock.hash,
      fromBlockTimestamp: fromBlock.timestamp,
      toBlockNumber: latestBlock.number,
      toBlockHash: latestBlock.hash,
      toBlockTimestamp: latestBlock.timestamp,
    };
  }
  assertRecoveryProofFreshAtL1(
    latestBlock.timestamp,
    proofTimestamp,
    input.network.ethereumChainId,
    wallTimestamp,
  );
  const roots = [
    {
      id: registryId(1n),
      root: evm.publicInputs[4],
    },
    {
      id: registryId(2n),
      root: evm.publicInputs[5],
    },
  ] as const;

  // The bootstrap resolves and content-validates these roots independently
  // from zkPassport's official Sepolia registry. The browser has no registry
  // oracle authority and cannot make a proof trust its own public inputs.
  for (const entry of roots) {
    const valid = await publicClient.readContract({
      address: input.contracts.rootRegistryAddress,
      abi: rootRegistryAbi,
      functionName: "isRootValid",
      args: [entry.id, entry.root, proofTimestamp],
    });
    if (!valid) {
      throw new Error(
        "The proof root is not in the independently seeded zkPassport developer registry. Re-run recovery-v3:bootstrap:local and request a fresh proof.",
      );
    }
  }

  async function expectPortalRejection(label: string, wrapperProof: Hex, publicInputs: readonly Hex[]) {
    let rejected = false;
    try {
      await publicClient.simulateContract({
        account,
        address: input.contracts.recoveryPortalAddress,
        abi: portalAbi,
        functionName: "authorizeRecovery",
        args: [RECOVERY_WRAPPER_VERSION, wrapperProof, publicInputs as [Hex, Hex, Hex, Hex, Hex, Hex, Hex]],
      });
    } catch (error) {
      const revert = error instanceof BaseError
        ? error.walk(candidate => candidate instanceof ContractFunctionRevertedError)
        : undefined;
      if (!(revert instanceof ContractFunctionRevertedError)) throw error;
      rejected = true;
    }
    if (!rejected) throw new Error(`Recovery portal accepted the ${label} mutation.`);
  }

  // Establish that all shared portal preconditions pass before crediting any
  // mutation rejection. Otherwise one unrelated failure (for example a stale
  // local block timestamp) could make every negative test appear successful.
  try {
    await publicClient.simulateContract({
      account,
      address: input.contracts.recoveryPortalAddress,
      abi: portalAbi,
      functionName: "authorizeRecovery",
      args: [RECOVERY_WRAPPER_VERSION, evm.wrapperProof, evm.publicInputs],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unmodified Recovery V3 portal proof failed baseline simulation: ${message}`, { cause: error });
  }

  const evmMutationsRejected: string[] = [];
  await expectPortalRejection(
    "wrapper proof",
    mutateHex(evm.wrapperProof, "wrapper proof") as Hex,
    evm.publicInputs,
  );
  evmMutationsRejected.push("wrapper proof");
  for (let index = 0; index < evm.publicInputs.length; index += 1) {
    const mutated = [...evm.publicInputs] as [Hex, Hex, Hex, Hex, Hex, Hex, Hex];
    mutated[index] = mutateHex(mutated[index], `public input ${index}`) as Hex;
    await expectPortalRejection(`public input ${index}`, evm.wrapperProof, mutated);
    evmMutationsRejected.push(`public input ${index}`);
  }

  const transactionHash = await writeAndWait(wallet, publicClient, {
    account,
    chain: null,
    address: input.contracts.recoveryPortalAddress,
    abi: portalAbi,
    functionName: "authorizeRecovery",
    args: [RECOVERY_WRAPPER_VERSION, evm.wrapperProof, evm.publicInputs],
  });
  const receipt = await publicClient.getTransactionReceipt({ hash: transactionHash });
  await expectPortalRejection("replay", evm.wrapperProof, evm.publicInputs);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== input.contracts.recoveryPortalAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: portalAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "RecoveryAuthorizationSent") {
        return {
          transactionHash,
          clockSync,
          inboxLeaf: decoded.args.inboxLeaf,
          messageLeafIndex: decoded.args.globalLeafIndex,
          evmMutationsRejected,
          replayRejected: true,
          wrapperProofHash: keccak256(evm.wrapperProof),
        };
      }
    } catch {
      // Ignore non-portal events in the receipt.
    }
  }
  throw new Error("Recovery portal transaction succeeded without RecoveryAuthorizationSent evidence.");
}
