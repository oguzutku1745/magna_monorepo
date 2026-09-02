import test from "node:test";
import assert from "node:assert/strict";
import { fundLocalFeeJuice } from "./local-fee-juice.js";

test("local Fee Juice funding rejects malformed faucet keys before contacting a network", async () => {
  await assert.rejects(
    fundLocalFeeJuice({
      wallet: {} as never,
      recipient: "0x01",
      nodeUrl: "http://127.0.0.1:8080",
      l1RpcUrl: "http://127.0.0.1:8545",
      l1PrivateKey: "0x01" as `0x${string}`,
    }),
    /32-byte Anvil private key/,
  );
});
