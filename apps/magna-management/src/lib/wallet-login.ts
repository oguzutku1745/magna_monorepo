import type { Policy } from "@magna/core";
import {
  createWebAuthnWalletSession,
  runMagnaConsumerLogin,
  type MagnaConsumerLoginOutcome,
} from "@magna/wallet";
import { getManagementEnv } from "./env";
import { refsForOwner } from "./storage";

function loadPassportCredential(ownerAddress: string) {
  const credential = refsForOwner(ownerAddress).find(
    ref => ref.kind === "passport" && ref.status === "active" && ref.normalizedClaims,
  );
  if (!credential) {
    throw new Error("No active Magna passport credential is available in this wallet session.");
  }
  return credential;
}

export async function runWalletLoginForRequest(input: {
  policy: Policy;
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
    const credential = loadPassportCredential(session.activeAccount.address);
    return await runMagnaConsumerLogin({
      env,
      wallet: session.wallet,
      activeAddress: session.activeAccount.address,
      policy: input.policy,
      consumerGatewayAddress: input.consumerGatewayAddress,
      credential,
      onVerifying: input.onVerifying,
    });
  } catch (error) {
    console.warn("magna verification failed", error);
    if (error instanceof Error && error.message.includes("Deploy the passkey wallet")) {
      throw error;
    }
    return { verified: false, receipt: null };
  } finally {
    await session.disconnect();
  }
}
