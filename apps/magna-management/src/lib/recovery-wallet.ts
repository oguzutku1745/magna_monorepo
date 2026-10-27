import {
  createWebAuthnWalletSession,
  packAlpha3,
  prepareWebAuthnRecoveryTarget,
  SCOPED_GHOST_DERIVATION_VERSION,
  type WalletSession,
} from "@magna/wallet";
import type { RecoveryWrapperProofArtifact } from "@magna/recovery-wrapper-proof/safe";
import { localDisclosures, type VerifiedPassportCompletion } from "./passport-issuance";
import type { StoredCredentialRef } from "./storage";

type DestinationOptions = {
  session: WalletSession | null;
  nodeUrl: string;
  rpId: string;
  userName: string;
  publicKeyRecoveryBundle?: string;
  forceCreate?: boolean;
  expectedAddress?: string;
  localTestAccountIndex: number;
  deployWithLocalTestAccount: boolean;
};

/** Use the destination as the working PXE when the source wallet is unavailable. */
export async function prepareRecoveryDestination(input: DestinationOptions) {
  let session = input.session;
  let opened = false;
  try {
    let target: Awaited<ReturnType<typeof prepareWebAuthnRecoveryTarget>>;
    if (session) {
      target = await prepareWebAuthnRecoveryTarget({
        wallet: session.wallet, userName: input.userName, rpId: input.rpId,
        publicKeyRecoveryBundle: input.publicKeyRecoveryBundle,
        localTestAccountIndex: input.localTestAccountIndex, deployWithLocalTestAccount: input.deployWithLocalTestAccount,
      });
    } else {
      session = await createWebAuthnWalletSession({
        nodeUrl: input.nodeUrl, alias: input.userName, userName: input.userName, rpId: input.rpId,
        publicKeyRecoveryBundle: input.publicKeyRecoveryBundle, forceCreate: input.forceCreate,
        localTestAccountIndex: input.localTestAccountIndex, deployWithLocalTestAccount: input.deployWithLocalTestAccount,
      });
      opened = true;
      if (!session.metadata?.publicKeyRecoveryBundle) throw new Error("Recovery destination is missing its passkey public key.");
      target = {
        address: session.activeAccount.address,
        displayName: session.metadata.passkeyName ?? input.userName,
        publicKeyRecoveryBundle: session.metadata.publicKeyRecoveryBundle,
        deploymentStatus: session.metadata.deploymentStatus === "deployed" ? "deployed" : "counterfactual",
        materialOrigin: session.metadata.sessionOrigin === "recovered" ? "recovered" : "new",
        feePayer: session.metadata.feePayer,
      };
    }
    if (input.expectedAddress && target.address.trim().toLowerCase() !== input.expectedAddress.trim().toLowerCase()) {
      throw new Error(`Recovery destination account mismatch. expected=${input.expectedAddress} actual=${target.address}`);
    }
    if (target.deploymentStatus !== "deployed") throw new Error("The recovery target is counterfactual. Deploy the target wallet before recovery.");
    return { session, target };
  } catch (error) {
    if (opened) await session?.disconnect().catch(() => undefined);
    throw error;
  }
}

export function buildRecoveredPassportRef(input: {
  completion: VerifiedPassportCompletion;
  ageThreshold: number;
  destination: string;
  issuerAddress: string;
  ghostOwner: string;
  metadata: Pick<RecoveryWrapperProofArtifact["metadata"], "rootCommitment" | "claimsHash" | "nationalityBlind" | "expiryBlind">;
  now: string;
}): StoredCredentialRef {
  const disclosures = localDisclosures(input.completion, input.ageThreshold);
  const rootCommitment = input.metadata.rootCommitment.toString();
  const claimsHash = input.metadata.claimsHash.toString();
  return {
    id: [input.issuerAddress.trim().toLowerCase(), input.destination, "passport", "rooted", claimsHash, rootCommitment].join(":"),
    ownerAddress: input.destination, issuerAddress: input.issuerAddress,
    kind: "passport", mode: "rooted", issuanceKind: "a2", status: "recovery_pending", claimsHash, rootCommitment,
    ghostOwner: input.ghostOwner, ghostDerivationVersion: SCOPED_GHOST_DERIVATION_VERSION,
    createdAt: input.now, updatedAt: input.now,
    passportCommittedClaimsV2Witness: {
      schema: "passport-committed-claims-v2", credentialAuthenticity: "passport-a2",
      minAgeProven: disclosures.minAgeProven, nationalityAlpha3Packed: packAlpha3(disclosures.nationalityAlpha3).toString(),
      nationalityBlind: input.metadata.nationalityBlind.toString(), expiryTs: disclosures.expiryTs.toString(),
      expiryBlind: input.metadata.expiryBlind.toString(),
    },
  };
}
