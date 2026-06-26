import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Recovery, buildRecoveryGhostDeploymentAttempts, passportCredentialAuthenticityLabel } from "./App";
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
  verifyAndIssuePassportPilotThroughBackend: vi.fn(),
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

describe("passportCredentialAuthenticityLabel", () => {
  it("does not label rediscovered unsupported passport refs as legacy", () => {
    expect(passportCredentialAuthenticityLabel({ kind: "passport" })).toBe(
      "unsupported passport credential (re-issue with A1/v2 support)",
    );
  });

  it("labels explicit pilot and legacy passport refs", () => {
    expect(passportCredentialAuthenticityLabel({ kind: "passport", issuanceKind: "pilot" })).toBe(
      "PII-blind pilot (non-production; not passport-authentic)",
    );
    expect(
      passportCredentialAuthenticityLabel({
        kind: "passport",
        issuanceKind: "a1",
        passportCommittedClaimsV2Witness: {
          schema: "passport-committed-claims-v2",
          credentialAuthenticity: "passport-a1",
          minAgeProven: 21,
          nationalityAlpha3Packed: "5526610",
          nationalityBlind: "111",
          expiryTs: "1942358399",
          expiryBlind: "222",
        },
      }),
    ).toBe("passport A1 wrapper proof (PII-blind)");
    expect(passportCredentialAuthenticityLabel({ kind: "passport", issuanceKind: "legacy" })).toBe(
      "legacy zkPassport backend verification",
    );
  });

  it("uses normalized claims as legacy evidence for older local refs", () => {
    expect(
      passportCredentialAuthenticityLabel({
        kind: "passport",
        normalizedClaims: {
          nationalityAlpha3: "TUR",
          minAgeProven: 21,
          passportExpiryDate: "2031-07-20",
          expiryTs: "1942358399",
        },
      }),
    ).toBe("legacy zkPassport backend verification");
  });
});
