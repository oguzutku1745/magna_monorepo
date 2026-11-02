import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  witness: vi.fn(async () => undefined),
  blockNumber: vi.fn(),
  warp: vi.fn(async () => undefined),
  readContract: vi.fn(async () => { throw new Error("V6 Inbox has no LAG"); }),
  messageIndex: vi.fn(async () => 0n),
  blockData: vi.fn(async () => ({header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:1}}}})),
}));
vi.mock("@aztec-labs/aztec.js/node", () => ({
  createAztecNodeClient: () => ({
    getNodeInfo: async () => ({ l1ChainId: 31337, l1ContractAddresses: { inboxAddress: "0x123" } }),
    getBlockNumber: mocks.blockNumber,
    getBlockData: mocks.blockData,
    getL1ToL2MessageIndex: mocks.messageIndex,
    getL1ToL2MessageMembershipWitness: mocks.witness,
  }),
}));
vi.mock("@aztec-labs/stdlib/interfaces/client", () => ({
  createAztecNodeDebugClient: () => ({ warpL2TimeAtLeastTo: mocks.warp }),
}));
vi.mock("viem", async importOriginal => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({
    getChainId: async () => 31337,
    getBlock: async () => ({ timestamp: 1n }),
    readContract: mocks.readContract,
  }),
}));
import { waitForRecoveryV3InboxMessage } from "./recovery-v3";

beforeEach(() => { vi.clearAllMocks(); mocks.witness.mockResolvedValue(undefined); });
afterEach(() => vi.useRealTimers());
const input = {aztecNodeUrl:"http://local-node", l1RpcUrl:"http://local-l1", inboxLeaf:`0x${"1".padStart(64,"0")}` as `0x${string}`, expectedLeafIndex:0n, enableLocalCheckpointAdvancement:true};
it("accepts an already committed V6 message without reading LAG or advancing a checkpoint", async () => {
  mocks.witness.mockResolvedValue([0n, {}] as never);
  expect(await waitForRecoveryV3InboxMessage(input)).toEqual({localCheckpointsAdvanced:0});
  expect(mocks.readContract).not.toHaveBeenCalled();
  expect(mocks.warp).not.toHaveBeenCalled();
});
it("rejects the wrong observed leaf index", async () => {
  mocks.witness.mockResolvedValue([1n, {}] as never);
  await expect(waitForRecoveryV3InboxMessage(input)).rejects.toThrow(/index mismatch/);
});
it("does not accept an indexed message outside the committed tree", async () => {
  mocks.witness.mockResolvedValue([0n, {}] as never);
  mocks.blockData.mockResolvedValueOnce({header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:0}}}});
  let block=0; mocks.blockNumber.mockImplementation(async()=>block++);
  expect(await waitForRecoveryV3InboxMessage({...input,pollMs:1})).toEqual({localCheckpointsAdvanced:1});
});
it("stops a local missing-Inbox wait after the shared three-minute budget", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-06T00:00:00Z"));
  let block = 0;
  mocks.blockNumber.mockImplementation(async () => block++);
  const pending = waitForRecoveryV3InboxMessage({
    aztecNodeUrl: "http://local-node", l1RpcUrl: "http://local-l1",
    inboxLeaf: `0x${"1".padStart(64, "0")}`, expectedLeafIndex: 0n,
    enableLocalCheckpointAdvancement: true,
  });
  const rejected = expect(pending).rejects.toThrow(/exceeded three minutes/);
  await vi.advanceTimersByTimeAsync(180_000);
  await rejected;
  expect(mocks.warp.mock.calls.length).toBeGreaterThan(4);
  expect(mocks.readContract).not.toHaveBeenCalled();
});
