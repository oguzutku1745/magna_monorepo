import type { Policy } from "@magna/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import {
  createWebAuthnWalletSession,
  registerKnownIssuerSender,
  MagnaVerificationEngine,
  packAlpha3,
  type PassportCommittedClaimsWitness,
} from "@magna/wallet";
import { getAppEnv } from "./env";
import { readTxHash } from "./aztec";

export type WalletLoginOutcome = { verified: boolean; receipt: string | null; error?: string };

const LAST_ISSUED_PASSPORT_STORAGE_KEY = "magna-web:last-issued-passport:v1";
const A1_LOCAL_WITNESS_MISSING_MESSAGE =
  "Passport A1 credential is missing its local v2 witness. Re-issue this passport credential on this device to restore A1/v2 presentation.";
const PILOT_CREDENTIAL_UNUSABLE_MESSAGE =
  "PII-blind pilot credentials are non-production and cannot be used for Login with Magna. Re-issue with A1/v2 support before using this credential.";

type PassportIssuanceKind = "legacy" | "pilot" | "a1";

type StoredPassportRef = {
  ownerAddress: string;
  claimsHash: string;
  mode: "passport" | "rooted";
  issuanceKind?: PassportIssuanceKind;
  rootCommitment?: string;
  passportCommittedClaimsV2Witness?: {
    schema: "passport-committed-claims-v2";
    credentialAuthenticity: "passport-a1";
    minAgeProven: number;
    nationalityAlpha3Packed: string | bigint;
    nationalityBlind: string | bigint;
    expiryTs: string | bigint;
    expiryBlind: string | bigint;
  };
  normalizedClaims?: {
    nationalityAlpha3: string;
    minAgeProven: number;
  };
};

function toAddress(value: string): AztecAddress {
  return AztecAddress.fromString(value);
}

function isStoredCommittedWitness(value: unknown): value is NonNullable<StoredPassportRef["passportCommittedClaimsV2Witness"]> {
  const witness = value as StoredPassportRef["passportCommittedClaimsV2Witness"];
  return Boolean(
    witness &&
      witness.schema === "passport-committed-claims-v2" &&
      witness.credentialAuthenticity === "passport-a1" &&
      typeof witness.minAgeProven === "number" &&
      (typeof witness.nationalityAlpha3Packed === "string" || typeof witness.nationalityAlpha3Packed === "bigint") &&
      (typeof witness.nationalityBlind === "string" || typeof witness.nationalityBlind === "bigint") &&
      (typeof witness.expiryTs === "string" || typeof witness.expiryTs === "bigint") &&
      (typeof witness.expiryBlind === "string" || typeof witness.expiryBlind === "bigint")
  );
}

function normalizeCommittedWitness(
  witness: StoredPassportRef["passportCommittedClaimsV2Witness"] | undefined,
): PassportCommittedClaimsWitness | undefined {
  if (!witness) return undefined;
  return {
    minAgeProven: witness.minAgeProven,
    nationalityAlpha3Packed: BigInt(witness.nationalityAlpha3Packed),
    nationalityBlind: BigInt(witness.nationalityBlind),
    expiryTs: BigInt(witness.expiryTs),
    expiryBlind: BigInt(witness.expiryBlind),
  };
}

function normalizeIssuanceKind(value: unknown): PassportIssuanceKind | undefined {
  return value === "legacy" || value === "pilot" || value === "a1" ? value : undefined;
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
    (parsed.mode !== "passport" && parsed.mode !== "rooted")
  ) {
    throw new Error("Stored Magna credential reference is incomplete");
  }
  const issuanceKind = normalizeIssuanceKind(parsed.issuanceKind);
  if (issuanceKind === "a1" && !isStoredCommittedWitness(parsed.passportCommittedClaimsV2Witness)) {
    throw new Error(A1_LOCAL_WITNESS_MISSING_MESSAGE);
  }
  if (issuanceKind === "pilot") {
    throw new Error(PILOT_CREDENTIAL_UNUSABLE_MESSAGE);
  }
  if (
    !isStoredCommittedWitness(parsed.passportCommittedClaimsV2Witness) &&
    (!parsed.normalizedClaims ||
      typeof parsed.normalizedClaims.nationalityAlpha3 !== "string" ||
      typeof parsed.normalizedClaims.minAgeProven !== "number")
  ) {
    throw new Error("Stored Magna credential reference is incomplete");
  }
  if (parsed.mode === "rooted" && (typeof parsed.rootCommitment !== "string" || !parsed.rootCommitment)) {
    throw new Error("Stored rooted Magna credential reference is missing its root commitment");
  }
  return {
    ...parsed,
    issuanceKind,
  } as StoredPassportRef;
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
    const committedClaimsWitness = normalizeCommittedWitness(credential.passportCommittedClaimsV2Witness);
    if (committedClaimsWitness) {
      const receipt =
        credential.mode === "rooted"
          ? await engine.loginWithLinkedMagnaV2ThroughConsumer({
              policy: input.policy,
              consumerGatewayAddress: input.consumerGatewayAddress,
              rootCommitment: credential.rootCommitment!,
              claimsHash: credential.claimsHash,
              claimsWitness: committedClaimsWitness,
              from: session.activeAccount.address,
            })
          : await engine.loginWithMagnaV2ThroughConsumer({
              policy: input.policy,
              consumerGatewayAddress: input.consumerGatewayAddress,
              claimsHash: credential.claimsHash,
              claimsWitness: committedClaimsWitness,
              from: session.activeAccount.address,
            });
      return { verified: true, receipt: readTxHash(receipt) ?? null };
    }
    const claimsWitness = {
      minAgeProven: credential.normalizedClaims!.minAgeProven,
      nationalityAlpha3Packed: packAlpha3(credential.normalizedClaims!.nationalityAlpha3),
    };
    const receipt =
      credential.mode === "rooted"
        ? await engine.loginWithLinkedMagnaThroughConsumer({
            policy: input.policy,
            consumerGatewayAddress: input.consumerGatewayAddress,
            rootCommitment: credential.rootCommitment!,
            claimsHash: credential.claimsHash,
            claimsWitness,
            from: session.activeAccount.address,
          })
        : await engine.loginWithMagnaThroughConsumer({
            policy: input.policy,
            consumerGatewayAddress: input.consumerGatewayAddress,
            claimsHash: credential.claimsHash,
            claimsWitness,
            from: session.activeAccount.address,
          });
    return { verified: true, receipt: readTxHash(receipt) ?? null };
  } catch (error) {
    console.warn("magna verification failed", error);
    return { verified: false, receipt: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await session.disconnect();
  }
}
