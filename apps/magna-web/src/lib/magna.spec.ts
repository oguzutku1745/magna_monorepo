import { beforeEach, describe, expect, it, vi } from "vitest";
import { GasFees } from "@aztec/stdlib/gas";
import {
  CONTRACT_COMPATIBILITY_REQUIREMENTS,
  buildPassportCommittedClaimsWitness,
  MagnaBrowserClient,
  buildPassportClaimsWitness,
  buildPassportPolicy,
  createDefaultPassportClaimsForm,
  createDefaultPolicyForm,
  deriveGhostAccountPreview,
  issuePassportWithDevOrchestrator,
  packAlpha3,
  passportClaimsFromForm,
  readSponsorSlot,
} from "./magna";
import { getAppEnv } from "./env";
import { ClaimId, ConstraintOp } from "@magna/core";

const sponsorContracts = new Map<string, any>();
let issuerContractMock: any;
let rightsRegistryMock: any;
let rightsPurchaseMock: any;
let l2PaymentTokenMock: any;
let nodeMock: any;
const authwitCreateMock = vi.fn();
const ghostAccountAddressMock = vi.fn();
const VALID_PAYMENT_TOKEN = `0x${"0".repeat(63)}1`;
const VALID_TREASURY = `0x${"0".repeat(63)}2`;

function buildReadyWalletMock(overrides?: {
  isContractPublished?: boolean;
  initializationStatus?: string;
  instance?: object | undefined;
}) {
  return {
    getContractMetadata: vi.fn(async () => ({
      instance: overrides?.instance ?? {},
      initializationStatus: overrides?.initializationStatus ?? "INITIALIZED",
      isContractPublished: overrides?.isContractPublished ?? true,
    })),
    registerSender: vi.fn(async () => undefined),
  };
}

vi.mock("./aztec", () => ({
  toAddress: (value: string) => value,
  getAztecNode: vi.fn(() => nodeMock),
  bindIssuerContract: vi.fn(() => issuerContractMock),
  bindCompanySponsorContract: vi.fn((_wallet: unknown, sponsorAddress: string) => sponsorContracts.get(sponsorAddress)),
  readTxHash: () => "0xtxhash",
  registerContractArtifactAtAddress: vi.fn(async () => undefined),
}));

vi.mock("@magna/contracts-bindings", () => ({
  MagnaIssuerContract: {
    artifact: { name: "MagnaIssuer" },
  },
  MagnaCompanySponsorContract: {
    artifact: { name: "MagnaCompanySponsor" },
  },
  MagnaCompanyRightsRegistryContract: {
    artifact: { name: "MagnaCompanyRightsRegistry" },
    at: vi.fn(() => rightsRegistryMock),
  },
  MagnaRightsPurchaseL2Contract: {
    artifact: { name: "MagnaRightsPurchaseL2" },
    at: vi.fn(() => rightsPurchaseMock),
  },
}));

vi.mock("@aztec/noir-contracts.js/Token", () => ({
  TokenContract: {
    artifact: { name: "Token" },
    at: vi.fn(() => l2PaymentTokenMock),
  },
}));

vi.mock("@aztec/aztec.js/authorization", () => ({
  SetPublicAuthwitContractInteraction: {
    create: (...args: unknown[]) => authwitCreateMock(...args),
  },
}));

vi.mock("@aztec/accounts/schnorr", () => ({
  getSchnorrAccountContractAddress: (...args: unknown[]) => ghostAccountAddressMock(...args),
}));

function buildSponsorMock(label: string) {
  return {
    address: label,
    methods: {
      sponsored_verify: vi.fn(() => ({
        send: vi.fn(async () => ({ txHash: `0x-${label}-verify` })),
      })),
      sponsored_verify_instagram: vi.fn(),
      sponsored_verify_linked: vi.fn(() => ({
        send: vi.fn(async () => ({ txHash: `0x-${label}-verify-linked` })),
      })),
      get_sponsored_verify_count: vi.fn(() => ({
        simulate: vi.fn(async () => ({ result: 0n })),
      })),
      get_max_fee_cap: vi.fn(() => ({
        simulate: vi.fn(async () => ({ result: "1000000000000000000000000000000" })),
      })),
    },
  };
}

describe("magna app helpers", () => {
  beforeEach(() => {
    sponsorContracts.clear();
    authwitCreateMock.mockReset();
    ghostAccountAddressMock.mockReset();
    ghostAccountAddressMock.mockResolvedValue({
      toString: () => "0xghostderived",
    });
    nodeMock = {
      getCurrentMinFees: vi.fn(async () => new GasFees(100_000n, 15_500_000n)),
    };

    issuerContractMock = {
      address: { toString: () => "0xissuer" },
      methods: {
        verify: vi.fn(),
        verify_v2: vi.fn(() => ({
          send: vi.fn(async () => ({ txHash: "0xverify-v2" })),
        })),
        verify_linked: vi.fn(() => ({
          send: vi.fn(async () => ({ txHash: "0xverify-linked" })),
        })),
        verify_linked_v2: vi.fn(() => ({
          send: vi.fn(async () => ({ txHash: "0xverify-linked-v2" })),
        })),
        get_credential_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { claims_hash: 1n } } })),
        })),
        get_status_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { claims_hash: 1n } } })),
        })),
        get_linked_credential_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { root_commitment: 99n } } })),
        })),
        get_linked_status_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { root_commitment: 99n } } })),
        })),
        get_linked_recovery_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { root_commitment: 99n } } })),
        })),
        get_root_status_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { root_commitment: 99n } } })),
        })),
        get_root_recovery_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { root_commitment: 99n } } })),
        })),
        get_root_authority_hinted: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { note: { root_commitment: 99n } } })),
        })),
        add_company_sponsor_gateway: vi.fn(() => ({
          send: vi.fn(async () => ({ txHash: "0xadd" })),
        })),
        remove_company_sponsor_gateway: vi.fn(),
        refresh_root_authority: vi.fn(() => ({
          send: vi.fn(async () => ({ txHash: "0xrefresh-root-authority" })),
        })),
        recover: vi.fn(),
        recover_root: vi.fn(),
        register_credential: vi.fn(() => ({
          send: vi.fn(async () => ({ txHash: "0xissue" })),
        })),
        is_company_sponsor_gateway: vi.fn((sponsorAddress: string) => ({
          simulate: vi.fn(async () => ({ result: sponsorAddress === "0xsponsor-a" })),
        })),
      },
    };

    rightsRegistryMock = {
      address: { toString: () => "0xrights-registry" },
      methods: {
        get_remaining_verifies: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: "11" })),
        })),
        get_consumed_verifies: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: 4 })),
        })),
        get_last_credit_nonce: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { toBigInt: () => 9n } })),
        })),
        get_package_id: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { inner: 3n } })),
        })),
      },
    };

    rightsPurchaseMock = {
      address: { toString: () => "0xrights-purchase" },
      methods: {
        get_next_purchase_id: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { value: 42n } })),
        })),
        get_price_per_verify: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: "150000" })),
        })),
        get_payment_token: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: { toString: () => VALID_PAYMENT_TOKEN } })),
        })),
        get_treasury: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: VALID_TREASURY })),
        })),
        purchase_rights_public: vi.fn(() => ({
          send: vi.fn(async () => ({ txHash: "0xtopup" })),
        })),
      },
    };

    l2PaymentTokenMock = {
      methods: {
        transfer_in_public: vi.fn(() => ({ action: "transfer" })),
      },
    };

    authwitCreateMock.mockResolvedValue({
      send: vi.fn(async () => ({ txHash: "0xauthwit" })),
    });
  });

  it("converts passport claims form input into witness data", () => {
    const claims = passportClaimsFromForm(createDefaultPassportClaimsForm());
    const witness = buildPassportClaimsWitness(claims);

    expect(witness.minAgeProven).toBe(claims.minAgeProven);
    expect(witness.nationalityAlpha3Packed).toBe(claims.nationalityAlpha3Packed);
  });

  it("builds a committed passport witness with local blinds", () => {
    const claims = passportClaimsFromForm({
      nationalityAlpha3: "can",
      ageThreshold: "21",
      passportExpiryDate: "2030-01-02",
    });
    const witness = buildPassportCommittedClaimsWitness(claims, {
      nationalityBlind: "111",
      expiryBlind: 222n,
    });

    expect(witness).toEqual({
      minAgeProven: 21,
      nationalityAlpha3Packed: packAlpha3("CAN"),
      nationalityBlind: 111n,
      expiryTs: 1893628799n,
      expiryBlind: 222n,
    });
  });

  it("maps the zkPassport-style UI form into contract claim fields", () => {
    const claims = passportClaimsFromForm({
      nationalityAlpha3: "can",
      ageThreshold: "21",
      passportExpiryDate: "2030-01-02",
    });

    expect(claims.minAgeProven).toBe(21);
    expect(claims.expiryTs).toBe(1893628799n);
  });

  it("builds an age + nationality must-not-be policy and parses sponsor slot", () => {
    const policy = buildPassportPolicy({
      minimumAge: "21",
      nationalityMode: "must_not_be",
      nationalityAlpha3: "USA",
      sponsorSlot: "5",
    });

    expect(policy.credentialType).toBe(1);
    expect(policy.constraints).toHaveLength(2);
    expect(policy.constraints[0]).toEqual({
      claimId: ClaimId.AgeMinProven,
      op: ConstraintOp.Gte,
      value: 21n,
    });
    expect(policy.constraints[1]).toEqual({
      claimId: ClaimId.NationalityAlpha3,
      op: ConstraintOp.Neq,
      value: packAlpha3("USA"),
    });
    expect(readSponsorSlot({ minimumAge: "21", nationalityMode: "must_not_be", nationalityAlpha3: "USA", sponsorSlot: "5" })).toBe(5);
  });

  it("builds a nationality must-be policy when requested", () => {
    const policy = buildPassportPolicy({
      minimumAge: "21",
      nationalityMode: "must_be",
      nationalityAlpha3: "CAN",
      sponsorSlot: "0",
    });

    expect(policy.constraints).toHaveLength(2);
    expect(policy.constraints[1]).toEqual({
      claimId: ClaimId.NationalityAlpha3,
      op: ConstraintOp.Eq,
      value: packAlpha3("CAN"),
    });
  });

  it("omits nationality constraint when nationality mode is any", () => {
    const policy = buildPassportPolicy({
      minimumAge: "21",
      nationalityMode: "any",
      nationalityAlpha3: "",
      sponsorSlot: "0",
    });

    expect(policy.constraints).toHaveLength(1);
  });

  it("derives a deterministic ghost account preview from scoped unique identifier input", async () => {
    const preview = await deriveGhostAccountPreview({
      uniqueIdentifier: "12345",
      credentialType: 1,
    });

    expect(preview.uniqueIdentifier).toBe("12345");
    expect(preview.address).toBe("0xghostderived");
    expect(preview.material.secretHex).toBe(preview.material.saltHex);
    expect(typeof preview.rootCommitment).toBe("bigint");
    expect(ghostAccountAddressMock).toHaveBeenCalledTimes(1);
  });

  it("issues passport credentials using the uniqueIdentifier-derived ghost address", async () => {
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_ORCHESTRATOR_ADDRESS: "0xorchestrator",
      VITE_MAGNA_REQUIRE_REAL_SENDS: "true",
      VITE_MAGNA_ENABLE_DEV_ORCHESTRATOR: "true",
    });
    const walletMock = {
      getAccounts: vi.fn(async () => [
        {
          alias: "local-test-0",
          item: {
            toString: () => "0xorchestrator",
          },
        },
      ]),
    } as any;

    await issuePassportWithDevOrchestrator(
      env,
      {
        activeOwner: "0xactive",
        ghostUniqueIdentifier: "12345",
        claimsForm: createDefaultPassportClaimsForm(),
      },
      { wallet: walletMock },
    );

    expect(ghostAccountAddressMock).toHaveBeenCalled();
    expect(issuerContractMock.methods.register_credential).toHaveBeenCalledWith(
      "0xactive",
      "0xghostderived",
      expect.anything(),
      1,
      expect.anything(),
    );
  });

  it("declares required contract compatibility surface", () => {
    expect(CONTRACT_COMPATIBILITY_REQUIREMENTS.issuer).toContain("verify");
    expect(CONTRACT_COMPATIBILITY_REQUIREMENTS.issuer).toContain("verify_v2");
    expect(CONTRACT_COMPATIBILITY_REQUIREMENTS.issuer).toContain("verify_linked_v2");
    expect(CONTRACT_COMPATIBILITY_REQUIREMENTS.sponsor).toContain("sponsored_verify");
    expect(CONTRACT_COMPATIBILITY_REQUIREMENTS.rightsRegistry).toContain("get_remaining_verifies");
    expect(CONTRACT_COMPATIBILITY_REQUIREMENTS.rightsPurchase).toContain("purchase_rights_public");
  });

  it("rejects sponsored verify when sponsor is not configured", async () => {
    sponsorContracts.set("0xsponsor-a", buildSponsorMock("0xsponsor-a"));

    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xsponsor-a",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xsponsor-a",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    await expect(
      client.verifyPassportWithCompanySponsor(
        createDefaultPassportClaimsForm(),
        createDefaultPolicyForm(),
        { claimsHash: "1", hintedCredentialNote: {}, hintedStatusNote: {} },
        "0xsponsor-missing",
      ),
    ).rejects.toThrow("is not configured");
  });

  it("reports sponsor runtime authorization and per-sponsor compatibility", async () => {
    sponsorContracts.set("0xsponsor-a", buildSponsorMock("0xsponsor-a"));
    sponsorContracts.set("0xsponsor-b", buildSponsorMock("0xsponsor-b"));
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xsponsor-a,0xsponsor-b",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xsponsor-b",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    const matrix = client.getContractCompatibilityMatrix();
    expect(Object.keys(matrix.sponsorByAddress)).toEqual(["0xsponsor-a", "0xsponsor-b"]);
    expect(matrix.defaultSponsorAddress).toBe("0xsponsor-b");

    const statuses = await client.getSponsorRuntimeStatuses();
    expect(statuses).toEqual([
      expect.objectContaining({
        sponsorAddress: "0xsponsor-a",
        isIssuerAuthorized: true,
        isActiveDefault: false,
      }),
      expect.objectContaining({
        sponsorAddress: "0xsponsor-b",
        isIssuerAuthorized: false,
        isActiveDefault: true,
      }),
    ]);
  });

  it("uses sponsor payment method with additional scope for sponsored verify transactions", async () => {
    const sponsoredVerifySend = vi.fn(async () => ({ txHash: "0xsponsored" }));
    sponsorContracts.set("0xsponsor-a", {
      address: "0xsponsor-a",
      methods: {
        sponsored_verify: vi.fn(() => ({
          send: sponsoredVerifySend,
        })),
        sponsored_verify_instagram: vi.fn(),
        sponsored_verify_linked: vi.fn(),
        get_sponsored_verify_count: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: 0n })),
        })),
        get_max_fee_cap: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: "1000000000000000000000000000000" })),
        })),
      },
    });
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xsponsor-a",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xsponsor-a",
      VITE_MAGNA_REQUIRE_REAL_SENDS: "true",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    await client.verifyPassportWithCompanySponsor(
      createDefaultPassportClaimsForm(),
      createDefaultPolicyForm(),
      { claimsHash: "1", hintedCredentialNote: {}, hintedStatusNote: {} },
      "0xsponsor-a",
    );

    expect(sponsoredVerifySend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "0xuser",
        additionalScopes: ["0xsponsor-a"],
        fee: expect.objectContaining({
          estimateGas: true,
          estimatedGasPadding: 0.2,
        }),
      }),
    );
  });

  it("retries passport hint lookup while PXE catches up to a fresh issuance", async () => {
    let lookupAttempt = 0;
    issuerContractMock.methods.get_credential_hinted = vi.fn(() => ({
      simulate: vi.fn(async () => {
        lookupAttempt += 1;
        if (lookupAttempt === 1) {
          throw new Error("credential note not found");
        }
        return { result: { note: { claims_hash: 123n } } };
      }),
    }));
    issuerContractMock.methods.get_status_hinted = vi.fn(() => ({
      simulate: vi.fn(async () => ({ result: { note: { claims_hash: 123n } } })),
    }));

    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
    });
    const debugSyncState = {
      callCount: 0,
      async sync() {
        this.callCount += 1;
      },
    };
    const walletMock = {
      pxe: {
        debug: debugSyncState,
      },
      getContractMetadata: vi.fn(async () => ({
        instance: {},
        initializationStatus: "INITIALIZED",
        isContractPublished: true,
      })),
    } as any;
    const client = new MagnaBrowserClient(walletMock, env, "0xuser");

    const hints = await client.fetchPassportHints("0xuser", createDefaultPassportClaimsForm());

    expect(hints.hintedCredentialNote).toEqual({ note: { claims_hash: 123n } });
    expect(hints.hintedStatusNote).toEqual({ note: { claims_hash: 123n } });
    expect(debugSyncState.callCount).toBe(3);
    expect(issuerContractMock.methods.get_credential_hinted).toHaveBeenCalledTimes(2);
  });

  it("fetches rooted passport hints for the active-owner note families only", async () => {
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    const hints = await client.fetchRootedPassportHintsByClaimsHash("0xuser", "99", "123");

    expect(hints.rootCommitment).toBe("99");
    expect(hints.claimsHash).toBe("123");
    expect(hints.hintedRootStatusNote).toEqual({ note: { root_commitment: 99n } });
    expect(hints.hintedRootAuthorityNote).toEqual({ note: { root_commitment: 99n } });
    expect(hints.hintedLinkedRecoveryNote).toBeUndefined();
    expect(issuerContractMock.methods.get_linked_credential_hinted).toHaveBeenCalledWith("0xuser", expect.anything(), expect.anything());
    expect(issuerContractMock.methods.get_root_status_hinted).toHaveBeenCalledWith("0xuser", expect.anything());
    expect(issuerContractMock.methods.get_root_authority_hinted).toHaveBeenCalledWith(
      "0xuser",
      expect.anything(),
      expect.anything(),
    );
    expect(issuerContractMock.methods.get_linked_recovery_hinted).not.toHaveBeenCalled();
  });

  it("sends rooted v2 passport verify with committed witness fields", async () => {
    const verifyLinkedV2Send = vi.fn(async () => ({ txHash: "0xverify-linked-v2" }));
    issuerContractMock.methods.verify_linked_v2 = vi.fn(() => ({
      send: verifyLinkedV2Send,
    }));
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_REQUIRE_REAL_SENDS: "true",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    await client.verifyRootedPassportV2(
      {
        minAgeProven: 21,
        nationalityAlpha3Packed: packAlpha3("CAN"),
        nationalityBlind: 111n,
        expiryTs: 1_893_456_000n,
        expiryBlind: 222n,
      },
      createDefaultPolicyForm(),
      {
        claimsHash: "1",
        rootCommitment: "99",
        hintedCredentialNote: {},
        hintedStatusNote: {},
        hintedRootStatusNote: {},
        hintedRootAuthorityNote: {},
      },
    );

    expect(issuerContractMock.methods.verify_linked_v2).toHaveBeenCalledWith(
      expect.objectContaining({ credential_type: 1 }),
      {},
      {},
      {},
      {},
      expect.objectContaining({
        min_age_proven: 21,
        expiry_ts: 1_893_456_000n,
      }),
      0,
    );
    expect(verifyLinkedV2Send).toHaveBeenCalledWith({ from: "0xuser" });
  });

  it("retries root recovery hint lookup while PXE catches up to the ghost account", async () => {
    let lookupAttempt = 0;
    issuerContractMock.methods.get_root_recovery_hinted = vi.fn(() => ({
      simulate: vi.fn(async () => {
        lookupAttempt += 1;
        if (lookupAttempt === 1) {
          throw new Error("root recovery note not found");
        }
        return { result: { note: { root_commitment: 99n } } };
      }),
    }));

    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
    });
    const debugSyncState = {
      callCount: 0,
      async sync() {
        this.callCount += 1;
      },
    };
    const walletMock = {
      pxe: {
        debug: debugSyncState,
      },
      getContractMetadata: vi.fn(async () => ({
        instance: {},
        initializationStatus: "INITIALIZED",
        isContractPublished: true,
      })),
    } as any;
    const client = new MagnaBrowserClient(walletMock, env, "0xghost");

    const hint = await client.fetchRootRecoveryHint("0xghost", "99");

    expect(hint).toEqual({ note: { root_commitment: 99n } });
    expect(debugSyncState.callCount).toBe(3);
    expect(issuerContractMock.methods.get_root_recovery_hinted).toHaveBeenCalledTimes(2);
  });

  it("registers the orchestrator sender before discovering root recovery notes", async () => {
    const wallet = buildReadyWalletMock() as any;
    wallet.getAccounts = vi.fn(async () => []);
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_ORCHESTRATOR_ADDRESS: "0xorchestrator",
    });
    const client = new MagnaBrowserClient(wallet, env, "0xghost");

    await client.fetchRootRecoveryHint("0xghost", "99");

    expect(wallet.registerSender).toHaveBeenCalledWith("0xorchestrator", "magna-orchestrator");
  });

  it("sends rooted sponsored verify with sponsor additional scope", async () => {
    const rootedSponsoredSend = vi.fn(async () => ({ txHash: "0xrooted-sponsored" }));
    sponsorContracts.set("0xsponsor-a", {
      address: "0xsponsor-a",
      methods: {
        sponsored_verify: vi.fn(),
        sponsored_verify_instagram: vi.fn(),
        sponsored_verify_linked: vi.fn(() => ({
          send: rootedSponsoredSend,
        })),
        get_sponsored_verify_count: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: 0n })),
        })),
        get_max_fee_cap: vi.fn(() => ({
          simulate: vi.fn(async () => ({ result: "1000000000000000000000000000000" })),
        })),
      },
    });
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xsponsor-a",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xsponsor-a",
      VITE_MAGNA_REQUIRE_REAL_SENDS: "true",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    await client.verifyRootedPassportWithCompanySponsor(
      createDefaultPassportClaimsForm(),
      createDefaultPolicyForm(),
      {
        claimsHash: "1",
        rootCommitment: "99",
        hintedCredentialNote: {},
        hintedStatusNote: {},
        hintedRootStatusNote: {},
        hintedRootAuthorityNote: {},
      },
      "0xsponsor-a",
    );

    expect(rootedSponsoredSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "0xuser",
        additionalScopes: ["0xsponsor-a"],
      }),
    );
  });

  it("refreshes rooted authority from the configured orchestrator sender", async () => {
    const refreshSend = vi.fn(async () => ({ txHash: "0xrefresh" }));
    issuerContractMock.methods.refresh_root_authority = vi.fn(() => ({
      send: refreshSend,
    }));
    const wallet = buildReadyWalletMock() as any;
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_ORCHESTRATOR_ADDRESS: "0xorchestrator",
      VITE_MAGNA_REQUIRE_REAL_SENDS: "true",
    });
    const client = new MagnaBrowserClient(wallet, env, "0xuser");

    await client.refreshRootAuthority("0xghost", createDefaultPassportClaimsForm(), {
      claimsHash: "1",
      rootCommitment: "99",
      hintedCredentialNote: {},
      hintedStatusNote: {},
      hintedRootStatusNote: {},
      hintedRootAuthorityNote: {},
    });

    expect(wallet.registerSender).toHaveBeenCalledWith("0xorchestrator", "magna-orchestrator");
    expect(refreshSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "0xorchestrator",
      }),
    );
  });

  it("routes rights read and top-up by requested sponsor address", async () => {
    sponsorContracts.set("0xsponsor-a", buildSponsorMock("0xsponsor-a"));
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xsponsor-a",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xsponsor-a",
      VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS: "0xrights-registry",
      VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS: "0xrights-purchase",
      VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS: "0xpayment-token",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    const snapshot = await client.readSponsorRightsSnapshot("0xsponsor-a");
    expect(snapshot.sponsorAddress).toBe("0xsponsor-a");
    expect(rightsRegistryMock.methods.get_remaining_verifies).toHaveBeenCalledWith("0xsponsor-a");
    expect(snapshot.remainingVerifies).toBe(11n);
    expect(snapshot.consumedVerifies).toBe(4n);
    expect(snapshot.lastCreditNonce).toBe(9n);
    expect(snapshot.latestPackageId).toBe(3n);
    expect(snapshot.nextPurchaseId).toBe(42n);
    expect(snapshot.l2PricePerVerify).toBe(150000n);
    expect(snapshot.paymentTokenAddress).toBe(VALID_PAYMENT_TOKEN);
    expect(snapshot.purchaseTreasuryAddress).toBe(VALID_TREASURY);

    const topUp = await client.topUpSponsorRightsFromL2Payment({
      sponsorAddress: "0xsponsor-a",
      rightsAmount: "2",
      packageId: "7",
    });
    expect(topUp.rightsAmount).toBe(2n);
    expect(rightsPurchaseMock.methods.purchase_rights_public).toHaveBeenCalledWith(
      "0xsponsor-a",
      2n,
      7n,
      expect.anything(),
    );
    expect(authwitCreateMock).toHaveBeenCalled();
  });

  it("waits until the rights snapshot reflects the recorded purchase id", async () => {
    let nextPurchaseIdReadCount = 0;
    rightsRegistryMock.methods.get_remaining_verifies = vi.fn(() => ({
      simulate: vi.fn(async () => ({ result: nextPurchaseIdReadCount === 0 ? "11" : "12" })),
    }));
    rightsPurchaseMock.methods.get_next_purchase_id = vi.fn(() => ({
      simulate: vi.fn(async () => {
        nextPurchaseIdReadCount += 1;
        return { result: { value: nextPurchaseIdReadCount === 1 ? 42n : 43n } };
      }),
    }));
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
      VITE_MAGNA_COMPANY_SPONSOR_ADDRESSES: "0xsponsor-a",
      VITE_MAGNA_ACTIVE_COMPANY_SPONSOR_ADDRESS: "0xsponsor-a",
      VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS: "0xrights-registry",
      VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS: "0xrights-purchase",
      VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS: "0xpayment-token",
    });
    const client = new MagnaBrowserClient(buildReadyWalletMock() as any, env, "0xuser");

    const snapshot = await client.waitForSponsorRightsSnapshotPurchaseSync("0xsponsor-a", 42n);

    expect(snapshot.nextPurchaseId).toBe(43n);
    expect(snapshot.remainingVerifies).toBe(12n);
  });

  it("reports undeployed counterfactual accounts before hinted-note reads", async () => {
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
    });
    const client = new MagnaBrowserClient(
      buildReadyWalletMock({
        instance: undefined,
        isContractPublished: false,
        initializationStatus: "UNKNOWN",
      }) as any,
      env,
      "0xcounterfactual",
    );

    await expect(client.fetchPassportHints("0xcounterfactual", createDefaultPassportClaimsForm())).rejects.toThrow(
      "not deployed and initialized",
    );
  });

  it("accepts initialized accounts even when contract publication metadata is false", async () => {
    const env = getAppEnv({
      VITE_MAGNA_ISSUER_ADDRESS: "0xissuer",
    });
    const client = new MagnaBrowserClient(
      buildReadyWalletMock({
        isContractPublished: false,
        initializationStatus: "INITIALIZED",
      }) as any,
      env,
      "0xinitialized",
    );

    issuerContractMock.methods.get_credential_hinted = vi.fn(() => ({
      simulate: vi.fn(async () => ({ result: { note: "credential" } })),
    }));
    issuerContractMock.methods.get_status_hinted = vi.fn(() => ({
      simulate: vi.fn(async () => ({ result: { note: "status" } })),
    }));

    const hints = await client.fetchPassportHints("0xinitialized", createDefaultPassportClaimsForm());

    expect(hints.hintedCredentialNote).toEqual({ note: "credential" });
    expect(hints.hintedStatusNote).toEqual({ note: "status" });
  });
});
