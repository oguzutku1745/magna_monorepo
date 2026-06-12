import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Wallet } from "@aztec/aztec.js/wallet";
import type { EmbeddedWallet } from "@aztec/wallets/embedded";
import { syncEmbeddedWalletPxeIfAvailable } from "./lifecycle.js";

/**
 * Registers the Magna orchestrator as a known sender so PXE note discovery
 * (tag-based syncing) finds issuer-delivered notes. This is the supported
 * mechanism; sync_state is macro-injected and PXE-invoked -- never call it.
 */
export async function registerKnownIssuerSender(
  wallet: Wallet,
  orchestratorAddress: string,
): Promise<void> {
  await wallet.registerSender(AztecAddress.fromString(orchestratorAddress), "magna-orchestrator");
}

/**
 * Transitional helper: nudges PXE to sync before hint lookups. Wraps the
 * debug-only API in ONE place; production paths rely on regular tx-wait +
 * registered senders. Never exported from the package root.
 */
export async function syncPrivateStateForIssuer(wallet: EmbeddedWallet): Promise<void> {
  await syncEmbeddedWalletPxeIfAvailable(wallet);
}
