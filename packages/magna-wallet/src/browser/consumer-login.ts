import { ClaimId, ConstraintOp, CredentialType, type Policy } from "@magna/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import { MagnaVerificationEngine } from "../engine/verification-engine.js";
import { packAlpha3 } from "../engine/encoding.js";
import type { PassportCommittedClaimsWitness } from "../engine/types.js";
import { registerKnownIssuerSender } from "../embedded/note-discovery.js";
import { syncEmbeddedWalletPxeIfAvailable } from "../embedded/lifecycle.js";
import { readTxHash, registerContractArtifactAtAddress } from "./aztec.js";
import type { MagnaBrowserEnv } from "./env.js";

type StoredPassportCommittedClaimsWitness = {
  minAgeProven: number;
  nationalityAlpha3Packed: string | bigint;
  nationalityBlind: string | bigint;
  expiryTs: string | bigint;
  expiryBlind: string | bigint;
};

export type MagnaPassportConsumerLoginCredential = {
  ownerAddress: string;
  kind?: "passport";
  claimsHash: string;
  mode?: "passport" | "rooted";
  rootCommitment?: string;
  committedClaimsWitness?: StoredPassportCommittedClaimsWitness;
  normalizedClaims?: {
    nationalityAlpha3: string;
    minAgeProven: number;
  };
};

export type MagnaInstagramConsumerLoginCredential = {
  ownerAddress: string;
  kind?: "instagram";
  claimsHash: string;
  handleHash: string;
  instagramHandle?: string;
};

export type MagnaConsumerLoginCredential =
  | MagnaPassportConsumerLoginCredential
  | MagnaInstagramConsumerLoginCredential;

export type MagnaConsumerLoginOutcome = {
  verified: boolean;
  receipt: string | null;
  receipts?: { id: string; kind: string; receipt: string | null }[];
};

function toAddress(value: string): AztecAddress {
  return AztecAddress.fromString(value);
}

function instagramHandleHashFromPolicy(policy: Policy): bigint {
  const constraint = policy.constraints.find(
    item => item.claimId === ClaimId.InstagramHandleHash && item.op === ConstraintOp.Eq,
  );
  if (!constraint) {
    throw new Error("Instagram login policy must include an Instagram handle equality constraint.");
  }
  return constraint.value;
}

function isStoredCommittedWitness(value: unknown): value is StoredPassportCommittedClaimsWitness {
  const witness = value as Partial<StoredPassportCommittedClaimsWitness> | undefined;
  return Boolean(
    witness &&
      typeof witness.minAgeProven === "number" &&
      (typeof witness.nationalityAlpha3Packed === "string" || typeof witness.nationalityAlpha3Packed === "bigint") &&
      (typeof witness.nationalityBlind === "string" || typeof witness.nationalityBlind === "bigint") &&
      (typeof witness.expiryTs === "string" || typeof witness.expiryTs === "bigint") &&
      (typeof witness.expiryBlind === "string" || typeof witness.expiryBlind === "bigint")
  );
}

function normalizeCommittedWitness(
  witness: StoredPassportCommittedClaimsWitness | undefined,
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

function assertConsumerCredential(
  credential: Partial<MagnaConsumerLoginCredential> | null | undefined,
  policy: Policy,
): MagnaConsumerLoginCredential {
  if (policy.credentialType === CredentialType.Instagram) {
    const handleHash = instagramHandleHashFromPolicy(policy);
    if (
      !credential ||
      typeof credential.ownerAddress !== "string" ||
      !credential.ownerAddress ||
      typeof credential.claimsHash !== "string" ||
      !credential.claimsHash ||
      typeof (credential as Partial<MagnaInstagramConsumerLoginCredential>).handleHash !== "string" ||
      !(credential as Partial<MagnaInstagramConsumerLoginCredential>).handleHash
    ) {
      throw new Error("Stored Magna Instagram credential reference is incomplete.");
    }
    if ((credential as MagnaInstagramConsumerLoginCredential).handleHash !== handleHash.toString()) {
      throw new Error("Stored Magna Instagram credential does not match the requested handle.");
    }
    return credential as MagnaInstagramConsumerLoginCredential;
  }
  const passportCredential = credential as Partial<MagnaPassportConsumerLoginCredential> | null | undefined;
  if (
    !passportCredential ||
    typeof passportCredential.ownerAddress !== "string" ||
    !passportCredential.ownerAddress ||
    typeof passportCredential.claimsHash !== "string" ||
    !passportCredential.claimsHash
  ) {
    throw new Error("Stored Magna passport credential reference is incomplete.");
  }
  if (
    !isStoredCommittedWitness(passportCredential.committedClaimsWitness) &&
    (!passportCredential.normalizedClaims ||
      typeof passportCredential.normalizedClaims.nationalityAlpha3 !== "string" ||
      typeof passportCredential.normalizedClaims.minAgeProven !== "number")
  ) {
    throw new Error("Stored Magna passport credential reference is incomplete.");
  }
  if (
    passportCredential.mode === "rooted" &&
    (typeof passportCredential.rootCommitment !== "string" || !passportCredential.rootCommitment)
  ) {
    throw new Error("Stored rooted Magna passport credential reference is missing its root commitment.");
  }
  return passportCredential as MagnaPassportConsumerLoginCredential;
}

export async function runMagnaConsumerLogin(input: {
  env: Pick<MagnaBrowserEnv, "aztecNodeUrl" | "issuerAddress" | "orchestratorAddress">;
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
  if (!input.env.aztecNodeUrl) {
    throw new Error("VITE_AZTEC_NODE_URL is required for wallet login.");
  }

  const credential = assertConsumerCredential(input.credential, input.policy);
  if (credential.ownerAddress !== input.activeAddress) {
    throw new Error("Stored credential belongs to a different active wallet.");
  }

  await registerContractArtifactAtAddress(
    input.wallet,
    input.env.aztecNodeUrl,
    input.env.issuerAddress,
    MagnaIssuerContract.artifact,
  );
  if (input.policy.credentialType === CredentialType.Passport) {
    await registerContractArtifactAtAddress(
      input.wallet,
      input.env.aztecNodeUrl,
      input.consumerGatewayAddress,
      MagnaConsumerContract.artifact,
    );
  }
  await registerKnownIssuerSender(input.wallet, input.env.orchestratorAddress);
  input.onVerifying?.();

  const issuer = MagnaIssuerContract.at(toAddress(input.env.issuerAddress), input.wallet);
  const engine = new MagnaVerificationEngine({
    orchestratorAddress: input.env.orchestratorAddress,
    issuerContract: issuer,
    consumerContractFactory: (address: string) => MagnaConsumerContract.at(toAddress(address), input.wallet),
    syncBeforeHintLookup: async () => {
      await syncEmbeddedWalletPxeIfAvailable(input.wallet as never);
    },
  });
  const receipt = input.policy.credentialType === CredentialType.Instagram
    ? await engine.loginWithInstagram(
        {
          policy: input.policy,
          ...(await engine.findCredentialHints(input.activeAddress, credential.claimsHash)),
          claimsWitness: {
            handleHash: BigInt((credential as MagnaInstagramConsumerLoginCredential).handleHash),
          },
        },
        input.activeAddress,
      )
    : await (async () => {
        const passportCredential = credential as MagnaPassportConsumerLoginCredential;
        const committedClaimsWitness = normalizeCommittedWitness(passportCredential.committedClaimsWitness);
        if (committedClaimsWitness) {
          return passportCredential.mode === "rooted"
            ? engine.loginWithLinkedMagnaV2ThroughConsumer({
                policy: input.policy,
                consumerGatewayAddress: input.consumerGatewayAddress,
                rootCommitment: passportCredential.rootCommitment!,
                claimsHash: passportCredential.claimsHash,
                claimsWitness: committedClaimsWitness,
                from: input.activeAddress,
              })
            : engine.loginWithMagnaV2ThroughConsumer({
                policy: input.policy,
                consumerGatewayAddress: input.consumerGatewayAddress,
                claimsHash: passportCredential.claimsHash,
                claimsWitness: committedClaimsWitness,
                from: input.activeAddress,
              });
        }
        const claimsWitness = {
          minAgeProven: passportCredential.normalizedClaims!.minAgeProven,
          nationalityAlpha3Packed: packAlpha3(passportCredential.normalizedClaims!.nationalityAlpha3),
        };
        return passportCredential.mode === "rooted"
          ? engine.loginWithLinkedMagnaThroughConsumer({
              policy: input.policy,
              consumerGatewayAddress: input.consumerGatewayAddress,
              rootCommitment: passportCredential.rootCommitment!,
              claimsHash: passportCredential.claimsHash,
              claimsWitness,
              from: input.activeAddress,
            })
          : engine.loginWithMagnaThroughConsumer({
              policy: input.policy,
              consumerGatewayAddress: input.consumerGatewayAddress,
              claimsHash: passportCredential.claimsHash,
              claimsWitness,
              from: input.activeAddress,
            });
      })();

  return { verified: true, receipt: readTxHash(receipt) ?? null };
}
