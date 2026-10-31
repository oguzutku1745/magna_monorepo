import type { AztecNode } from "@aztec-labs/stdlib/interfaces/client";
import type { Fr } from "@aztec-labs/aztec.js/fields";
export function waitForCommittedInboxWitness<T extends readonly [bigint, ...unknown[]]>(options: {
  node: AztecNode; nodeUrl: string; l1RpcUrl: string; messageHash: Fr; expectedIndex: bigint;
  getWitness: () => Promise<T>; timeoutMs?: number; pollMs?: number;
}): Promise<T>;
