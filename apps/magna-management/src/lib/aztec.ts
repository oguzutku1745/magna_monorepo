import type { ChainInfo } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TxExecutionResult, TxHash, TxStatus } from "@aztec/aztec.js/tx";

export type RecoveryTransactionChainState = {
  status: "confirmed" | "pending" | "rejected" | "unavailable";
  txStatus: string;
  blockNumber?: number;
  message?: string;
};

type RecoveryTransactionReceipt = {
  status: string;
  executionResult?: string;
  blockNumber?: number | bigint;
  error?: string;
};

export async function getChainInfo(nodeUrl: string): Promise<ChainInfo> {
  const node = createAztecNodeClient(nodeUrl);
  const info = await node.getNodeInfo();
  return {
    chainId: new Fr(info.l1ChainId),
    version: new Fr(info.rollupVersion),
  };
}

/** Reads Recovery V3 transaction inclusion/execution directly from Aztec. */
export async function getRecoveryTransactionChainState(
  nodeUrl: string,
  txHash: string,
): Promise<RecoveryTransactionChainState> {
  const receipt = await createAztecNodeClient(nodeUrl).getTxReceipt(TxHash.fromString(txHash));
  return recoveryTransactionChainStateFromReceipt(receipt);
}

export function recoveryTransactionChainStateFromReceipt(
  receipt: RecoveryTransactionReceipt,
): RecoveryTransactionChainState {
  if (receipt.status === TxStatus.PENDING) {
    return { status: "pending", txStatus: receipt.status };
  }
  if (receipt.status === TxStatus.DROPPED || receipt.executionResult !== TxExecutionResult.SUCCESS) {
    return {
      status: "rejected",
      txStatus: receipt.status,
      ...(receipt.blockNumber === undefined ? {} : { blockNumber: Number(receipt.blockNumber) }),
      ...(receipt.error ? { message: receipt.error } : {}),
    };
  }
  if (receipt.blockNumber === undefined) {
    return { status: "pending", txStatus: receipt.status };
  }
  return {
    status: "confirmed",
    txStatus: receipt.status,
    blockNumber: Number(receipt.blockNumber),
  };
}
