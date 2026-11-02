import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { WalletSession } from "@magna/wallet";
import type { StoredCredentialRef } from "./lib/storage";
import { App, Recovery } from "./App";
import { loadCredentialRefs, loadPendingRecoveryV3Finalization, loadRecoveryTargetProfile, saveCredentialRefs, savePendingRecoveryV3Finalization, saveRecoveryTargetProfile } from "./lib/storage";

const state = vi.hoisted(() => ({
  recovery: null as ComponentProps<typeof Recovery> | null,
  open: vi.fn(), prepare: vi.fn(), proofRequest: vi.fn(), clock: vi.fn(), intent: vi.fn(),
  fetch: vi.fn(), chain: vi.fn(), go: vi.fn(), discover: vi.fn(), sync: vi.fn(), instagram: vi.fn(), linked: vi.fn(), standalone: vi.fn(), rootHint: vi.fn(), rootState: vi.fn(),
  sessionSeed: undefined as WalletSession | undefined,
  credentialSeed: undefined as StoredCredentialRef[] | undefined,
  finalCredentials: [] as StoredCredentialRef[],
  finalHints: {} as Record<string, { chainState?: { status: string; reason: string } }>,
  finalNotice: null as { tone: string; text: string } | null,
  nullStates: 0, arrayStates: 0, objectStates: 0,
}));
// SSR does not rerender updates. Observe the real App's credential/hint setter boundary;
// seed its session/chain snapshot to model a wallet already opened through PXE.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: ((initial: unknown) => {
    const [value, dispatch] = actual.useState(initial);
    if (initial === null) {
      state.nullStates++;
      if (state.nullStates === 2) return [value, (next: typeof state.finalNotice) => { state.finalNotice = next; dispatch(next); }];
      if (state.nullStates === 3 && state.sessionSeed) return [state.sessionSeed, dispatch];
    }
    if (Array.isArray(initial) && ++state.arrayStates === 1) {
      state.finalCredentials = state.credentialSeed ?? value as StoredCredentialRef[];
      return [state.finalCredentials, (next: StoredCredentialRef[] | ((current: StoredCredentialRef[]) => StoredCredentialRef[])) => {
        state.finalCredentials = typeof next === "function" ? next(state.finalCredentials) : next;
        dispatch(next);
      }];
    }
    if (initial && typeof initial === "object" && !Array.isArray(initial) && Object.keys(initial).length === 0 && ++state.objectStates === 1) {
      return [value, (next: typeof state.finalHints | ((current: typeof state.finalHints) => typeof state.finalHints)) => {
        state.finalHints = typeof next === "function" ? next(state.finalHints) : next;
        dispatch(next);
      }];
    }
    return [value, dispatch];
  }) as typeof actual.useState };
});
// Capture the real App's rendered callback boundary while retaining React's real hooks/rendering.
vi.mock("react/jsx-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const capture = (type: unknown, props: unknown) => {
    if (typeof type === "function" && type.name === "Recovery") state.recovery = props as ComponentProps<typeof Recovery>;
  };
  return {
    ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { capture(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { capture(args[0], args[1]); return actual.jsxs(...args); },
  };
});
vi.mock("react/jsx-dev-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-dev-runtime")>();
  return { ...actual, jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
    const type = args[0];
    if (typeof type === "function" && type.name === "Recovery") state.recovery = args[1] as ComponentProps<typeof Recovery>;
    return actual.jsxDEV(...args);
  } };
});
vi.mock("@magna/wallet", async importOriginal => ({
  ...await importOriginal<typeof import("@magna/wallet")>(),
  createWebAuthnWalletSession: state.open,
  prepareWebAuthnRecoveryTarget: state.prepare,
  loadStoredWebAuthnAccounts: () => [],
  MagnaBrowserClient: class {
    fetchRootedPassportHintsByClaimsHash = state.fetch; readRootedPassportChainState = state.chain;
    discoverCredentialRefs = state.discover; syncOrchestratorSender = state.sync;
    fetchPassportHintsByClaimsHash = state.standalone; fetchLinkedInstagramHints = state.linked;
    readInstagramChainState = state.instagram;
    fetchLiveRootStatusHint = state.rootHint; readRootStatusChainState = state.rootState;
  },
}));
const address = `0x${"11".repeat(32)}`;
const issuer = `0x${"22".repeat(32)}`;
vi.mock("./lib/env", () => ({ getManagementEnv: () => ({
  aztecNodeUrl: "node", issuerAddress: `0x${"22".repeat(32)}`, enableLocalTestBootstrap: false, localTestAccountIndex: 0,
  zkPassportDevMode: true, l1RpcUrl: "l1", recoveryV3RelayerPrivateKey: "key",
  recoveryV3: { domain: "localhost", scope: "magna", ethereumChainId: 31337n, portalAddress: "portal", aztecChainId: 31337n, aztecProtocolVersion: 1n },
}) }));
vi.mock("./lib/router", () => ({ navigate: vi.fn(), useRoute: () => ({ path: "/user/recovery", go: state.go }) }));
vi.mock("./lib/zkpassport", () => ({ startPassportZkRequest: state.proofRequest }));
vi.mock("./lib/recovery-v3", () => ({ preflightRecoveryV3LocalClock: state.clock, prepareRecoveryV3Request: state.intent }));

const target = { address, label: "Destination", walletKind: "passkey", publicKey: "public", deploymentStatus: "deployed", createdAt: "2026-10-28" };
const recovered = { id: "recovered", ownerAddress: address, issuerAddress: issuer, kind: "passport" as const, mode: "rooted" as const, status: "recovery_pending" as const, claimsHash: "123", rootCommitment: "99", createdAt: "2026-10-28" };
beforeEach(() => {
  vi.clearAllMocks(); state.recovery = null;
  state.sessionSeed = undefined; state.credentialSeed = undefined;
  state.finalCredentials = []; state.finalHints = {}; state.finalNotice = null;
  state.nullStates = 0; state.arrayStates = 0; state.objectStates = 0;
  state.discover.mockResolvedValue([]); state.sync.mockResolvedValue(undefined);
  state.rootHint.mockResolvedValue({ root: "fresh" });
  state.rootState.mockResolvedValue({ status: "active", reason: "chain-valid", checkedAtBlock: 9, checkedAtTimestamp: "101" });
  state.standalone.mockImplementation(async (_owner: string, claimsHash: string) => ({ claimsHash }));
  state.linked.mockImplementation(async (rootCommitment: string, claimsHash: string) => ({ rootCommitment, claimsHash }));
  state.instagram.mockImplementation(async (hints: { claimsHash: string }) => ({ status: hints.claimsHash === "777" ? "inactive" : "active", reason: hints.claimsHash === "777" ? "root-lineage-revoked-or-recovered" : "chain-valid", checkedAtBlock: 9, checkedAtTimestamp: "101" }));
  const store = new Map<string, string>();
  vi.stubGlobal("window", { location: { hostname: "localhost", origin: "http://localhost" }, PublicKeyCredential: {},
    setTimeout: (callback: () => void) => setTimeout(callback, 0),
    localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  state.open.mockResolvedValue({ kind: "passkey", wallet: { id: "destination-pxe" }, activeAccount: { address }, metadata: { deploymentStatus: "deployed", publicKeyRecoveryBundle: "public" }, disconnect: vi.fn(async () => undefined) });
  state.clock.mockResolvedValue(0n);
  state.intent.mockResolvedValue({ bindCustomData: "destination-bound-intent" });
  state.proofRequest.mockResolvedValue({ requestId: "request", url: "https://proof.test", completion: Promise.resolve({ status: "rejected" }), cancel: () => undefined });
  state.fetch.mockResolvedValue({ claimsHash: "123", rootCommitment: "99", hintedCredentialNote: {}, hintedStatusNote: {}, hintedRootStatusNote: {}, hintedRootAuthorityNote: {} });
  state.chain.mockResolvedValue({ status: "active", reason: "chain-valid", checkedAtBlock: 8, checkedAtTimestamp: "100" });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("actual App recovery handlers without a source session", () => {
  it("creates and persists a destination through the recovery-target handler in an empty browser", async () => {
    renderToStaticMarkup(<App />);
    await state.recovery!.onCreateTarget();
    await vi.waitFor(() => expect(loadRecoveryTargetProfile()?.address).toBe(address));
    expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ forceCreate: true }));
    expect(state.prepare).not.toHaveBeenCalled();
  });
  it("starts a fresh destination-bound Passport request without source refs or witnesses", async () => {
    saveRecoveryTargetProfile(target);
    renderToStaticMarkup(<App />);
    state.recovery!.onRecover();
    await vi.waitFor(() => expect(state.proofRequest).toHaveBeenCalledOnce());
    expect(state.intent).toHaveBeenCalledWith(expect.objectContaining({ issuerL2Address: issuer }), address);
    expect(state.proofRequest).toHaveBeenCalledWith(expect.objectContaining({ ageThreshold: 18, a2BindCustomData: "destination-bound-intent", devMode: true }));
    expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ publicKeyRecoveryBundle: "public" }));
    expect(state.go).not.toHaveBeenCalledWith("/user/login");
  });
  it.each(["same-wallet", "different-wallet"])("keeps chain-only independent state and revalidates linked state after %s recovery", async mode => {
    const workingOwner = mode === "same-wallet" ? address : `0x${"33".repeat(32)}`;
    const independent: StoredCredentialRef = { id: "independent", ownerAddress: workingOwner, issuerAddress: issuer, kind: "instagram", mode: "passport", status: "active", claimsHash: "456", createdAt: "2026-10-28" };
    const oldLinked: StoredCredentialRef = { ...independent, id: "old-linked", mode: "rooted", rootCommitment: "99", claimsHash: "777" };
    state.credentialSeed = [independent, oldLinked];
    state.sessionSeed = { kind: "passkey", wallet: { id: "working-pxe" }, activeAccount: { address: workingOwner }, metadata: { deploymentStatus: "deployed" } } as never;
    state.prepare.mockResolvedValue({ address, displayName: "Destination", publicKeyRecoveryBundle: "public", deploymentStatus: "deployed", materialOrigin: "recovered" });
    state.discover.mockResolvedValue([independent, oldLinked].map(ref => ({ ownerAddress: ref.ownerAddress, kind: ref.kind, mode: ref.mode, claimsHash: ref.claimsHash, rootCommitment: ref.rootCommitment })));
    savePendingRecoveryV3Finalization({ version: 1, phase: "submitted", target, recoveredCredential: recovered, recoveryTxHash: "tx", createdAt: "2026-10-28", updatedAt: "2026-10-28" });
    expect(loadCredentialRefs()).toEqual([]);
    renderToStaticMarkup(<App />);
    state.recovery!.onFinalizePending!();
    await vi.waitFor(() => expect(loadPendingRecoveryV3Finalization()).toBeNull());
    expect(state.finalCredentials).toEqual(expect.arrayContaining([expect.objectContaining({ ownerAddress: workingOwner, kind: "instagram", mode: "passport", claimsHash: "456" })]));
    expect(state.discover).toHaveBeenCalledWith(workingOwner);
    const linkedRef = state.finalCredentials.find(ref => ref.claimsHash === "777")!;
    expect(state.finalHints[linkedRef.id]?.chainState).toMatchObject({ status: "inactive", reason: "root-lineage-revoked-or-recovered" });
    if (mode === "same-wallet") expect(state.rootState).toHaveBeenCalledWith({ root: "fresh" }, "99");
  });

  it("resumes destination finalization after reload while retaining independent credentials", async () => {
    const independent = { id: "independent", ownerAddress: "old-owner", issuerAddress: issuer, kind: "instagram" as const, mode: "passport" as const, status: "active" as const, claimsHash: "456", createdAt: "2026-10-28" };
    saveCredentialRefs([independent]);
    savePendingRecoveryV3Finalization({ version: 1, phase: "submitted", target, recoveredCredential: recovered, recoveryTxHash: "tx", createdAt: "2026-10-28", updatedAt: "2026-10-28" });
    renderToStaticMarkup(<App />);
    state.recovery!.onFinalizePending!();
    await vi.waitFor(() => expect(loadPendingRecoveryV3Finalization()).toBeNull());
    expect(loadCredentialRefs()).toEqual(expect.arrayContaining([independent, expect.objectContaining({ id: "recovered", status: "active", recoveryTxHash: "tx" })]));
    expect(state.fetch).toHaveBeenCalledWith(address, "99", "123");
    expect(state.finalCredentials).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "independent" })]));
    expect(state.go).not.toHaveBeenCalledWith("/user/login");
  });

  it("keeps finalization pending if the authoritative working-owner snapshot cannot be rediscovered", async () => {
    savePendingRecoveryV3Finalization({ version: 1, phase: "submitted", target, recoveredCredential: recovered, recoveryTxHash: "tx", createdAt: "2026-10-28", updatedAt: "2026-10-28" });
    state.discover.mockRejectedValueOnce(new Error("PXE unavailable"));
    renderToStaticMarkup(<App />);
    state.recovery!.onFinalizePending!();
    await vi.waitFor(() => expect(state.finalNotice).toMatchObject({ tone: "danger", text: "PXE unavailable" }));
    expect(state.discover).toHaveBeenCalledOnce();
    expect(loadPendingRecoveryV3Finalization()?.phase).toBe("submitted");
    expect(state.finalCredentials).toEqual([]);
  });
});
