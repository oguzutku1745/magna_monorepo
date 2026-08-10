import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  Recovery,
  buildRecoveryGhostDeploymentAttempts,
  canonicalInstagramHandle,
  isFeePayerIdentityAddress,
  isInstagramHandleInputValid,
  passportCredentialAuthenticityLabel,
  walletIdentityAddress,
} from "./App";
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
        onCopyTargetPublicKey={() => undefined}
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
        onCopyTargetPublicKey={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).toContain("https://zkpassport.test/request-1");
    expect(html).toContain("Open request link");
  });

  it("renders the recovery target public key for copy/paste recovery", () => {
    const publicKey = `04${"01".repeat(32)}${"02".repeat(32)}`;
    const html = renderToStaticMarkup(
      <Recovery
        busy={null}
        walletReady
        recoveryTarget={{
          address: "0xtarget",
          walletKind: "passkey",
          role: "user",
          createdAt: "2026-06-28T00:00:00.000Z",
          publicKey,
          deploymentStatus: "deployed",
          feePayer: "0xfee",
        }}
        storedPublicKeyInput=""
        setStoredPublicKeyInput={() => undefined}
        credentials={[]}
        hints={{}}
        zkRequest={null}
        zkStage="idle"
        zkProofCount={0}
        onCreateTarget={() => undefined}
        onStoredTarget={() => undefined}
        onCopyTargetPublicKey={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).toContain("Target passkey public key");
    expect(html).toContain(publicKey);
    expect(html).toContain("Copy target public key");
  });
});

describe("wallet identity address", () => {
  it("does not treat the configured fee payer as the passkey identity", () => {
    const profile = {
      address: "0x1bc7",
      walletKind: "passkey",
      createdAt: "2026-06-28T00:00:00.000Z",
      publicKey: `04${"01".repeat(32)}${"02".repeat(32)}`,
      deploymentStatus: "deployed",
      feePayer: "0x1bc7",
    };
    const env = { orchestratorAddress: "0x1bc7" };

    expect(isFeePayerIdentityAddress(profile.address, null, profile, env)).toBe(true);
    expect(walletIdentityAddress(null, profile, env)).toBeUndefined();
  });

  it("prefers the live passkey address over stale profile state", () => {
    const session = {
      activeAccount: { address: "0xpasskey" },
      metadata: { feePayer: "0x1bc7" },
    } as never;
    const profile = {
      address: "0x1bc7",
      walletKind: "passkey",
      createdAt: "2026-06-28T00:00:00.000Z",
      deploymentStatus: "deployed",
      feePayer: "0x1bc7",
    };

    expect(walletIdentityAddress(session, profile, { orchestratorAddress: "0x1bc7" })).toBe("0xpasskey");
  });
});

describe("Instagram handle input", () => {
  it("requires a visible @ prefix before issuing", () => {
    expect(isInstagramHandleInputValid("@akinspur")).toBe(true);
    expect(isInstagramHandleInputValid("@AkinSpur")).toBe(true);
    expect(isInstagramHandleInputValid("akinspur")).toBe(false);
    expect(isInstagramHandleInputValid("@bad handle")).toBe(false);
    expect(canonicalInstagramHandle("@AkinSpur")).toBe("akinspur");
  });
});

describe("passportCredentialAuthenticityLabel", () => {
  it("labels rediscovered witness-missing passport refs explicitly", () => {
    expect(passportCredentialAuthenticityLabel({ kind: "passport" })).toBe(
      "passport note found (local A2 committed-claims witness missing)",
    );
  });

  it("labels only an A2 ref with its local witness as authentic", () => {
    expect(
      passportCredentialAuthenticityLabel({
        kind: "passport",
        issuanceKind: "a2",
        passportCommittedClaimsV2Witness: {
          schema: "passport-committed-claims-v2",
          credentialAuthenticity: "passport-a2",
          minAgeProven: 21,
          nationalityAlpha3Packed: "5526610",
          nationalityBlind: "111",
          expiryTs: "1942358399",
          expiryBlind: "222",
        },
      }),
    ).toBe("passport A2 recursive proof (PII-blind)");
  });

  it("does not infer A2 authenticity when issuance metadata is missing", () => {
    expect(
      passportCredentialAuthenticityLabel({
        kind: "passport",
        passportCommittedClaimsV2Witness: {
          schema: "passport-committed-claims-v2",
          credentialAuthenticity: "passport-a2",
          minAgeProven: 21,
          nationalityAlpha3Packed: "5526610",
          nationalityBlind: "111",
          expiryTs: "1942358399",
          expiryBlind: "222",
        },
      }),
    ).toBe("passport note found (local A2 committed-claims witness missing)");
  });
});
