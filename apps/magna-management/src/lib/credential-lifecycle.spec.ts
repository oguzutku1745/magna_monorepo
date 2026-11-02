import { describe, expect, it, vi } from "vitest";
import { findLivePassportRoots, linkInstagramCredential, readCredentialLifecycle, revokeOwnedCredential, replaceLinkedCredentialRef } from "./credential-lifecycle";
import type { StoredCredentialRef } from "./storage";

const active = { status: "active", reason: "chain-valid", checkedAtBlock: 8, checkedAtTimestamp: "100" } as const;
const instagram = (extra: Partial<StoredCredentialRef> = {}): StoredCredentialRef => ({
  id: "ig", ownerAddress: "owner", issuerAddress: "issuer", kind: "instagram", mode: "passport",
  status: "active", claimsHash: "12", createdAt: "2026-10-28", ...extra,
});
const passport = instagram({ id: "passport", kind: "passport", mode: "rooted", rootCommitment: "99" });
function client() {
  return {
    fetchPassportHintsByClaimsHash: vi.fn(async () => ({ claimsHash: "12", hintedCredentialNote: {}, hintedStatusNote: {} })),
    fetchLinkedInstagramHints: vi.fn(async () => ({ claimsHash: "12", rootCommitment: "99", hintedCredentialNote: {}, hintedStatusNote: {}, hintedRootStatusNote: {} })),
    fetchRootedPassportHintsByClaimsHash: vi.fn(),
    readRootedPassportChainState: vi.fn(),
    readInstagramChainState: vi.fn(async () => active),
    fetchLiveRootStatusHint: vi.fn(async () => ({})),
    readRootStatusChainState: vi.fn(async () => active),
    linkCredentialToRoot: vi.fn(async () => ({ receipt: { alreadyLinked: true } })),
    revokeCredential: vi.fn(async () => ({ receipt: {} })),
    revokeRoot: vi.fn(async () => ({ receipt: {} })),
  };
}

describe("credential lifecycle", () => {
  it("reads linked Instagram through its root without asking for Passport authority", async () => {
    const wallet = client();
    const result = await readCredentialLifecycle(wallet as never, instagram({ mode: "rooted", rootCommitment: "99" }));
    expect(result.chainState).toEqual(active);
    expect(wallet.fetchLinkedInstagramHints).toHaveBeenCalledWith("99", "12");
    expect(wallet.fetchPassportHintsByClaimsHash).not.toHaveBeenCalled();
    expect(wallet.fetchRootedPassportHintsByClaimsHash).not.toHaveBeenCalled();
  });
  it("does not downgrade malformed linked Instagram to standalone", async () => {
    const wallet = client();
    await expect(readCredentialLifecycle(wallet as never, instagram({ mode: "rooted" }))).rejects.toThrow(/root commitment/i);
    expect(wallet.fetchPassportHintsByClaimsHash).not.toHaveBeenCalled();
  });
  it("reads an independent instance without a root even after recovery", async () => {
    const wallet = client();
    expect((await readCredentialLifecycle(wallet as never, instagram())).chainState).toEqual(active);
    expect(wallet.fetchLinkedInstagramHints).not.toHaveBeenCalled();
    expect(wallet.fetchLiveRootStatusHint).not.toHaveBeenCalled();
  });
  it("offers live roots without Passport authority validity or a claims witness", async () => {
    const wallet = client();
    wallet.readRootedPassportChainState.mockResolvedValue({ ...active, status: "expired" });
    expect(await findLivePassportRoots(wallet as never, [passport])).toEqual(["99"]);
    expect(wallet.fetchLiveRootStatusHint).toHaveBeenCalledWith("99");
    expect(wallet.readRootedPassportChainState).not.toHaveBeenCalled();
  });
  it("revokes Instagram without a handle witness and routes Passport to root revoke", async () => {
    const wallet = client();
    await revokeOwnedCredential(wallet as never, instagram());
    await revokeOwnedCredential(wallet as never, instagram({ mode: "rooted", rootCommitment: "99" }));
    await revokeOwnedCredential(wallet as never, passport);
    expect(wallet.revokeCredential.mock.calls).toEqual([[{ mode: "passport", claimsHash: "12" }], [{ mode: "rooted", claimsHash: "12", rootCommitment: "99" }]]);
    expect(wallet.revokeRoot).toHaveBeenCalledWith("99");
  });
  it("replaces only the converted instance and keeps other active credentials", () => {
    const source = instagram();
    const other = instagram({ id: "other", claimsHash: "13" });
    const linked = instagram({ id: "linked", mode: "rooted", rootCommitment: "99" });
    expect(replaceLinkedCredentialRef([source, other, passport, { ...source, id: "stale-id" }], source, linked)).toEqual([linked, other, passport]);
  });

  it("confirms a settled link before changing local mode and preserves its claims witness", async () => {
    const wallet = client();
    const ref = instagram({ handleHash: "55", handleBlind: "66" });
    const linked = await linkInstagramCredential(wallet as never, ref, "99");
    expect(wallet.linkCredentialToRoot).toHaveBeenCalledWith("12", "99");
    expect(linked.ref).toMatchObject({ mode: "rooted", rootCommitment: "99", claimsHash: "12", handleBlind: "66" });
    expect(linked.chainState).toEqual(active);
    wallet.readInstagramChainState.mockResolvedValueOnce({ ...active, status: "inactive", reason: "root-version-mismatch" } as never);
    await expect(linkInstagramCredential(wallet as never, ref, "99")).rejects.toThrow(/inactive/);
    expect(ref.mode).toBe("passport");
  });
});
