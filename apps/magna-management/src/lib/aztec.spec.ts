import { describe, expect, it } from "vitest";
import { recoveryTransactionChainStateFromReceipt } from "./aztec";

describe("Recovery V3 transaction chain state", () => {
  it("confirms only a mined transaction with successful execution", () => {
    expect(
      recoveryTransactionChainStateFromReceipt({
        status: "proven",
        executionResult: "success",
        blockNumber: 38,
      }),
    ).toEqual({ status: "confirmed", txStatus: "proven", blockNumber: 38 });
  });

  it("keeps an unmined transaction pending", () => {
    expect(recoveryTransactionChainStateFromReceipt({ status: "pending" })).toEqual({
      status: "pending",
      txStatus: "pending",
    });
  });

  it.each([
    { status: "dropped", error: "removed from pool" },
    { status: "proven", executionResult: "reverted", blockNumber: 39 },
  ])("rejects a non-successful receipt: $status/$executionResult", receipt => {
    expect(recoveryTransactionChainStateFromReceipt(receipt)).toMatchObject({
      status: "rejected",
      txStatus: receipt.status,
    });
  });
});
