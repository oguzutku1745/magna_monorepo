declare module "@magna/contracts-bindings" {
  export type ContractMethod = (
    ...args: unknown[]
  ) => {
    send: (opts: { from: string; fee?: unknown }) => Promise<unknown>;
    simulate?: (opts: { from: string }) => Promise<unknown>;
  };

  export type ContractLike = {
    address?: unknown;
    methods: Record<string, ContractMethod>;
  };
}
