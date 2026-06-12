import type { Policy } from "@magna/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import {
  createWebAuthnWalletSession,
  registerKnownIssuerSender,
  MagnaVerificationEngine,
  packAlpha3,
} from "@magna/wallet";
import { getAppEnv } from "./env";
import { readTxHash } from "./aztec";

export type WalletLoginOutcome = { verified: boolean; receipt: string | null };

const LAST_ISSUED_PASSPORT_STORAGE_KEY = "magna-web:last-issued-passport:v1";

type StoredPassportRef = {
  ownerAddress: string;
  claimsHash: string;
  normalizedClaims?: {
    nationalityAlpha3: string;
    minAgeProven: number;
  };
};

function toAddress(value: string): AztecAddress {
  return AztecAddress.fromString(value);
}

function loadStoredPassportRef(): StoredPassportRef {
  const raw = window.localStorage.getItem(LAST_ISSUED_PASSPORT_STORAGE_KEY);
  if (!raw) {
    throw new Error("No issued Magna passport credential is available in this wallet session");
  }
  const parsed = JSON.parse(raw) as Partial<StoredPassportRef>;
  if (
    typeof parsed.ownerAddress !== "string" ||
    !parsed.ownerAddress ||
    typeof parsed.claimsHash !== "string" ||
    !parsed.claimsHash ||
    !parsed.normalizedClaims ||
    typeof parsed.normalizedClaims.nationalityAlpha3 !== "string" ||
    typeof parsed.normalizedClaims.minAgeProven !== "number"
  ) {
    throw new Error("Stored Magna credential reference is incomplete");
  }
  return parsed as StoredPassportRef;
}

/**
 * Runs the wallet-side login for an authorize request using real PXE state and
 * the dApp's registered consumer gateway. Missing credentials return a signed
 * negative result rather than fake success.
 */
export async function runWalletLoginForRequest(input: {
  policy: Policy;
  consumerGatewayAddress: string;
  onVerifying?: () => void;
}): Promise<WalletLoginOutcome> {
  const env = getAppEnv();
  const session = await createWebAuthnWalletSession({
    nodeUrl: env.aztecNodeUrl,
    alias: "magna-wallet",
    userName: "magna-wallet",
    rpId: window.location.hostname,
    deployWithLocalTestAccount: env.enableLocalTestBootstrap,
    localTestAccountIndex: env.localTestAccountIndex,
  });
  try {
    if (!env.issuerAddress) {
      throw new Error("VITE_MAGNA_ISSUER_ADDRESS is required for wallet login");
    }
    if (!env.orchestratorAddress) {
      throw new Error("VITE_MAGNA_ORCHESTRATOR_ADDRESS is required for note discovery");
    }
    await registerKnownIssuerSender(session.wallet, env.orchestratorAddress);
    const credential = loadStoredPassportRef();
    input.onVerifying?.();
    const issuer = MagnaIssuerContract.at(toAddress(env.issuerAddress), session.wallet);
    const engine = new MagnaVerificationEngine({
      orchestratorAddress: env.orchestratorAddress,
      issuerContract: issuer,
      consumerContractFactory: (address: string) => MagnaConsumerContract.at(toAddress(address), session.wallet),
    });
    const receipt = await engine.loginWithMagnaThroughConsumer({
      policy: input.policy,
      consumerGatewayAddress: input.consumerGatewayAddress,
      claimsHash: credential.claimsHash,
      claimsWitness: {
        minAgeProven: credential.normalizedClaims!.minAgeProven,
        nationalityAlpha3Packed: packAlpha3(credential.normalizedClaims!.nationalityAlpha3),
      },
      from: session.activeAccount.address,
    });
    return { verified: true, receipt: readTxHash(receipt) ?? null };
  } catch (error) {
    console.warn("magna verification failed", error);
    return { verified: false, receipt: null };
  } finally {
    await session.disconnect();
  }
}
