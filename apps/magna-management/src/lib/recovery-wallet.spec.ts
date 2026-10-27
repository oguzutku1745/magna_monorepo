import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRecoveredPassportRef, prepareRecoveryDestination } from "./recovery-wallet";
import type { VerifiedPassportCompletion } from "./passport-issuance";

const state = vi.hoisted(() => ({
  open: vi.fn(), prepare: vi.fn(), disconnect: vi.fn(),
}));
vi.mock("@magna/wallet", async importOriginal => ({
  ...await importOriginal<typeof import("@magna/wallet")>(),
  createWebAuthnWalletSession: state.open,
  prepareWebAuthnRecoveryTarget: state.prepare,
}));
const options = { nodeUrl: "node", rpId: "localhost", userName: "Recovery", localTestAccountIndex: 0, deployWithLocalTestAccount: true };
const target = { address: "destination", displayName: "Recovery", publicKeyRecoveryBundle: "public", deploymentStatus: "deployed", materialOrigin: "new" };
const session = { wallet: { id: "destination-pxe" }, activeAccount: { address: "destination" }, metadata: { publicKeyRecoveryBundle: "public", deploymentStatus: "deployed" }, disconnect: state.disconnect };
beforeEach(() => {
  vi.clearAllMocks();
  state.disconnect.mockResolvedValue(undefined);
  state.open.mockResolvedValue(session);
  state.prepare.mockResolvedValue(target);
});
describe("destination recovery working session", () => {
  it("creates a destination and working PXE in an empty browser without an old session", async () => {
    const result = await prepareRecoveryDestination({ ...options, session: null, forceCreate: true });
    expect(result.session).toBe(session);
    expect(result.target).toMatchObject({ address: "destination", publicKeyRecoveryBundle: "public" });
    expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ forceCreate: true, nodeUrl: "node" }));
    expect(state.prepare).not.toHaveBeenCalled();
  });
  it("reopens only the pending destination after reload and rejects a different passkey", async () => {
    expect((await prepareRecoveryDestination({ ...options, session: null, publicKeyRecoveryBundle: "public", expectedAddress: "destination" })).session).toBe(session);
    await expect(prepareRecoveryDestination({ ...options, session: null, publicKeyRecoveryBundle: "public", expectedAddress: "different" })).rejects.toThrow(/mismatch/);
    expect(state.disconnect).toHaveBeenCalledOnce();
  });
  it("preserves an already-open wallet while preparing its secondary destination", async () => {
    const existing = { ...session, activeAccount: { address: "source" } };
    const result = await prepareRecoveryDestination({ ...options, session: existing as never });
    expect(result.session).toBe(existing);
    expect(state.prepare).toHaveBeenCalledWith(expect.objectContaining({ wallet: existing.wallet }));
    expect(state.open).not.toHaveBeenCalled();
    expect(state.disconnect).not.toHaveBeenCalled();
  });
});
describe("fresh destination Passport witness", () => {
  it("builds every witness field from fresh disclosures and new blinds without a source ref", () => {
    const completion = { status: "verified", queryResult: { age: { gte: { result: true } }, nationality: { disclose: { result: "TUR" } }, expiry_date: { disclose: { result: "2032-05-06" } } } } as unknown as VerifiedPassportCompletion;
    const ref = buildRecoveredPassportRef({
      completion, ageThreshold: 21, destination: "destination", issuerAddress: "issuer", ghostOwner: "ghost",
      metadata: { rootCommitment: 99n, claimsHash: 123n, nationalityBlind: 44n, expiryBlind: 55n }, now: "2026-10-28",
    });
    expect(ref).toMatchObject({ kind: "passport", mode: "rooted", issuanceKind: "a2", ownerAddress: "destination", status: "recovery_pending", rootCommitment: "99", claimsHash: "123", passportCommittedClaimsV2Witness: {
      schema: "passport-committed-claims-v2", credentialAuthenticity: "passport-a2", minAgeProven: 21,
      nationalityAlpha3Packed: "5526866", nationalityBlind: "44", expiryTs: "1967500799", expiryBlind: "55",
    } });
    const serialized = JSON.stringify(ref);
    for (const forbidden of ["identityValue", "uniqueIdentifier", "recoveryNonce", "messageSecret", "proof"]) expect(serialized).not.toContain(`"${forbidden}":`);
  });
});
