import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec/aztec.js/utils";
import type { Wallet } from "@aztec/aztec.js/wallet";

const LOCAL_ANVIL_CHAIN_ID = 31_337n;
const LOCAL_CLOCK_DRIFT_DANGER_SECONDS = 180n;

export type LocalFeeJuiceFundingProgress =
  | "checking"
  | "bridging"
  | "waiting_for_inbox"
  | "claiming";

export type LocalFeeJuiceFundingOptions = {
  wallet: Wallet;
  recipient: string;
  nodeUrl: string;
  l1RpcUrl: string;
  l1PrivateKey: `0x${string}`;
  localTestAccountIndex?: number;
  onProgress?: (progress: LocalFeeJuiceFundingProgress) => void;
};

export type LocalFeeJuiceFundingResult = {
  recipient: string;
  claimTxHash: string;
  claimAmount: bigint;
  balanceBefore: bigint;
  balanceAfter: bigint;
  localCheckpointsAdvanced: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertLocalPrivateKey(value: string): asserts value is `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Local Fee Juice faucet requires a 32-byte Anvil private key.");
  }
}

async function assertLocalFundingNetwork(nodeUrl: string, l1RpcUrl: string) {
  const { createPublicClient, http } = await import("viem");
  const node = createAztecNodeClient(nodeUrl);
  const nodeInfo = await node.getNodeInfo();
  const nodeChainId = BigInt(nodeInfo.l1ChainId);
  if (nodeChainId !== LOCAL_ANVIL_CHAIN_ID) {
    throw new Error(`Local Fee Juice faucet refuses Aztec node L1 chain ${nodeChainId}.`);
  }

  const l1 = createPublicClient({ transport: http(l1RpcUrl) });
  const l1ChainId = BigInt(await l1.getChainId());
  if (l1ChainId !== LOCAL_ANVIL_CHAIN_ID) {
    throw new Error(`Local Fee Juice faucet refuses L1 chain ${l1ChainId}.`);
  }
  return { node, nodeInfo, l1 };
}

export async function readLocalFeeJuiceBalance(nodeUrl: string, recipient: string): Promise<bigint> {
  const node = createAztecNodeClient(nodeUrl);
  return getFeeJuiceBalance(AztecAddress.fromStringUnsafe(recipient), node);
}

export async function fundLocalFeeJuice(
  options: LocalFeeJuiceFundingOptions,
): Promise<LocalFeeJuiceFundingResult> {
  assertLocalPrivateKey(options.l1PrivateKey);
  options.onProgress?.("checking");
  const { node, nodeInfo, l1 } = await assertLocalFundingNetwork(options.nodeUrl, options.l1RpcUrl);
  const recipient = AztecAddress.fromStringUnsafe(options.recipient);
  const balanceBefore = await getFeeJuiceBalance(recipient, node);

  const [
    { L1FeeJuicePortalManager },
    { FeeJuiceContract, ProtocolContractAddress },
    { createExtendedL1Client },
    { createLogger },
    { createAztecNodeDebugClient },
    { getNonNullifiedL1ToL2MessageWitness },
    { parseAbi },
  ] = await Promise.all([
    import("@aztec/aztec.js/ethereum"),
    import("@aztec/aztec.js/protocol"),
    import("@aztec/ethereum/client"),
    import("@aztec/foundation/log"),
    import("@aztec/stdlib/interfaces/client"),
    import("@aztec/stdlib/messaging"),
    import("viem"),
  ]);
  const inboxAbi = parseAbi(["function LAG() view returns (uint256)"]);

  options.onProgress?.("bridging");
  const l1Client = createExtendedL1Client([options.l1RpcUrl], options.l1PrivateKey);
  const portalManager = await L1FeeJuicePortalManager.new(
    node,
    l1Client,
    createLogger("magna:browser-local-fee-juice"),
  );
  const claim = await portalManager.bridgeTokensPublic(recipient, undefined, true);

  options.onProgress?.("waiting_for_inbox");
  const inboxAddress = nodeInfo.l1ContractAddresses.inboxAddress.toString() as `0x${string}`;
  const inboxLag = await l1.readContract({
    address: inboxAddress,
    abi: inboxAbi,
    functionName: "LAG",
  });
  if (inboxLag < 1n || inboxLag > 64n) {
    throw new Error(`Canonical Inbox returned invalid local lag ${inboxLag}.`);
  }
  const checkpointLimit = Number(inboxLag) + 2;
  const debug = createAztecNodeDebugClient(options.nodeUrl);
  const advanceClockPacedCheckpoint = async () => {
    while (true) {
      const latestBlock = await l1.getBlock();
      const wallTimestamp = BigInt(Math.floor(Date.now() / 1_000));
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
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  };
  let localCheckpointsAdvanced = 0;
  let witness: Awaited<ReturnType<typeof getNonNullifiedL1ToL2MessageWitness>> | undefined;
  let lastWitnessError = "message not indexed yet";
  for (let attempt = 0; attempt <= checkpointLimit; attempt += 1) {
    try {
      witness = await getNonNullifiedL1ToL2MessageWitness(
        node,
        ProtocolContractAddress.FeeJuice,
        Fr.fromHexString(claim.messageHash),
        claim.claimSecret,
      );
    } catch (error) {
      lastWitnessError = errorMessage(error);
    }
    if (witness) break;
    if (attempt === checkpointLimit) {
      throw new Error(
        `Fee Juice Inbox message was not committed after ${checkpointLimit} local checkpoints. ` +
          `last_error=${lastWitnessError}`,
      );
    }
    await advanceClockPacedCheckpoint();
    localCheckpointsAdvanced += 1;
  }
  if (!witness) {
    throw new Error("Fee Juice Inbox witness was unavailable after local checkpoint advancement.");
  }
  if (witness[0] !== claim.messageLeafIndex) {
    throw new Error(`Fee Juice Inbox index mismatch: portal=${claim.messageLeafIndex} Aztec=${witness[0]}.`);
  }

  options.onProgress?.("claiming");
  const { ensureImportedLocalTestAccountAddress } = await import("../embedded/lifecycle.js");
  const feePayer = await ensureImportedLocalTestAccountAddress(
    options.wallet as Parameters<typeof ensureImportedLocalTestAccountAddress>[0],
    options.localTestAccountIndex ?? 0,
  );
  const claimReceipt = await FeeJuiceContract.at(options.wallet).methods
    .claim(recipient, claim.claimAmount, claim.claimSecret, claim.messageLeafIndex)
    .send({ from: feePayer });
  const balanceAfter = await getFeeJuiceBalance(recipient, node);

  return {
    recipient: recipient.toString(),
    claimTxHash: claimReceipt.receipt.txHash.toString(),
    claimAmount: claim.claimAmount,
    balanceBefore,
    balanceAfter,
    localCheckpointsAdvanced,
  };
}
