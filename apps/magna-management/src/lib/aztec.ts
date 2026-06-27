import type { ChainInfo } from "@aztec/aztec.js/account";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient } from "@aztec/aztec.js/node";

export async function getChainInfo(nodeUrl: string): Promise<ChainInfo> {
  const node = createAztecNodeClient(nodeUrl);
  const info = await node.getNodeInfo();
  return {
    chainId: new Fr(info.l1ChainId),
    version: new Fr(info.rollupVersion),
  };
}
