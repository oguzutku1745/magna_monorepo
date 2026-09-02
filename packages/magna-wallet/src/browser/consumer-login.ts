import { ClaimId, ConstraintOp, CredentialType, type Policy } from "@magna/core";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { MagnaCompanySponsorContract, MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import { MagnaVerificationEngine } from "../engine/verification-engine.js";
import { packAlpha3 } from "../engine/encoding.js";
import type { PassportCommittedClaimsWitness } from "../engine/types.js";
import { buildCompanySponsorNetworkFeeConfig } from "../engine/sponsorship.js";
import { registerKnownIssuerSender } from "../embedded/note-discovery.js";
import { syncEmbeddedWalletPxeIfAvailable } from "../embedded/lifecycle.js";
import { readTxHash, registerContractArtifactAtAddress } from "./aztec.js";
import { MagnaBrowserClient } from "./client.js";
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
  handleBlind: string;
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

type MagnaConsumerLoginEnv = Pick<
  MagnaBrowserEnv,
  "aztecNodeUrl" | "issuerAddress" | "orchestratorAddress" | "activeCompanySponsorAddress" | "companySponsorAddresses"
> &
  Partial<
    Pick<
      MagnaBrowserEnv,
      "requireRealSends" | "enableDevOrchestrator" | "enableLocalTestBootstrap" | "localTestAccountIndex"
    >
  >;

function toAddress(value: string): AztecAddress {
  return AztecAddress.fromStringUnsafe(value);
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

function requireActiveCompanySponsorAddress(
  env: Pick<MagnaBrowserEnv, "activeCompanySponsorAddress" | "companySponsorAddresses">,
): string {
  const sponsorAddress = env.activeCompanySponsorAddress?.trim() || env.companySponsorAddresses?.[0]?.trim();
  if (!sponsorAddress) {
    throw new Error(
      "Login with Magna requires a configured company sponsor so verification can be fee-sponsored. " +
        "Set VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS or configure companySponsorAddresses.",
    );
  }
  return sponsorAddress;
}

function browserEnvForConsumerLogin(env: MagnaConsumerLoginEnv): MagnaBrowserEnv {
  return {
    ...env,
    companySponsorAddresses: env.companySponsorAddresses ?? [],
    requireRealSends: env.requireRealSends ?? true,
    enableDevOrchestrator: env.enableDevOrchestrator ?? false,
    enableLocalTestBootstrap: env.enableLocalTestBootstrap ?? false,
    localTestAccountIndex: env.localTestAccountIndex ?? 0,
  };
}

function unwrapSimulationResult<T>(value: T | { result: T }): T {
  if (value && typeof value === "object" && "result" in value) {
    return value.result as T;
  }
  return value as T;
}

async function readSponsorMaxFeeCap(sponsor: unknown, from: AztecAddress): Promise<bigint | undefined> {
  const methods = (sponsor as { methods?: Record<string, unknown> }).methods;
  const getMaxFeeCap = methods?.get_max_fee_cap;
  if (typeof getMaxFeeCap !== "function") {
    return undefined;
  }
  const call = getMaxFeeCap();
  if (!call || typeof (call as { simulate?: unknown }).simulate !== "function") {
    return undefined;
  }
  const result = await (call as { simulate: (opts: { from: AztecAddress }) => Promise<unknown> }).simulate({ from });
  return BigInt(unwrapSimulationResult(result) as string | number | bigint);
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
      !(credential as Partial<MagnaInstagramConsumerLoginCredential>).handleHash ||
      typeof (credential as Partial<MagnaInstagramConsumerLoginCredential>).handleBlind !== "string" ||
      !(credential as Partial<MagnaInstagramConsumerLoginCredential>).handleBlind
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
  env: MagnaConsumerLoginEnv;
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
  const sponsorAddress = requireActiveCompanySponsorAddress(input.env);

  await registerContractArtifactAtAddress(
    input.wallet,
    input.env.aztecNodeUrl,
    input.env.issuerAddress,
    MagnaIssuerContract.artifact,
  );
  await registerContractArtifactAtAddress(
    input.wallet,
    input.env.aztecNodeUrl,
    sponsorAddress,
    MagnaCompanySponsorContract.artifact,
  );
  await registerKnownIssuerSender(input.wallet, input.env.orchestratorAddress);
  input.onVerifying?.();

  const hintClient = new MagnaBrowserClient(input.wallet, browserEnvForConsumerLogin(input.env), input.activeAddress);
  await hintClient.syncOrchestratorSender();
  // Warm the active account's own signing-key note into PXE before the verify send. The embedded
  // wallet's pre-flight stub simulation cannot decode the custom WebAuthn account's note and skips
  // it, which would otherwise leave `is_valid_impl` unable to read it during proving ("Failed to
  // get a note"). Discovering it here against the real account artifact populates the note store.
  await hintClient.ensureAccountAuthNoteDiscovered(input.activeAddress);
  const issuer = MagnaIssuerContract.at(toAddress(input.env.issuerAddress), input.wallet);
  const sponsor = MagnaCompanySponsorContract.at(toAddress(sponsorAddress), input.wallet);
  const activeAddress = toAddress(input.activeAddress);
  const sponsorMaxFeeCap = await readSponsorMaxFeeCap(sponsor, activeAddress);
  const companySponsorFeeConfig = sponsorMaxFeeCap !== undefined
    ? await buildCompanySponsorNetworkFeeConfig(toAddress(sponsorAddress), {
        aztecNodeUrl: input.env.aztecNodeUrl,
        maxFeeCap: sponsorMaxFeeCap,
      })
    : undefined;
  const engine = new MagnaVerificationEngine({
    orchestratorAddress: input.env.orchestratorAddress,
    issuerContract: issuer,
    companySponsorContract: sponsor,
    companySponsorFeeConfig,
    consumerContractFactory: (address: string) => MagnaConsumerContract.at(toAddress(address), input.wallet),
    syncBeforeHintLookup: async () => {
      await syncEmbeddedWalletPxeIfAvailable(input.wallet as never);
    },
    hintLookupAttempts: 1,
  });
  const receipt = input.policy.credentialType === CredentialType.Instagram
    ? await engine.loginWithInstagramCompanySponsor(
        {
          policy: input.policy,
          ...(await hintClient.fetchPassportHintsByClaimsHash(input.activeAddress, credential.claimsHash)),
          claimsWitness: {
            handleHash: BigInt((credential as MagnaInstagramConsumerLoginCredential).handleHash),
            handleBlind: BigInt((credential as MagnaInstagramConsumerLoginCredential).handleBlind),
          },
        },
        input.activeAddress,
        sponsor,
      )
    : await (async () => {
        const passportCredential = credential as MagnaPassportConsumerLoginCredential;
        const committedClaimsWitness = normalizeCommittedWitness(passportCredential.committedClaimsWitness);
        if (committedClaimsWitness) {
          return passportCredential.mode === "rooted"
            ? engine.loginWithLinkedCompanySponsorV2({
                policy: input.policy,
                ...(await hintClient.fetchRootedPassportHintsByClaimsHash(
                  input.activeAddress,
                  passportCredential.rootCommitment!,
                  passportCredential.claimsHash,
                )),
                claimsWitness: committedClaimsWitness,
              },
              input.activeAddress,
              sponsor)
            : engine.loginWithCompanySponsorV2({
                policy: input.policy,
                ...(await hintClient.fetchPassportHintsByClaimsHash(input.activeAddress, passportCredential.claimsHash)),
                claimsWitness: committedClaimsWitness,
              },
              input.activeAddress,
              sponsor);
        }
        const claimsWitness = {
          minAgeProven: passportCredential.normalizedClaims!.minAgeProven,
          nationalityAlpha3Packed: packAlpha3(passportCredential.normalizedClaims!.nationalityAlpha3),
        };
        return passportCredential.mode === "rooted"
          ? engine.loginWithLinkedCompanySponsor({
              policy: input.policy,
              ...(await hintClient.fetchRootedPassportHintsByClaimsHash(
                input.activeAddress,
                passportCredential.rootCommitment!,
                passportCredential.claimsHash,
              )),
              claimsWitness,
            },
            input.activeAddress,
            sponsor)
          : engine.loginWithCompanySponsor({
              policy: input.policy,
              ...(await hintClient.fetchPassportHintsByClaimsHash(input.activeAddress, passportCredential.claimsHash)),
              claimsWitness,
            },
            input.activeAddress,
            sponsor);
      })();

  return { verified: true, receipt: readTxHash(receipt) ?? null };
}
