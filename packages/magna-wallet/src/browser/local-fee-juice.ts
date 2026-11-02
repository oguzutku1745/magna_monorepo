import { isL1ToL2MessageReady } from "@aztec-labs/aztec.js/messaging";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { Fr } from "@aztec-labs/aztec.js/fields";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { getFeeJuiceBalance } from "@aztec-labs/aztec.js/utils";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";

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
  const { node, l1 } = await assertLocalFundingNetwork(options.nodeUrl, options.l1RpcUrl);
  const recipient = AztecAddress.fromStringUnsafe(options.recipient);
  const balanceBefore = await getFeeJuiceBalance(recipient, node);

  const [
    { L1FeeJuicePortalManager },
    { FeeJuiceContract, ProtocolContractAddress },
    { createExtendedL1Client },
    { createLogger },
    { createAztecNodeDebugClient },
    { getNonNullifiedL1ToL2MessageWitness },
  ] = await Promise.all([
    import("@aztec-labs/aztec.js/ethereum"),
    import("@aztec-labs/aztec.js/protocol"),
    import("@aztec-labs/ethereum/client"),
    import("@aztec-labs/foundation/log"),
    import("@aztec-labs/stdlib/interfaces/client"),
    import("@aztec-labs/stdlib/messaging"),
  ]);

  options.onProgress?.("bridging");
  const l1Client = createExtendedL1Client([options.l1RpcUrl], options.l1PrivateKey);
  const portalManager = await L1FeeJuicePortalManager.new(
    node,
    l1Client,
    createLogger("magna:browser-local-fee-juice"),
  );
  const claim = await portalManager.bridgeTokensPublic(recipient, undefined, true);

  options.onProgress?.("waiting_for_inbox");
  let lastWitnessError = "message not indexed yet";
  const deadline = Date.now() + 180_000;
  const assertBeforeDeadline = () => {
    if (Date.now() >= deadline) throw new Error(`Fee Juice Inbox wait exceeded three minutes. Check local node health. last_error=${lastWitnessError}`);
  };
  const debug = createAztecNodeDebugClient(options.nodeUrl);
  const advanceClockPacedCheckpoint = async () => {
    while (true) {
      assertBeforeDeadline();
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
        await new Promise(resolve => setTimeout(resolve, 1_000));
        continue;
      }
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  };
  let localCheckpointsAdvanced = 0;
  let witness: Awaited<ReturnType<typeof getNonNullifiedL1ToL2MessageWitness>> | undefined;
  while (true) {
    assertBeforeDeadline();
    try {
      if (await isL1ToL2MessageReady(node, Fr.fromHexString(claim.messageHash))) witness = await getNonNullifiedL1ToL2MessageWitness(
        node,
        ProtocolContractAddress.FeeJuice,
        Fr.fromHexString(claim.messageHash),
        claim.claimSecret,
      );
    } catch (error) {
      lastWitnessError = error instanceof Error ? error.message : String(error);
      // The archiver may not have observed the message yet; retry within the deadline.
    }
    if (witness) break;
    await advanceClockPacedCheckpoint();
    localCheckpointsAdvanced += 1;
    await new Promise(resolve => setTimeout(resolve, 1_000));
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
