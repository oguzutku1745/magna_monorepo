import type { ContractArtifact } from "@aztec/aztec.js/abi";
import type { ChainInfo } from "@aztec/aztec.js/account";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { contractInstanceWithAddressFromPlainObject } from "@aztec/stdlib/contract";
import { MagnaCompanySponsorContract, MagnaIssuerContract } from "@magna/contracts-bindings";

export function getAztecNode(nodeUrl: string): AztecNode {
  return createAztecNodeClient(nodeUrl);
}

export async function getChainInfo(nodeUrl: string): Promise<ChainInfo> {
  const node = getAztecNode(nodeUrl);
  const info = await node.getNodeInfo();
  return {
    chainId: new Fr(info.l1ChainId),
    version: new Fr(info.rollupVersion),
  };
}

export function toAddress(value: string): AztecAddress {
  return AztecAddress.fromString(value);
}

export function bindIssuerContract(wallet: Wallet, issuerAddress: string) {
  return MagnaIssuerContract.at(toAddress(issuerAddress), wallet);
}

export function bindCompanySponsorContract(wallet: Wallet, companySponsorAddress: string) {
  return MagnaCompanySponsorContract.at(toAddress(companySponsorAddress), wallet);
}

export async function registerContractArtifactAtAddress(
  wallet: Wallet,
  nodeUrl: string,
  contractAddress: string,
  artifact: ContractArtifact,
): Promise<void> {
  try {
    const address = toAddress(contractAddress);
    const existingMetadata = await wallet.getContractMetadata(address);
    if (existingMetadata.instance) {
      await wallet.registerContract(existingMetadata.instance, artifact);
      return;
    }

    const walletBackedNode = (wallet as Wallet & { aztecNode?: AztecNode }).aztecNode;
    const rawInstance = await (walletBackedNode ?? getAztecNode(nodeUrl)).getContract(address);
    if (!rawInstance) {
      throw new Error(`Contract ${contractAddress} is not deployed on the current Aztec node.`);
    }

    const instance = contractInstanceWithAddressFromPlainObject(address, rawInstance);
    await wallet.registerContract(instance, artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to register contract ${contractAddress} in wallet PXE: ${message}`);
  }
}

export function stringifyAddress(address: { toString(): string } | string): string {
  return typeof address === "string" ? address : address.toString();
}

export function readTxHash(receipt: unknown): string | undefined {
  if (!receipt || typeof receipt !== "object") {
    return undefined;
  }
  const txHashSource =
    Reflect.get(receipt, "receipt") && typeof Reflect.get(receipt, "receipt") === "object"
      ? Reflect.get(receipt, "receipt")
      : receipt;
  const txHash = Reflect.get(txHashSource as object, "txHash");
  if (typeof txHash === "string") {
    return txHash;
  }
  if (txHash && typeof txHash === "object" && "toString" in txHash) {
    return String(txHash.toString());
  }
  return undefined;
}
