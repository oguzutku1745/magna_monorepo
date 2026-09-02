import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  Recovery,
  Issuance,
  UserLogin,
  buildRecoveryGhostDeploymentAttempts,
  canonicalInstagramHandle,
  defaultPasskeyName,
  feeJuiceBalanceLabel,
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
  fundLocalFeeJuice: vi.fn(),
  loadStoredWebAuthnAccounts: vi.fn(() => []),
  MagnaBrowserClient: vi.fn(),
  readLocalFeeJuiceBalance: vi.fn(),
  isRootedPassportHints: vi.fn(() => false),
}));

vi.mock("./lib/zkpassport", () => ({
  startPassportZkRequest: vi.fn(),
  verifyAndRefreshRootAuthorityThroughBackend: vi.fn(),
  verifyAndIssueInstagramThroughBackend: vi.fn(),
  verifyAndIssuePassportPilotThroughBackend: vi.fn(),
  verifyAndIssueThroughBackend: vi.fn(),
}));

describe("Recovery", () => {
  it("gives new and recovery passkeys distinct user-visible names", () => {
    const now = new Date(2026, 7, 27, 17, 4, 12);

    expect(defaultPasskeyName("wallet", now)).toBe("Magna wallet · 2026-08-27 17:04:12");
    expect(defaultPasskeyName("recovery", now)).toBe("Magna recovery · 2026-08-27 17:04:12");
  });

  it("labels Fee Juice without assuming a display denomination", () => {
    expect(feeJuiceBalanceLabel("1000000000000000000000")).toBe(
      "1,000,000,000,000,000,000,000 base units",
    );
  });

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
        passkeyName="Magna recovery · test"
        setPasskeyName={() => undefined}
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
        onOpenTarget={() => undefined}
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
        passkeyName="Magna recovery · test"
        setPasskeyName={() => undefined}
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
        onOpenTarget={() => undefined}
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
          label: "Magna recovery · test",
          walletKind: "passkey",
          role: "user",
          createdAt: "2026-06-28T00:00:00.000Z",
          publicKey,
          deploymentStatus: "deployed",
          feePayer: "0xfee",
        }}
        passkeyName="Magna recovery · test"
        setPasskeyName={() => undefined}
        localFundingEnabled
        targetFeeJuiceBalance="1000"
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
        onOpenTarget={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).toContain("Target passkey public key");
    expect(html).toContain("Magna recovery · test");
    expect(html).toContain("Fund recovery target");
    expect(html).toContain(publicKey);
    expect(html).toContain("Copy target public key");
  });

  it("offers resumable destination finalization after the issuer transaction", () => {
    const publicKey = `04${"01".repeat(32)}${"02".repeat(32)}`;
    const html = renderToStaticMarkup(
      <Recovery
        busy={null}
        walletReady
        recoveryTarget={null}
        passkeyName="Magna recovery · test"
        setPasskeyName={() => undefined}
        pendingRecoveryFinalization={{
          version: 1,
          phase: "submitted",
          sourceCredentialId: "source",
          target: {
            address: "0xtarget",
            walletKind: "passkey",
            createdAt: "2026-08-27T00:00:00.000Z",
            publicKey,
            deploymentStatus: "deployed",
          },
          recoveredCredential: {
            id: "recovered",
            ownerAddress: "0xtarget",
            kind: "passport",
            status: "recovery_pending",
            claimsHash: "456",
            rootCommitment: "99",
            createdAt: "2026-08-27T00:00:00.000Z",
          },
          recoveryTxHash: "0xtx",
          createdAt: "2026-08-27T00:00:00.000Z",
          updatedAt: "2026-08-27T00:01:00.000Z",
        }}
        storedPublicKeyInput=""
        setStoredPublicKeyInput={() => undefined}
        credentials={[]}
        hints={{}}
        zkRequest={null}
        zkStage="error"
        zkProofCount={0}
        onCreateTarget={() => undefined}
        onStoredTarget={() => undefined}
        onCopyTargetPublicKey={() => undefined}
        onFinalizePending={() => undefined}
        onOpenTarget={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).toContain("Pending finalization");
    expect(html).toContain("0xtx");
    expect(html).toContain("Resume destination note finalization");
  });

  it("explains that completion moved the credential to the target wallet", () => {
    const html = renderToStaticMarkup(
      <Recovery
        busy={null}
        walletReady
        recoveryTarget={{
          address: "0xtarget",
          label: "Magna recovery · Alice",
          walletKind: "passkey",
          createdAt: "2026-08-27T00:00:00.000Z",
          publicKey: `04${"01".repeat(64)}`,
          deploymentStatus: "deployed",
        }}
        recoveryComplete
        recoveredCredentialChainState={{
          status: "active",
          reason: "chain-valid",
          checkedAtBlock: 38,
          checkedAtTimestamp: "1787862270",
        }}
        recoveryTransactionChainState={{
          status: "confirmed",
          txStatus: "proven",
          blockNumber: 37,
        }}
        passkeyName="Magna recovery · Alice"
        setPasskeyName={() => undefined}
        storedPublicKeyInput=""
        setStoredPublicKeyInput={() => undefined}
        credentials={[]}
        hints={{}}
        zkRequest={null}
        zkStage="recovery_v3_complete"
        zkProofCount={1}
        onCreateTarget={() => undefined}
        onStoredTarget={() => undefined}
        onCopyTargetPublicKey={() => undefined}
        onOpenTarget={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).toContain("Rotation complete");
    expect(html).toContain("The passport credential now belongs to the new passkey.");
    expect(html).toContain("Active at Aztec L2 block 38");
    expect(html).toContain("Successful at Aztec L2 block 37");
    expect(html).toContain("0xtarget");
    expect(html).toContain("Open recovered wallet");
    expect(html).not.toContain('Rooted credential</span><strong>missing');
  });

  it("does not claim completion from a saved browser target without active Aztec chain state", () => {
    const html = renderToStaticMarkup(
      <Recovery
        busy={null}
        walletReady
        recoveryTarget={{
          address: "0xtarget",
          label: "Magna recovery · Alice",
          walletKind: "passkey",
          createdAt: "2026-08-27T00:00:00.000Z",
          publicKey: `04${"01".repeat(64)}`,
          deploymentStatus: "deployed",
        }}
        recoveryComplete
        passkeyName="Magna recovery · Alice"
        setPasskeyName={() => undefined}
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
        onOpenTarget={() => undefined}
        onRecover={() => undefined}
      />,
    );

    expect(html).not.toContain("Rotation complete");
    expect(html).toContain("Open saved recovery target");
  });
});

describe("UserLogin", () => {
  it("shows old and recovered passkeys as separate named wallet choices", () => {
    const base = {
      publicKeyX: "01".repeat(32),
      publicKeyY: "02".repeat(32),
      rpIdHash: "03".repeat(32),
      rpId: "localhost",
      origin: "http://localhost:5174",
      walletMaterialSource: "webauthn-prf" as const,
    };
    const html = renderToStaticMarkup(
      <UserLogin
        busy={null}
        passkeyName="Magna wallet · new"
        setPasskeyName={() => undefined}
        storedAccounts={[
          {
            ...base,
            credentialId: "old-credential",
            address: "0xold",
            displayName: "Magna wallet · old",
          },
          {
            ...base,
            credentialId: "recovered-credential",
            address: "0xrecovered",
            displayName: "Magna recovery · 2026-08-27 23:24:30",
          },
        ]}
        missingRememberedWallet={null}
        onCreate={() => undefined}
        onExisting={() => undefined}
        onRestoreRemembered={() => undefined}
        onRecovery={() => undefined}
      />,
    );

    expect(html).toContain("Magna wallet · old");
    expect(html).toContain("0xold");
    expect(html).toContain("Magna recovery · 2026-08-27 23:24:30");
    expect(html).toContain("0xrecovered");
    expect(html.match(/>Open</g)).toHaveLength(2);
    expect(html).toContain("Create a different wallet");
  });

  it("offers an address-bound repair when an earlier build overwrote the previous wallet lookup", () => {
    const html = renderToStaticMarkup(
      <UserLogin
        busy={null}
        passkeyName="Magna wallet · new"
        setPasskeyName={() => undefined}
        storedAccounts={[]}
        missingRememberedWallet={{
          address: "0xsource",
          label: "Magna wallet · source",
          walletKind: "passkey",
          createdAt: "2026-08-27T00:00:00.000Z",
          publicKey: `04${"01".repeat(32)}${"02".repeat(32)}`,
        }}
        onCreate={() => undefined}
        onExisting={() => undefined}
        onRestoreRemembered={() => undefined}
        onRecovery={() => undefined}
      />,
    );

    expect(html).toContain("Previous wallet record");
    expect(html).toContain("Magna wallet · source");
    expect(html).toContain("0xsource");
    expect(html).toContain("Restore previous wallet");
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

  it("renders the complete tester-facing email issuance handoff", () => {
    const html = renderToStaticMarkup(
      <Issuance
        busy={null}
        walletReady
        zkRequest={null}
        zkStage="idle"
        zkProofCount={0}
        zkPassportIssuanceKind="a2"
        passportA2LocalWitnessAvailable={false}
        ageThreshold="18"
        setAgeThreshold={() => undefined}
        instagramHandle="@akinspur"
        setInstagramHandle={() => undefined}
        instagramEmailFileName="instagram-security.eml"
        onInstagramEmailFile={() => undefined}
        onReconnect={() => undefined}
        onStartZkPassport={() => undefined}
        onIssueInstagram={() => undefined}
        initialOpenRail="instagram"
      />,
    );

    expect(html).toContain("Signed security email proof");
    expect(html).toContain("Instagram .eml");
    expect(html).toContain("instagram-security.eml");
    expect(html).toContain("Issue Instagram credential");
    expect(html).toContain("generates the proof locally");
    expect(html).toContain("Neither the email nor the Instagram");
    expect(html).not.toContain(".eml is sent");
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
