import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Recovery, buildRecoveryGhostDeploymentAttempts } from "./App";
import type { ActiveZkPassportRequest } from "./lib/zkpassport";

vi.mock("@magna/wallet", () => ({
  CredentialType: { Passport: "passport" },
  createTransientGhostWalletSession: vi.fn(),
  createWebAuthnWalletSession: vi.fn(),
  loadStoredWebAuthnAccounts: vi.fn(() => []),
  MagnaBrowserClient: vi.fn(),
  isRootedPassportHints: vi.fn(() => false),
}));

vi.mock("./lib/zkpassport", () => ({
  startPassportZkRequest: vi.fn(),
  verifyAndRefreshRootAuthorityThroughBackend: vi.fn(),
  verifyAndIssueInstagramThroughBackend: vi.fn(),
  verifyAndIssueThroughBackend: vi.fn(),
  verifyRootRecoveryPreflightThroughBackend: vi.fn(),
}));

describe("Recovery", () => {
  it("tries the session fee payer before falling back to the local bootstrap account", () => {
    expect(
      buildRecoveryGhostDeploymentAttempts({
        feePayer: "0xfunded",
        activeAddress: "0xactive",
        enableLocalTestBootstrap: true,
        localTestAccountIndex: 2,
      }),
    ).toEqual([
      { deploymentFromAddress: "0xfunded" },
      { deployWithLocalTestAccount: true, localTestAccountIndex: 2 },
    ]);
  });

  it("uses a scrollable surface so long recovery content is reachable", () => {
    const html = renderToStaticMarkup(
      <Recovery
        busy={null}
        walletReady
        recoveryTarget={null}
        storedPublicKeyInput=""
        setStoredPublicKeyInput={() => undefined}
        credentials={[]}
        hints={{}}
        zkRequest={null}
        zkStage="idle"
        zkProofCount={0}
        onCreateTarget={() => undefined}
        onStoredTarget={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).toContain('<section class="recovery-surface">');
  });

  it("renders the active zkPassport recovery request link", () => {
    const activeRequest: ActiveZkPassportRequest = {
      requestId: "request-1",
      url: "https://zkpassport.test/request-1",
      cancel: () => undefined,
      completion: new Promise(() => undefined),
    };

    const html = renderToStaticMarkup(
      <Recovery
        busy={null}
        walletReady
        recoveryTarget={null}
        storedPublicKeyInput=""
        setStoredPublicKeyInput={() => undefined}
        credentials={[]}
        hints={{}}
        zkRequest={activeRequest}
        zkStage="request_created"
        zkProofCount={0}
        onCreateTarget={() => undefined}
        onStoredTarget={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).toContain("https://zkpassport.test/request-1");
    expect(html).toContain("Open request link");
  });
});
