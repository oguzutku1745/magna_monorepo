import type { ProofResult } from "@zkpassport/sdk";
import type { Abi } from "viem";

export type VerifyZkPassportOuterEvmProofOptions = {
  proof: unknown;
  publicInputs: readonly string[];
  rpcUrl?: string;
  validityPeriodInSeconds?: number;
  domain?: string;
  scope?: string;
  devMode?: boolean;
  readContract?: (request: {
    address: `0x${string}`;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
  }) => Promise<unknown>;
};

function asProofResult(proof: unknown, publicInputs: readonly string[]): ProofResult {
  if (!proof || typeof proof !== "object") {
    throw new Error("zkPassport outer proof must be an object.");
  }
  return {
    ...(proof as Record<string, unknown>),
    publicInputs: publicInputs.map(String),
  } as ProofResult;
}

export async function verifyZkPassportOuterEvmProof(
  options: VerifyZkPassportOuterEvmProofOptions,
): Promise<boolean> {
  if (!options.rpcUrl && !options.readContract) {
    throw new Error("MAGNA_ZKPASSPORT_EVM_RPC_URL is required for Passport A1 outer proof verification.");
  }

  const [{ ZKPassport }, { createPublicClient, http }, { mainnet, sepolia }] = await Promise.all([
    import("@zkpassport/sdk"),
    import("viem"),
    import("viem/chains"),
  ]);
  const sdk = new ZKPassport(options.domain);
  const { address, abi, functionName } = sdk.getSolidityVerifierDetails();
  const proof = asProofResult(options.proof, options.publicInputs);
  const params = sdk.getSolidityVerifierParameters({
    proof,
    validityPeriodInSeconds: options.validityPeriodInSeconds,
    domain: options.domain,
    scope: options.scope,
    devMode: options.devMode ?? false,
  });

  const readContract =
    options.readContract ??
    createPublicClient({
      chain: options.devMode ? sepolia : mainnet,
      transport: http(options.rpcUrl),
    }).readContract;
  const result = await readContract({
    address,
    abi: abi as Abi,
    functionName,
    args: [params],
  });

  return Array.isArray(result) ? Boolean(result[0]) : Boolean(result);
}
