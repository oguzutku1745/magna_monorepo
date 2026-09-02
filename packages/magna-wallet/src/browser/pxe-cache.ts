import { createAztecNodeClient } from "@aztec/aztec.js/node";

const WORLD_STATE_ANCHOR_ERROR_MARKERS = [
  "Block hash",
  "not found when querying world state",
  "anchor block hash",
] as const;
const BLOCK_STREAM_TIP_ERROR_MARKER = "Block hash not found for block number";

export function isAztecWorldStateAnchorError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    WORLD_STATE_ANCHOR_ERROR_MARKERS.every(marker => message.includes(marker)) ||
    message.includes(BLOCK_STREAM_TIP_ERROR_MARKER)
  );
}

const AZTEC_5_1_PXE_SCHEMA_VERSION = 13;
const AZTEC_5_1_WALLET_SCHEMA_VERSION = 1;

function embeddedStoreName(name: string, l1ChainId: string | number | bigint, rollupAddress: string, version: number) {
  return `${name}_${l1ChainId.toString()}-${rollupAddress}-v${version}`;
}

export function getEmbeddedPxeDatabaseName(l1ChainId: string | number | bigint, rollupAddress: string): string {
  return embeddedStoreName("pxe_data", l1ChainId, rollupAddress, AZTEC_5_1_PXE_SCHEMA_VERSION);
}

export function getEmbeddedWalletDatabaseName(l1ChainId: string | number | bigint, rollupAddress: string): string {
  return embeddedStoreName("wallet_data", l1ChainId, rollupAddress, AZTEC_5_1_WALLET_SCHEMA_VERSION);
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
  const { l1ChainId, l1ContractAddresses } = await node.getNodeInfo();
  const rollupAddress = l1ContractAddresses.rollupAddress.toString();
  const storeNames = [
    getEmbeddedPxeDatabaseName(l1ChainId, rollupAddress),
    getEmbeddedWalletDatabaseName(l1ChainId, rollupAddress),
  ];

  if (typeof navigator !== "undefined" && "storage" in navigator) {
    const { deleteStore, listStores } = await import("@aztec/kv-store/sqlite-opfs");
    const existing = new Set(await listStores());
    for (const storeName of storeNames) {
      if (existing.has(storeName)) await deleteStore(storeName);
    }
  }

  // Remove the pre-5.1 IndexedDB layout as well when upgrading an existing
  // developer browser profile. It is a no-op on clean profiles.
  await Promise.all([
    ...storeNames.map(deleteIndexedDbDatabase),
    deleteIndexedDbDatabase(`pxe_data_${rollupAddress}/pxe_data`),
  ]);
}
