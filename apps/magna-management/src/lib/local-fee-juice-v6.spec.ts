import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  ready: vi.fn(async () => true), witness: vi.fn(async () => [7n, {}]),
  read: vi.fn(async () => { throw Error("V6 Inbox has no LAG"); }),
  warp: vi.fn(async () => undefined), send: vi.fn(async () => ({receipt:{txHash:"0x123"}})),
  block: vi.fn(async () => 1),
  l1Block: vi.fn(async () => ({timestamp:1n})),
}));
vi.mock("@aztec-labs/aztec.js/node", () => ({createAztecNodeClient:()=>({
  getNodeInfo:async()=>({l1ChainId:31337,l1ContractAddresses:{inboxAddress:"0x123"}}),getBlockNumber:m.block,
})}));
vi.mock("@aztec-labs/aztec.js/messaging",()=>({isL1ToL2MessageReady:m.ready}));
vi.mock("@aztec-labs/aztec.js/utils",()=>({getFeeJuiceBalance:async()=>0n}));
vi.mock("@aztec-labs/aztec.js/ethereum",()=>({L1FeeJuicePortalManager:{new:async()=>({bridgeTokensPublic:async()=>({messageHash:`0x${"1".padStart(64,"0")}`,messageLeafIndex:7n,claimSecret:{},claimAmount:10n})})}}));
vi.mock("@aztec-labs/ethereum/client",()=>({createExtendedL1Client:()=>({})}));
vi.mock("@aztec-labs/aztec.js/protocol",()=>({ProtocolContractAddress:{FeeJuice:"0x123"},FeeJuiceContract:{at:()=>({methods:{claim:()=>({send:m.send})}})}}));
vi.mock("@aztec-labs/stdlib/interfaces/client",()=>({createAztecNodeDebugClient:()=>({warpL2TimeAtLeastTo:m.warp})}));
vi.mock("@aztec-labs/stdlib/messaging",()=>({getNonNullifiedL1ToL2MessageWitness:m.witness}));
vi.mock("../../../../packages/magna-wallet/src/embedded/lifecycle.js",()=>({ensureImportedLocalTestAccountAddress:async()=>"0x123"}));
vi.mock("viem",async original=>({...await original<typeof import("viem")>(),createPublicClient:()=>({getChainId:async()=>31337,getBlock:m.l1Block,readContract:m.read})}));
import { fundLocalFeeJuice } from "../../../../packages/magna-wallet/src/browser/local-fee-juice";
const options={wallet:{} as never,recipient:`0x${"1".padStart(64,"0")}`,nodeUrl:"http://node",l1RpcUrl:"http://l1",l1PrivateKey:`0x${"1".repeat(64)}` as `0x${string}`};
beforeEach(()=>{vi.clearAllMocks(); m.ready.mockResolvedValue(true); m.witness.mockResolvedValue([7n,{}]);m.l1Block.mockResolvedValue({timestamp:1n});});
afterEach(()=>vi.useRealTimers());
it("claims an already included V6 message without querying LAG or warping",async()=>{
  const result=await fundLocalFeeJuice(options);
  expect(result.localCheckpointsAdvanced).toBe(0);
  expect(m.read).not.toHaveBeenCalled(); expect(m.warp).not.toHaveBeenCalled(); expect(m.send).toHaveBeenCalledOnce();
});
it("rejects a mismatched Fee Juice leaf before claiming",async()=>{
  m.witness.mockResolvedValueOnce([8n,{}]);
  await expect(fundLocalFeeJuice(options)).rejects.toThrow(/index mismatch/);expect(m.send).not.toHaveBeenCalled();
});

it("waits for committed inclusion before claiming and stops within three minutes",async()=>{
  vi.useFakeTimers();m.ready.mockResolvedValue(false);let block=0;m.block.mockImplementation(async()=>block++);
  const progress=vi.fn();
  const pending=fundLocalFeeJuice({...options,onProgress:progress});const rejected=expect(pending).rejects.toThrow(/exceeded three minutes/);
  await vi.waitFor(()=>expect(progress).toHaveBeenCalledWith("waiting_for_inbox"));
  await vi.advanceTimersByTimeAsync(180_000);await rejected;
  expect(m.witness).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();
});
it("keeps the 180-second local clock drift refusal before requesting another checkpoint",async()=>{
  m.ready.mockResolvedValue(false);m.l1Block.mockResolvedValue({timestamp:BigInt(Math.floor(Date.now()/1000))+180n});
  await expect(fundLocalFeeJuice(options)).rejects.toThrow(/180s ahead/);expect(m.warp).not.toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
