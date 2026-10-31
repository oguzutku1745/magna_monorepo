import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedWallet } from "../../../../packages/magna-wallet/src/embedded/lifecycle";
import { clearEmbeddedPxeCacheForNode } from "../../../../packages/magna-wallet/src/browser/pxe-cache";

const state = vi.hoisted(() => ({
  stores: new Map<string, { close: ReturnType<typeof vi.fn>; marker: string }>(),
  options: [] as any[],
  fail: false,
  rollupAddress: { toString: () => "0xrollup" },
}));
vi.mock("@aztec-labs/aztec.js/node", () => ({
  createAztecNodeClient: () => ({ getNodeInfo: async () => ({
    l1ChainId: 31337, l1ContractAddresses: { rollupAddress: state.rollupAddress },
  }) }),
  waitForNode: async () => undefined,
}));
vi.mock("@aztec-labs/pxe/client/lazy", () => ({
  openBrowserStore: async (name: string, version: number, config: any) => {
    const id = `${name}_${config.l1ChainId}-${config.rollupAddress}-v${version}`;
    const store = state.stores.get(id) ?? { close: vi.fn(async () => undefined), marker: id };
    state.stores.set(id, store);
    return store;
  },
}));
vi.mock("@aztec-labs/kv-store/sqlite-opfs", () => ({
  openTmpStore: async (ephemeral: boolean) => {
    if (!ephemeral) throw new Error("Expected an in-memory store");
    return { close: vi.fn(async () => undefined), marker: "memory" };
  },
  listStores: async () => [...state.stores.keys()],
  deleteStore: async (name: string) => { state.stores.delete(name); },
}));
vi.mock("@aztec-labs/wallets/embedded", () => ({
  EmbeddedWallet: { create: async (_node: unknown, options: any) => {
    state.options.push(options);
    if (state.fail) throw new Error("PXE creation failed");
    return { options };
  } },
}));

// OPFS workers and an Aztec node are external boundaries. The fake store keeps
// identity and ownership observable without opening a real browser database.
describe("V6 embedded browser storage", () => {
  beforeEach(() => {
    state.stores.clear();
    state.options.length = 0;
    state.fail = false;
    vi.stubGlobal("window", {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("selects a V6 wallet store when a local chain repeats the V5 rollup identity", async () => {
    const old = { close: vi.fn(async () => undefined), marker: "V5 account scopes" };
    state.stores.set("wallet_data_31337-0xrollup-v1", old);
    await createEmbeddedWallet("http://node", false);
    const selected = state.options[0].walletDb?.store;
    expect(selected?.marker).toBe("magna_v6_wallet_data_31337-0xrollup-v1");
    expect(state.stores.get("wallet_data_31337-0xrollup-v1")).toBe(old);
    expect(old.close).not.toHaveBeenCalled();
  });

  it("closes the V6 wallet store if creating its PXE fails", async () => {
    state.fail = true;
    await expect(createEmbeddedWallet("http://node", false)).rejects.toThrow("PXE creation failed");
    expect(state.stores.get("magna_v6_wallet_data_31337-0xrollup-v1")?.close).toHaveBeenCalledOnce();
  });

  it("keeps two transient PXEs isolated and closes a failed transient store", async () => {
    await createEmbeddedWallet("http://node", true);
    await createEmbeddedWallet("http://node", true);
    const first = state.options[0].pxe.store;
    const second = state.options[1].pxe.store;
    expect(first).not.toBe(second);
    expect(first.marker).toBe("memory");
    expect(state.stores.size).toBe(0);
    state.fail = true;
    await expect(createEmbeddedWallet("http://node", true)).rejects.toThrow("PXE creation failed");
    expect(state.options[2].pxe.store.close).toHaveBeenCalledOnce();
  });

  it("clears only this node's V6 caches and preserves V5 and other rollup data", async () => {
    const names = ["wallet_data_31337-0xrollup-v1", "pxe_data_31337-0xrollup-v13",
      "magna_v6_wallet_data_31337-0xrollup-v1", "pxe_data_31337-0xrollup-v16",
      "pxe_data_31337-0xother-v16"];
    for (const name of names) state.stores.set(name, { close: vi.fn(async () => undefined), marker: name });
    const deleted: string[] = [];
    vi.stubGlobal("navigator", { storage: {} });
    vi.stubGlobal("indexedDB", { deleteDatabase: (name: string) => {
      deleted.push(name);
      const request = {} as any;
      queueMicrotask(() => request.onsuccess());
      return request;
    } });
    await clearEmbeddedPxeCacheForNode("http://node");
    expect([...state.stores.keys()]).toEqual([names[0], names[1], names[4]]);
    expect(deleted.sort()).toEqual([names[2], names[3]].sort());
  });
});
