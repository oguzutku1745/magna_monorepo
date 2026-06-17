import { createAztecNodeClient } from "@aztec/aztec.js/node";

const WORLD_STATE_ANCHOR_ERROR_MARKERS = [
  "Block hash",
  "not found when querying world state",
  "anchor block hash",
] as const;

export function isAztecWorldStateAnchorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return WORLD_STATE_ANCHOR_ERROR_MARKERS.every(marker => message.includes(marker));
}

export function getEmbeddedPxeDatabaseName(rollupAddress: string): string {
  return `pxe_data_${rollupAddress}/pxe_data`;
}

function deleteIndexedDbDatabase(databaseName: string): Promise<void> {
  const indexedDB = globalThis.indexedDB;
  if (!indexedDB) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete IndexedDB database ${databaseName}`));
    request.onblocked = () => reject(new Error(`IndexedDB database ${databaseName} is blocked by another open connection`));
  });
}

export async function clearEmbeddedPxeCacheForNode(nodeUrl: string): Promise<void> {
  const node = createAztecNodeClient(nodeUrl);
  const l1Contracts = await node.getL1ContractAddresses();
  await deleteIndexedDbDatabase(getEmbeddedPxeDatabaseName(l1Contracts.rollupAddress.toString()));
}
