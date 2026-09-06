import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  witness: vi.fn(async () => undefined),
  blockNumber: vi.fn(),
  warp: vi.fn(async () => undefined),
}));
vi.mock("@aztec/aztec.js/node", () => ({
  createAztecNodeClient: () => ({
    getNodeInfo: async () => ({ l1ChainId: 31337, l1ContractAddresses: { inboxAddress: "0x123" } }),
    getBlockNumber: mocks.blockNumber,
    getL1ToL2MessageMembershipWitness: mocks.witness,
  }),
}));
vi.mock("@aztec/stdlib/interfaces/client", () => ({
  createAztecNodeDebugClient: () => ({ warpL2TimeAtLeastTo: mocks.warp }),
}));
vi.mock("viem", async importOriginal => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => ({
    getChainId: async () => 31337,
    getBlock: async () => ({ timestamp: 1n }),
    readContract: async () => 2n,
  }),
}));
import { waitForRecoveryV3InboxMessage } from "./recovery-v3";

afterEach(() => vi.useRealTimers());
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
  expect(mocks.warp).toHaveBeenCalledTimes(4);
});
