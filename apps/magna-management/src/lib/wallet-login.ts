import {
  ClaimId,
  ConstraintOp,
  CredentialType,
  instagramHandleEqConstraint,
  type LoginRequirement,
  type Policy,
} from "@magna/core";
import {
  computeInstagramHandleHash,
  createWebAuthnWalletSession,
  runMagnaConsumerLogin,
  type MagnaConsumerLoginOutcome,
} from "@magna/wallet";
import { getManagementEnv } from "./env";
import { refsForOwner } from "./storage";

function loadPassportCredential(ownerAddress: string, issuerAddress?: string) {
  const credential = refsForOwner(ownerAddress, { issuerAddress }).find(
    ref => ref.kind === "passport" && ref.status === "active" && ref.normalizedClaims,
  );
  if (!credential) {
    throw new Error("No active Magna passport credential is available in this wallet session.");
  }
  return credential;
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

function loadInstagramCredential(ownerAddress: string, handleHash: bigint, issuerAddress?: string, handle?: string) {
  const handleHashString = handleHash.toString();
  const credential = refsForOwner(ownerAddress, { issuerAddress }).find(
    ref =>
      ref.kind === "instagram" &&
      ref.status === "active" &&
      ref.handleHash === handleHashString &&
      (!handle || ref.instagramHandle === handle),
  );
  if (!credential) {
    throw new Error(
      handle
        ? `No active Magna Instagram credential for @${handle} is available in this wallet session.`
        : "No active Magna Instagram credential is available in this wallet session.",
    );
  }
  return credential;
}

function verificationRequirements(policy: Policy, requirements?: LoginRequirement[]): LoginRequirement[] {
  return requirements ?? [{ id: "default", kind: "policy", policy }];
}

function resolveRequirementCredential(input: {
  requirement: LoginRequirement;
  ownerAddress: string;
  issuerAddress?: string;
}) {
  if (input.requirement.kind === "instagram-handle") {
    const handleHash = computeInstagramHandleHash(input.requirement.handle);
    return {
      id: input.requirement.id,
      kind: input.requirement.kind,
      policy: {
        credentialType: CredentialType.Instagram,
        constraints: [instagramHandleEqConstraint(handleHash)],
      },
      credential: loadInstagramCredential(input.ownerAddress, handleHash, input.issuerAddress, input.requirement.handle),
    };
  }

  if (input.requirement.policy.credentialType === CredentialType.Passport) {
    return {
      id: input.requirement.id,
      kind: input.requirement.kind,
      policy: input.requirement.policy,
      credential: loadPassportCredential(input.ownerAddress, input.issuerAddress),
    };
  }

  if (input.requirement.policy.credentialType === CredentialType.Instagram) {
    const handleHash = instagramHandleHashFromPolicy(input.requirement.policy);
    return {
      id: input.requirement.id,
      kind: input.requirement.kind,
      policy: input.requirement.policy,
      credential: loadInstagramCredential(input.ownerAddress, handleHash, input.issuerAddress),
    };
  }

  throw new Error("Unsupported Magna credential type for wallet login.");
}

export async function runWalletLoginForRequest(input: {
  policy: Policy;
  requirements?: LoginRequirement[];
  consumerGatewayAddress: string;
  onVerifying?: () => void;
}): Promise<MagnaConsumerLoginOutcome> {
  const env = getManagementEnv();
  const session = await createWebAuthnWalletSession({
    nodeUrl: env.aztecNodeUrl,
    alias: "magna-user",
    userName: "magna-user",
    rpId: window.location.hostname || "localhost",
    deployWithLocalTestAccount: env.enableLocalTestBootstrap,
    localTestAccountIndex: env.localTestAccountIndex,
  });
  try {
    if (session.metadata?.deploymentStatus !== "deployed") {
      throw new Error(
        `Magna wallet is ${session.metadata?.deploymentStatus ?? "not deployed"}. Deploy the passkey wallet before Login with Magna.`,
      );
    }
    const resolved = verificationRequirements(input.policy, input.requirements).map(requirement =>
      resolveRequirementCredential({
        requirement,
        ownerAddress: session.activeAccount.address,
        issuerAddress: env.issuerAddress,
      }),
    );
    input.onVerifying?.();
    const receipts = [];
    for (const verification of resolved) {
      const outcome = await runMagnaConsumerLogin({
        env,
        wallet: session.wallet,
        activeAddress: session.activeAccount.address,
        policy: verification.policy,
        consumerGatewayAddress: input.consumerGatewayAddress,
        credential: verification.credential,
      });
      receipts.push({
        id: verification.id,
        kind: verification.kind,
        receipt: outcome.receipt,
      });
    }
    return { verified: true, receipt: receipts[0]?.receipt ?? null, receipts };
  } catch (error) {
    console.warn("magna verification failed", error);
    throw error;
  } finally {
    await session.disconnect();
  }
}
