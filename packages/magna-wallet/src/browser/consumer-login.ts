import type { Policy } from "@magna/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import { MagnaVerificationEngine } from "../engine/verification-engine.js";
import { packAlpha3 } from "../engine/encoding.js";
import { registerKnownIssuerSender } from "../embedded/note-discovery.js";
import { readTxHash } from "./aztec.js";
import type { MagnaBrowserEnv } from "./env.js";

export type MagnaConsumerLoginCredential = {
  ownerAddress: string;
  claimsHash: string;
  normalizedClaims: {
    nationalityAlpha3: string;
    minAgeProven: number;
  };
};

export type MagnaConsumerLoginOutcome = {
  verified: boolean;
  receipt: string | null;
};

function toAddress(value: string): AztecAddress {
  return AztecAddress.fromString(value);
}

function assertConsumerCredential(
  credential: Partial<MagnaConsumerLoginCredential> | null | undefined,
): MagnaConsumerLoginCredential {
  if (
    !credential ||
    typeof credential.ownerAddress !== "string" ||
    !credential.ownerAddress ||
    typeof credential.claimsHash !== "string" ||
    !credential.claimsHash ||
    !credential.normalizedClaims ||
    typeof credential.normalizedClaims.nationalityAlpha3 !== "string" ||
    typeof credential.normalizedClaims.minAgeProven !== "number"
  ) {
    throw new Error("Stored Magna passport credential reference is incomplete.");
  }
  return credential as MagnaConsumerLoginCredential;
}

export async function runMagnaConsumerLogin(input: {
  env: Pick<MagnaBrowserEnv, "issuerAddress" | "orchestratorAddress">;
  wallet: Wallet;
  activeAddress: string;
  policy: Policy;
  consumerGatewayAddress: string;
  credential: Partial<MagnaConsumerLoginCredential> | null | undefined;
  onVerifying?: () => void;
}): Promise<MagnaConsumerLoginOutcome> {
  if (!input.env.issuerAddress) {
    throw new Error("VITE_MAGNA_ISSUER_ADDRESS is required for wallet login.");
  }
  if (!input.env.orchestratorAddress) {
    throw new Error("VITE_MAGNA_ORCHESTRATOR_ADDRESS is required for note discovery.");
  }

  const credential = assertConsumerCredential(input.credential);
  if (credential.ownerAddress !== input.activeAddress) {
    throw new Error("Stored credential belongs to a different active wallet.");
  }

  await registerKnownIssuerSender(input.wallet, input.env.orchestratorAddress);
  input.onVerifying?.();

  const issuer = MagnaIssuerContract.at(toAddress(input.env.issuerAddress), input.wallet);
  const engine = new MagnaVerificationEngine({
    orchestratorAddress: input.env.orchestratorAddress,
    issuerContract: issuer,
    consumerContractFactory: (address: string) => MagnaConsumerContract.at(toAddress(address), input.wallet),
  });
  const receipt = await engine.loginWithMagnaThroughConsumer({
    policy: input.policy,
    consumerGatewayAddress: input.consumerGatewayAddress,
    claimsHash: credential.claimsHash,
    claimsWitness: {
      minAgeProven: credential.normalizedClaims.minAgeProven,
      nationalityAlpha3Packed: packAlpha3(credential.normalizedClaims.nationalityAlpha3),
    },
    from: input.activeAddress,
  });

  return { verified: true, receipt: readTxHash(receipt) ?? null };
}
