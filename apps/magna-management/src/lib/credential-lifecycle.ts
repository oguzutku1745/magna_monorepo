import { isRootedPassportHints, type MagnaBrowserClient } from "@magna/wallet";
import type { StoredCredentialRef } from "./storage";

type LifecycleClient = Pick<MagnaBrowserClient,
  "fetchPassportHintsByClaimsHash" | "fetchLinkedInstagramHints" | "fetchRootedPassportHintsByClaimsHash" |
  "readInstagramChainState" | "readRootedPassportChainState" | "fetchLiveRootStatusHint" |
  "readRootStatusChainState" | "linkCredentialToRoot" | "revokeCredential" | "revokeRoot">;

function requiredRoot(ref: StoredCredentialRef): string {
  if (!ref.rootCommitment) throw new Error("Linked credential is missing its root commitment.");
  return ref.rootCommitment;
}

export async function readCredentialLifecycle(client: LifecycleClient, ref: StoredCredentialRef) {
  if (ref.kind === "instagram") {
    const hints = ref.mode === "rooted"
      ? await client.fetchLinkedInstagramHints(requiredRoot(ref), ref.claimsHash)
      : await client.fetchPassportHintsByClaimsHash(ref.ownerAddress, ref.claimsHash);
    return { hints, chainState: await client.readInstagramChainState(hints) };
  }
  const hints = ref.mode === "rooted"
    ? await client.fetchRootedPassportHintsByClaimsHash(ref.ownerAddress, requiredRoot(ref), ref.claimsHash)
    : await client.fetchPassportHintsByClaimsHash(ref.ownerAddress, ref.claimsHash);
  return { hints, chainState: isRootedPassportHints(hints) ? await client.readRootedPassportChainState(hints) : undefined };
}

export async function findLivePassportRoots(client: LifecycleClient, refs: StoredCredentialRef[]): Promise<string[]> {
  const roots = [...new Set(refs.filter(ref => ref.kind === "passport" && ref.mode === "rooted").map(ref => ref.rootCommitment).filter((root): root is string => Boolean(root)))];
  const live: string[] = [];
  for (const root of roots) {
    try {
      const hint = await client.fetchLiveRootStatusHint(root);
      if ((await client.readRootStatusChainState(hint, root)).status === "active") live.push(root);
    } catch {
      // A cached Passport reference is only a locator; unavailable/revoked roots are not link targets.
    }
  }
  return live;
}

export async function revokeOwnedCredential(client: LifecycleClient, ref: StoredCredentialRef) {
  return ref.kind === "passport"
    ? client.revokeRoot(requiredRoot(ref))
    : client.revokeCredential({ mode: ref.mode ?? "passport", claimsHash: ref.claimsHash,
      ...(ref.mode === "rooted" ? { rootCommitment: requiredRoot(ref) } : {}) });
}

export async function linkInstagramCredential(client: LifecycleClient, ref: StoredCredentialRef, rootCommitment: string) {
  if (ref.kind !== "instagram" || ref.mode === "rooted") throw new Error("Select an independent Instagram credential to link.");
  const outcome = await client.linkCredentialToRoot(ref.claimsHash, rootCommitment);
  const linked: StoredCredentialRef = {
    ...ref, mode: "rooted", rootCommitment,
    id: [ref.issuerAddress?.trim().toLowerCase() ?? "issuer:unknown", ref.ownerAddress, ref.kind, "rooted", ref.claimsHash, rootCommitment].join(":"),
    issuanceTxHash: outcome.txHash ?? ref.issuanceTxHash, updatedAt: new Date().toISOString(),
  };
  const state = await readCredentialLifecycle(client, linked);
  if (state.chainState?.status !== "active") throw new Error(`Linked Instagram credential is ${state.chainState?.status ?? "unverified"}.`);
  return { ref: linked, ...state };
}

/** Replace this converted instance without dropping siblings absent from the local witness sidecar. */
export function replaceLinkedCredentialRef(refs: StoredCredentialRef[], source: StoredCredentialRef, linked: StoredCredentialRef): StoredCredentialRef[] {
  const normalized = (value?: string) => value?.trim().toLowerCase() ?? "";
  return [linked, ...refs.filter(ref => ref.id !== linked.id && !(
    ref.kind === source.kind && ref.claimsHash === source.claimsHash && ref.mode !== "rooted" &&
    normalized(ref.ownerAddress) === normalized(source.ownerAddress) && normalized(ref.issuerAddress) === normalized(source.issuerAddress)
  ))];
}
