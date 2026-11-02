import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MagnaVerificationEngine } from "./verification-engine.js";
import { computeInstagramClaimsHash, computePassportClaimsHash, poseidon2FieldHasher } from "./encoding.js";
import { ClaimId, ConstraintOp, CredentialType } from "@magna-protocol/core";
import { normalizePolicy } from "@magna-protocol/core";
import { Fr } from "@aztec-labs/aztec.js/fields";

describe("MagnaVerificationEngine login flows", () => {
  function contractPolicy(policy: Parameters<typeof normalizePolicy>[0]) {
    const normalized = normalizePolicy(policy);
    return {
      credential_type: normalized.credentialType,
      constraints: normalized.constraints.map(constraint => ({
        claim_id: constraint.claimId,
        op: constraint.op,
        value: constraint.value,
      })),
    };
  }

  it("registerRoot forwards the root registration call shape", async () => {
    let capturedArgs: unknown[] | undefined;
    let capturedSendOptions: { from: string; fee?: unknown } | undefined;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          register_root: (...args: unknown[]) => {
            capturedArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedSendOptions = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
    });

    await client.registerRoot({
      activeOwner: "0x2222222222222222222222222222222222222222",
      ghostOwner: "0x3333333333333333333333333333333333333333",
      rootCommitment: 999n,
    });

    assert.deepEqual(capturedArgs, [
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      999n,
    ]);
    assert.deepEqual(capturedSendOptions, {
      from: "0x1111111111111111111111111111111111111111",
    });
  });

  it("loginWithMagna forwards the normalized verify call shape", async () => {
    const hintedCredentialNote = { id: "credential-note" };
    const hintedStatusNote = { id: "status-note" };
    const policy = {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    };

    let capturedArgs: unknown[] | undefined;
    let capturedSendOptions: { from: string; fee?: unknown } | undefined;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          verify: (...args: unknown[]) => {
            capturedArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedSendOptions = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
    });

    await client.loginWithMagna(
      {
        policy,
        hintedCredentialNote,
        hintedStatusNote,
        claimsWitness: {
          minAgeProven: 21,
          nationalityAlpha3Packed: 0x43414en,
        },
      },
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );

    assert.deepEqual(capturedArgs, [
      contractPolicy(policy),
      hintedCredentialNote,
      hintedStatusNote,
      21,
      0x43414en,
      0,
    ]);
    assert.deepEqual(capturedSendOptions, {
      from: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });
  });

  it("loginWithLinkedMagna forwards the normalized verify_linked call shape", async () => {
    const hintedRootStatusNote = { id: "root-status-note" };
    const hintedRootAuthorityNote = { id: "root-authority-note" };
    const hintedCredentialNote = { id: "linked-credential-note" };
    const hintedStatusNote = { id: "linked-status-note" };
    const policy = {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    };

    let capturedArgs: unknown[] | undefined;
    let capturedSendOptions: { from: string; fee?: unknown } | undefined;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          verify_linked: (...args: unknown[]) => {
            capturedArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedSendOptions = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
    });

    await client.loginWithLinkedMagna(
      {
        policy,
        hintedRootStatusNote,
        hintedRootAuthorityNote,
        hintedCredentialNote,
        hintedStatusNote,
        claimsWitness: {
          minAgeProven: 21,
          nationalityAlpha3Packed: 0x43414en,
        },
      },
      "0x2222222222222222222222222222222222222222",
    );

    assert.deepEqual(capturedArgs, [
      contractPolicy(policy),
      hintedRootStatusNote,
      hintedRootAuthorityNote,
      hintedCredentialNote,
      hintedStatusNote,
      21,
      0x43414en,
      0,
    ]);
    assert.deepEqual(capturedSendOptions, {
      from: "0x2222222222222222222222222222222222222222",
    });
  });

  it("loginWithMagnaV2 forwards the committed passport witness", async () => {
    const hintedCredentialNote = { id: "credential-note" };
    const hintedStatusNote = { id: "status-note" };
    const policy = {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    };

    let capturedArgs: unknown[] | undefined;
    let capturedSendOptions: { from: string; fee?: unknown } | undefined;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          verify_v2: (...args: unknown[]) => {
            capturedArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedSendOptions = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
    });

    await client.loginWithMagnaV2(
      {
        policy,
        hintedCredentialNote,
        hintedStatusNote,
        claimsWitness: {
          minAgeProven: 21,
          nationalityAlpha3Packed: 0x43414en,
          nationalityBlind: 111n,
          expiryTs: 1_893_456_000n,
          expiryBlind: 222n,
        },
      },
      "0x2222222222222222222222222222222222222222",
    );

    assert.deepEqual(capturedArgs, [
      contractPolicy(policy),
      hintedCredentialNote,
      hintedStatusNote,
      {
        min_age_proven: 21,
        nationality_alpha3_packed: 0x43414en,
        nationality_blind: 111n,
        expiry_ts: 1_893_456_000n,
        expiry_blind: 222n,
      },
      0,
    ]);
    assert.deepEqual(capturedSendOptions, {
      from: "0x2222222222222222222222222222222222222222",
    });
  });

  it("loginWithLinkedMagnaV2 forwards rooted hints and committed witness", async () => {
    const hintedRootStatusNote = { id: "root-status-note" };
    const hintedRootAuthorityNote = { id: "root-authority-note" };
    const hintedCredentialNote = { id: "linked-credential-note" };
    const hintedStatusNote = { id: "linked-status-note" };
    const policy = {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    };

    let capturedArgs: unknown[] | undefined;
    let capturedSendOptions: { from: string; fee?: unknown } | undefined;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          verify_linked_v2: (...args: unknown[]) => {
            capturedArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedSendOptions = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
    });

    await client.loginWithLinkedMagnaV2(
      {
        policy,
        hintedRootStatusNote,
        hintedRootAuthorityNote,
        hintedCredentialNote,
        hintedStatusNote,
        claimsWitness: {
          minAgeProven: 21,
          nationalityAlpha3Packed: 0x43414en,
          nationalityBlind: 111n,
          expiryTs: 1_893_456_000n,
          expiryBlind: 222n,
        },
      },
      "0x2222222222222222222222222222222222222222",
    );

    assert.deepEqual(capturedArgs, [
      contractPolicy(policy),
      hintedRootStatusNote,
      hintedRootAuthorityNote,
      hintedCredentialNote,
      hintedStatusNote,
      {
        min_age_proven: 21,
        nationality_alpha3_packed: 0x43414en,
        nationality_blind: 111n,
        expiry_ts: 1_893_456_000n,
        expiry_blind: 222n,
      },
      0,
    ]);
    assert.deepEqual(capturedSendOptions, {
      from: "0x2222222222222222222222222222222222222222",
    });
  });

  it("loginWithLinkedMagnaThroughConsumer forwards rooted hints to the consumer gateway", async () => {
    const hintedRootStatusNote = { id: "root-status-note" };
    const hintedRootAuthorityNote = { id: "root-authority-note" };
    const hintedCredentialNote = { id: "linked-credential-note" };
    const hintedStatusNote = { id: "linked-status-note" };
    const policy = {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    };

    let capturedArgs: unknown[] | undefined;
    let capturedSendOptions: { from: string; fee?: unknown } | undefined;
    const consumer = {
      methods: {
        login_with_linked_magna: (...args: unknown[]) => {
          capturedArgs = args;
          return {
            send: async (opts: { from: string; fee?: unknown }) => {
              capturedSendOptions = opts;
              return { ok: true };
            },
          };
        },
      },
    };

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          get_linked_credential_hinted: () => ({
            simulate: async () => hintedCredentialNote,
          }),
          get_linked_status_hinted: () => ({
            simulate: async () => hintedStatusNote,
          }),
          get_root_status_hinted: () => ({
            simulate: async () => hintedRootStatusNote,
          }),
          get_root_authority_hinted: () => ({
            simulate: async () => hintedRootAuthorityNote,
          }),
        },
      } as never,
      consumerContractFactory: () => consumer as never,
    });

    await client.loginWithLinkedMagnaThroughConsumer({
      policy,
      consumerGatewayAddress: "0xconsumer",
      rootCommitment: "99",
      claimsHash: "123",
      claimsWitness: {
        minAgeProven: 21,
        nationalityAlpha3Packed: 0x43414en,
      },
      from: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    assert.deepEqual(capturedArgs, [
      {
        credential_type: normalizePolicy(policy).credentialType,
        constraints: normalizePolicy(policy).constraints.map(constraint => ({
          claim_id: constraint.claimId,
          op: constraint.op,
          value: constraint.value,
        })),
      },
      hintedRootStatusNote,
      hintedRootAuthorityNote,
      hintedCredentialNote,
      hintedStatusNote,
      21,
      0x43414en,
      0,
    ]);
    assert.deepEqual(capturedSendOptions, {
      from: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });
  });

  it("loginWithLinkedMagnaV2ThroughConsumer forwards committed witness to the consumer gateway", async () => {
    const hintedRootStatusNote = { id: "root-status-note" };
    const hintedRootAuthorityNote = { id: "root-authority-note" };
    const hintedCredentialNote = { id: "linked-credential-note" };
    const hintedStatusNote = { id: "linked-status-note" };
    const policy = {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    };

    let capturedArgs: unknown[] | undefined;
    const consumer = {
      methods: {
        login_with_linked_magna_v2: (...args: unknown[]) => {
          capturedArgs = args;
          return {
            send: async () => ({ ok: true }),
          };
        },
      },
    };

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          get_linked_credential_hinted: () => ({
            simulate: async () => hintedCredentialNote,
          }),
          get_linked_status_hinted: () => ({
            simulate: async () => hintedStatusNote,
          }),
          get_root_status_hinted: () => ({
            simulate: async () => hintedRootStatusNote,
          }),
          get_root_authority_hinted: () => ({
            simulate: async () => hintedRootAuthorityNote,
          }),
        },
      } as never,
      consumerContractFactory: () => consumer as never,
    });

    await client.loginWithLinkedMagnaV2ThroughConsumer({
      policy,
      consumerGatewayAddress: "0xconsumer",
      rootCommitment: "99",
      claimsHash: "123",
      claimsWitness: {
        minAgeProven: 21,
        nationalityAlpha3Packed: 0x43414en,
        nationalityBlind: 111n,
        expiryTs: 1_893_456_000n,
        expiryBlind: 222n,
      },
      from: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    assert.deepEqual(capturedArgs, [
      contractPolicy(policy),
      hintedRootStatusNote,
      hintedRootAuthorityNote,
      hintedCredentialNote,
      hintedStatusNote,
      {
        min_age_proven: 21,
        nationality_alpha3_packed: 0x43414en,
        nationality_blind: 111n,
        expiry_ts: 1_893_456_000n,
        expiry_blind: 222n,
      },
      0,
    ]);
  });

  it("loginWithLinkedMagnaThroughConsumer preserves simulate this binding during hint discovery", async () => {
    const hintedRootStatusNote = { id: "root-status-note" };
    const hintedRootAuthorityNote = { id: "root-authority-note" };
    const hintedCredentialNote = { id: "linked-credential-note" };
    const hintedStatusNote = { id: "linked-status-note" };
    let sent = false;

    const boundSensitiveHintCall = (value: unknown) => ({
      marker: "aztec-contract-function-interaction",
      value,
      async simulate(this: { marker: string; value: unknown }) {
        assert.equal(this.marker, "aztec-contract-function-interaction");
        return this.value;
      },
    });

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          get_linked_credential_hinted: () => boundSensitiveHintCall(hintedCredentialNote),
          get_linked_status_hinted: () => boundSensitiveHintCall(hintedStatusNote),
          get_root_status_hinted: () => boundSensitiveHintCall(hintedRootStatusNote),
          get_root_authority_hinted: () => boundSensitiveHintCall(hintedRootAuthorityNote),
        },
      } as never,
      consumerContractFactory: () => ({
        methods: {
          login_with_linked_magna: (...args: unknown[]) => {
            assert.deepEqual(args.slice(1, 5), [
              hintedRootStatusNote,
              hintedRootAuthorityNote,
              hintedCredentialNote,
              hintedStatusNote,
            ]);
            return {
              send: async () => {
                sent = true;
                return { ok: true };
              },
            };
          },
        },
      }) as never,
    });

    await client.loginWithLinkedMagnaThroughConsumer({
      policy: {
        credentialType: CredentialType.Passport,
        constraints: [],
      },
      consumerGatewayAddress: "0xconsumer",
      rootCommitment: "99",
      claimsHash: "123",
      claimsWitness: {
        minAgeProven: 21,
        nationalityAlpha3Packed: 0x43414en,
      },
      from: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    assert.equal(sent, true);
  });

  it("loginWithLinkedMagnaThroughConsumer rebuilds and retries transient Aztec tx expiration failures", async () => {
    const hintedRootStatusNote = { id: "root-status-note" };
    const hintedRootAuthorityNote = { id: "root-authority-note" };
    const hintedCredentialNote = { id: "linked-credential-note" };
    const hintedStatusNote = { id: "linked-status-note" };
    let loginInteractionBuilds = 0;
    let sendAttempts = 0;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          get_linked_credential_hinted: () => ({
            simulate: async () => hintedCredentialNote,
          }),
          get_linked_status_hinted: () => ({
            simulate: async () => hintedStatusNote,
          }),
          get_root_status_hinted: () => ({
            simulate: async () => hintedRootStatusNote,
          }),
          get_root_authority_hinted: () => ({
            simulate: async () => hintedRootAuthorityNote,
          }),
        },
      } as never,
      consumerContractFactory: () => ({
        methods: {
          login_with_linked_magna: () => {
            loginInteractionBuilds += 1;
            return {
              send: async () => {
                sendAttempts += 1;
                if (sendAttempts === 1) {
                  throw new Error("Invalid tx: Invalid expiration timestamp");
                }
                return { ok: true };
              },
            };
          },
        },
      }) as never,
    });

    await client.loginWithLinkedMagnaThroughConsumer({
      policy: {
        credentialType: CredentialType.Passport,
        constraints: [],
      },
      consumerGatewayAddress: "0xconsumer",
      rootCommitment: "99",
      claimsHash: "123",
      claimsWitness: {
        minAgeProven: 21,
        nationalityAlpha3Packed: 0x43414en,
      },
      from: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    assert.equal(loginInteractionBuilds, 2);
    assert.equal(sendAttempts, 2);
  });

  it("loginWithLinkedMagnaThroughConsumer syncs and retries pending rooted hint discovery", async () => {
    const hintedRootStatusNote = { id: "root-status-note" };
    const hintedRootAuthorityNote = { id: "root-authority-note" };
    const hintedCredentialNote = { id: "linked-credential-note" };
    const hintedStatusNote = { id: "linked-status-note" };
    let linkedCredentialAttempts = 0;
    let syncAttempts = 0;
    let sent = false;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      syncBeforeHintLookup: async () => {
        syncAttempts += 1;
      },
      hintLookupRetryDelayMs: 0,
      issuerContract: {
        methods: {
          get_linked_credential_hinted: () => ({
            simulate: async () => {
              linkedCredentialAttempts += 1;
              if (linkedCredentialAttempts === 1) {
                throw new Error("linked credential note not found");
              }
              return hintedCredentialNote;
            },
          }),
          get_linked_status_hinted: () => ({
            simulate: async () => hintedStatusNote,
          }),
          get_root_status_hinted: () => ({
            simulate: async () => hintedRootStatusNote,
          }),
          get_root_authority_hinted: () => ({
            simulate: async () => hintedRootAuthorityNote,
          }),
        },
      } as never,
      consumerContractFactory: () => ({
        methods: {
          login_with_linked_magna: () => ({
            send: async () => {
              sent = true;
              return { ok: true };
            },
          }),
        },
      }) as never,
    });

    await client.loginWithLinkedMagnaThroughConsumer({
      policy: {
        credentialType: CredentialType.Passport,
        constraints: [],
      },
      consumerGatewayAddress: "0xconsumer",
      rootCommitment: "99",
      claimsHash: "123",
      claimsWitness: {
        minAgeProven: 21,
        nationalityAlpha3Packed: 0x43414en,
      },
      from: "0x2222222222222222222222222222222222222222222222222222222222222222",
    });

    assert.equal(linkedCredentialAttempts, 2);
    assert.equal(syncAttempts, 2);
    assert.equal(sent, true);
  });

  it("loginWithCompanySponsor rejects when companySponsorContract is missing", async () => {
    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: { methods: {} } as never,
    });

    await assert.rejects(
      client.loginWithCompanySponsor(
        {
          policy: {
            credentialType: CredentialType.Passport,
            constraints: [],
          },
          hintedCredentialNote: { id: "credential" },
          hintedStatusNote: { id: "status" },
          claimsWitness: {
            minAgeProven: 21,
            nationalityAlpha3Packed: 0x43414en,
          },
        },
        "0x2222222222222222222222222222222222222222",
      ),
      /companySponsorContract is required for sponsored Magna login/,
    );
  });

  it("loginWithCompanySponsor rejects when companySponsorContract.address is missing", async () => {
    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: { methods: {} } as never,
      companySponsorContract: {
        methods: {
          sponsored_verify: () => ({
            send: async () => ({ ok: true }),
          }),
        },
      } as never,
    });

    await assert.rejects(
      client.loginWithCompanySponsor(
        {
          policy: {
            credentialType: CredentialType.Passport,
            constraints: [],
          },
          hintedCredentialNote: { id: "credential" },
          hintedStatusNote: { id: "status" },
          claimsWitness: {
            minAgeProven: 21,
            nationalityAlpha3Packed: 0x43414en,
          },
        },
        "0x2222222222222222222222222222222222222222",
      ),
      /companySponsorContract\.address is required for sponsored Magna login/,
    );
  });

  it("loginWithCompanySponsor uses first companySponsorContracts entry when primary is not set", async () => {
    let capturedSendOptions: { from: { toString(): string }; fee?: unknown; additionalScopes?: unknown[] } | undefined;
    const sponsorA = {
      address: { toString: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      methods: {
        sponsored_verify: () => ({
          send: async (opts: { from: { toString(): string }; fee?: unknown; additionalScopes?: unknown[] }) => {
            capturedSendOptions = opts;
            return { ok: true };
          },
        }),
      },
    };
    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        address: { toString: () => "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        methods: {},
      } as never,
      companySponsorContracts: [sponsorA as never],
    });

    await client.loginWithCompanySponsor(
      {
        policy: {
          credentialType: CredentialType.Passport,
          constraints: [],
        },
        hintedCredentialNote: { id: "credential" },
        hintedStatusNote: { id: "status" },
        claimsWitness: {
          minAgeProven: 21,
          nationalityAlpha3Packed: 0x43414en,
        },
      },
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    );
    assert.equal(capturedSendOptions?.from.toString(), "0x2222222222222222222222222222222222222222222222222222222222222222");
    assert.deepEqual(capturedSendOptions?.additionalScopes?.map(scope => String((scope as { toString(): string }).toString())), [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
  });

  it("loginWithCompanySponsor supports explicit sponsor override", async () => {
    let calledSponsor = "";
    const sponsorA = {
      address: { toString: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      methods: {
        sponsored_verify: () => ({
          send: async () => {
            calledSponsor = "A";
            return { ok: true };
          },
        }),
      },
    };
    const sponsorB = {
      address: { toString: () => "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      methods: {
        sponsored_verify: () => ({
          send: async () => {
            calledSponsor = "B";
            return { ok: true };
          },
        }),
      },
    };
    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: { methods: {} } as never,
      companySponsorContract: sponsorA as never,
    });

    await client.loginWithCompanySponsor(
      {
        policy: {
          credentialType: CredentialType.Passport,
          constraints: [],
        },
        hintedCredentialNote: { id: "credential" },
        hintedStatusNote: { id: "status" },
        claimsWitness: {
          minAgeProven: 21,
          nationalityAlpha3Packed: 0x43414en,
        },
      },
      "0x2222222222222222222222222222222222222222222222222222222222222222",
      sponsorB as never,
    );
    assert.equal(calledSponsor, "B");
  });

  it("recoverRoot and revokeLinkedCredential forward the V3 root-linked recovery call shapes", async () => {
    let capturedRecoverRootArgs: unknown[] | undefined;
    let capturedRecoverRootSend: { from: string; fee?: unknown } | undefined;
    let capturedRevokeArgs: unknown[] | undefined;
    let capturedRevokeSend: { from: string; fee?: unknown } | undefined;

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          recover_root_v3: (...args: unknown[]) => {
            capturedRecoverRootArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedRecoverRootSend = opts;
                return { ok: true };
              },
            };
          },
          revoke_linked_credential: (...args: unknown[]) => {
            capturedRevokeArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedRevokeSend = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
    });

    await client.recoverRoot(
      {
        hintedRootRecoveryNote: { id: "root-recovery-note" },
        destination: "0x4444444444444444444444444444444444444444",
        authorizationNonce: 123n,
        claimsHash: 456n,
        credentialValidUntil: 789n,
        messageSecret: 101n,
        messageLeafIndex: 202n,
      },
      "0x3333333333333333333333333333333333333333",
    );
    await client.revokeLinkedCredential(
      {
        hintedLinkedRecoveryNote: { id: "linked-recovery-note" },
      },
      "0x3333333333333333333333333333333333333333",
    );

    assert.deepEqual(capturedRecoverRootArgs, [
      { id: "root-recovery-note" },
      "0x4444444444444444444444444444444444444444",
      new Fr(123n),
      new Fr(456n),
      789n,
      new Fr(101n),
      new Fr(202n),
    ]);
    assert.deepEqual(capturedRecoverRootSend, {
      from: "0x3333333333333333333333333333333333333333",
    });
    assert.deepEqual(capturedRevokeArgs, [
      { id: "linked-recovery-note" },
    ]);
    assert.deepEqual(capturedRevokeSend, {
      from: "0x3333333333333333333333333333333333333333",
    });
  });

  it("registerRootedPassport and refreshRootAuthority forward rooted authority call shapes", async () => {
    let capturedRegisterArgs: unknown[] | undefined;
    let capturedRegisterSend: { from: string; fee?: unknown } | undefined;
    let capturedRefreshArgs: unknown[] | undefined;
    let capturedRefreshSend: { from: string; fee?: unknown } | undefined;

    const claims = {
      schemaVersion: 1,
      credentialType: CredentialType.Passport as const,
      nationalityAlpha3Packed: 0x43414en,
      minAgeProven: 21,
      expiryTs: 1_893_456_000n,
    };

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          register_rooted_passport: (...args: unknown[]) => {
            capturedRegisterArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedRegisterSend = opts;
                return { ok: true };
              },
            };
          },
          refresh_root_authority: (...args: unknown[]) => {
            capturedRefreshArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedRefreshSend = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
      hasher: poseidon2FieldHasher,
    });

    await client.registerRootedPassport({
      activeOwner: "0x2222222222222222222222222222222222222222",
      ghostOwner: "0x3333333333333333333333333333333333333333",
      rootCommitment: 999n,
      claims,
    });

    await client.refreshRootAuthority({
      ghostOwner: "0x3333333333333333333333333333333333333333",
      hintedRootStatusNote: { id: "root-status" },
      hintedRootAuthorityNote: { id: "root-authority" },
      claims: {
        ...claims,
        minAgeProven: 22,
      },
    });

    assert.deepEqual(capturedRegisterArgs, [
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      999n,
      computePassportClaimsHash(claims, poseidon2FieldHasher),
      1_893_456_000n,
    ]);
    assert.deepEqual(capturedRegisterSend, {
      from: "0x1111111111111111111111111111111111111111",
    });
    assert.deepEqual(capturedRefreshArgs, [
      "0x3333333333333333333333333333333333333333",
      { id: "root-status" },
      { id: "root-authority" },
      computePassportClaimsHash(
        {
          ...claims,
          minAgeProven: 22,
        },
        poseidon2FieldHasher,
      ),
      1_893_456_000n,
    ]);
    assert.deepEqual(capturedRefreshSend, {
      from: "0x1111111111111111111111111111111111111111",
    });
  });

  it("registerInstagram and loginWithInstagram forward the instagram call shapes", async () => {
    let capturedRegisterArgs: unknown[] | undefined;
    let capturedRegisterSend: { from: string; fee?: unknown } | undefined;
    let capturedVerifyArgs: unknown[] | undefined;
    let capturedVerifySend: { from: string; fee?: unknown } | undefined;

    const instagramClaims = {
      schemaVersion: 2,
      credentialType: CredentialType.Instagram as const,
      handleCommitment: 777777n,
      expiryTs: 1_893_456_000n,
    };

    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          register_credential: (...args: unknown[]) => {
            capturedRegisterArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedRegisterSend = opts;
                return { ok: true };
              },
            };
          },
          verify_instagram: (...args: unknown[]) => {
            capturedVerifyArgs = args;
            return {
              send: async (opts: { from: string; fee?: unknown }) => {
                capturedVerifySend = opts;
                return { ok: true };
              },
            };
          },
        },
      } as never,
    });

    await client.registerInstagram({
      activeOwner: "0x2222222222222222222222222222222222222222",
      ghostOwner: "0x3333333333333333333333333333333333333333",
      claims: instagramClaims,
    });

    await client.loginWithInstagram(
      {
        policy: {
          credentialType: CredentialType.Instagram,
          constraints: [
            {
              claimId: ClaimId.InstagramHandleHash,
              op: ConstraintOp.Eq,
              value: 123456n,
            },
          ],
        },
        hintedCredentialNote: { id: "instagram-credential" },
        hintedStatusNote: { id: "instagram-status" },
        claimsWitness: {
          handleHash: 123456n,
          handleBlind: 654321n,
        },
      },
      "0x4444444444444444444444444444444444444444",
    );

    assert.deepEqual(capturedRegisterArgs, [
      "0x2222222222222222222222222222222222222222",
      "0x3333333333333333333333333333333333333333",
      computeInstagramClaimsHash(instagramClaims),
      CredentialType.Instagram,
      1_893_456_000n,
    ]);
    assert.deepEqual(capturedRegisterSend, {
      from: "0x1111111111111111111111111111111111111111",
    });
    assert.deepEqual(capturedVerifyArgs, [
      contractPolicy({
        credentialType: CredentialType.Instagram,
        constraints: [
          {
            claimId: ClaimId.InstagramHandleHash,
            op: ConstraintOp.Eq,
            value: 123456n,
          },
        ],
      }),
      { id: "instagram-credential" },
      { id: "instagram-status" },
      { handle_hash: 123456n, handle_blind: 654321n },
      0,
    ]);
    assert.deepEqual(capturedVerifySend, {
      from: "0x4444444444444444444444444444444444444444",
    });
  });


  it("findCredentialHints reads live hinted issuer notes", async () => {
    const hintedCredentialNote = { id: "credential" };
    const hintedStatusNote = { id: "status" };
    const simulateFrom: unknown[] = [];
    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111111111111111111111111111",
      issuerContract: {
        methods: {
          get_credential_hinted: () => ({
            send: async () => ({ ok: true }),
            simulate: async (opts: { from: unknown }) => {
              simulateFrom.push(opts.from);
              return { result: hintedCredentialNote };
            },
          }),
          get_status_hinted: () => ({
            send: async () => ({ ok: true }),
            simulate: async (opts: { from: unknown }) => {
              simulateFrom.push(opts.from);
              return hintedStatusNote;
            },
          }),
        },
      } as never,
    });

    const owner = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const hints = await client.findCredentialHints(owner, 123n);
    assert.deepEqual(hints, {
      claimsHash: "123",
      hintedCredentialNote,
      hintedStatusNote,
    });
    assert.equal(simulateFrom.length, 2);
  });

  it("runVerification routes instagram sponsored checks through the sponsor contract", async () => {
    let sponsorCalled = false;
    const sponsor = {
      address: { toString: () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      methods: {
        sponsored_verify_instagram: () => ({
          send: async () => {
            sponsorCalled = true;
            return { ok: true };
          },
        }),
      },
    };
    const client = new MagnaVerificationEngine({
      orchestratorAddress: "0x1111111111111111111111111111111111111111111111111111111111111111",
      issuerContract: { methods: {} } as never,
      companySponsorContracts: [sponsor as never],
    });

    await client.runVerification(
      {
        policy: { credentialType: CredentialType.Instagram, constraints: [] },
        hintedCredentialNote: { id: "credential" },
        hintedStatusNote: { id: "status" },
        claimsWitness: { handleHash: 99n, handleBlind: 100n },
      },
      "0x2222222222222222222222222222222222222222222222222222222222222222",
      { sponsored: true },
    );

    assert.equal(sponsorCalled, true);
  });

});

describe('Instagram holder lifecycle routing', () => {
  const owner = `0x${'11'.repeat(32)}`;
  it('registerLinkedInstagram issues standalone then converts as holder', async () => {
    const steps: string[] = [];
    let issued = false;
    const methods: Record<string, any> = {
      register_credential: () => ({ send: async () => { issued = true; steps.push('issue'); return { txHash: 'issue' }; } }),
      get_linked_credential_hinted: () => ({ simulate: async () => { throw new Error('linked credential note not found'); } }),
      get_credential_hinted: () => ({ simulate: async () => { if (!issued) throw new Error('credential note not found'); return 'credential'; } }),
      get_status_hinted: () => ({ simulate: async () => 'status' }),
      get_root_status_hinted: () => ({ simulate: async () => 'root' }),
      link_credential_to_root: (...args: unknown[]) => ({ send: async (opts: any) => {
        assert.deepEqual(args, ['credential', 'status', 'root']); assert.equal(opts.from, owner);
        steps.push('link'); return { txHash: 'linked' };
      } }),
    };
    const engine = new MagnaVerificationEngine({ orchestratorAddress: owner, issuerContract: { methods, wallet: { registerSender: async () => { steps.push('sender'); } } } as never });
    const result = await engine.registerLinkedInstagram({ activeOwner: owner, ghostOwner: owner, rootCommitment: 99n,
      claims: { schemaVersion: 1, credentialType: CredentialType.Instagram, handleCommitment: 123n, expiryTs: 2000n } });
    assert.deepEqual(steps, ['sender', 'issue', 'link']);
    assert.equal((result as any).txHash, 'linked');
  });
  it('runVerification routes rooted Instagram through linked direct and sponsored methods', async () => {
    const calls: string[] = [];
    const method = (name: string) => (...args: unknown[]) => ({ send: async () => { calls.push(name); assert.equal(args.length, 6); return {}; } });
    const engine = new MagnaVerificationEngine({ orchestratorAddress: owner,
      issuerContract: { methods: { verify_linked_instagram: method('direct') } } as never,
      companySponsorContract: { address: { toString: () => owner }, methods: { sponsored_verify_linked_instagram: method('sponsor') } } as never });
    const input = { policy: { credentialType: CredentialType.Instagram, constraints: [] }, hintedRootStatusNote: 'root', hintedCredentialNote: 'credential', hintedStatusNote: 'status', claimsWitness: { handleHash: 1n, handleBlind: 2n } };
    await engine.runVerification(input, owner);
    await engine.runVerification(input, owner, { sponsored: true });
    assert.deepEqual(calls, ['direct', 'sponsor']);
  });
});

it('runVerification refuses rooted Instagram metadata without a root status hint', async () => {
  const engine = new MagnaVerificationEngine({ orchestratorAddress: 'unused', issuerContract: { methods: {
    verify_instagram: () => ({ send: async () => ({ txHash: 'downgrade' }) }),
  } } as never });
  await assert.rejects(() => engine.runVerification({ mode: 'rooted', rootCommitment: '99',
    policy: { credentialType: CredentialType.Instagram, constraints: [] }, hintedCredentialNote: {}, hintedStatusNote: {},
    claimsWitness: { handleHash: 1n, handleBlind: 2n } } as any, `0x${'11'.repeat(32)}`), /root status metadata/);
});

describe('registerLinkedInstagram resumption', () => {
  const owner = `0x${'11'.repeat(32)}`;
  const input = { activeOwner: owner, ghostOwner: owner, rootCommitment: 99n,
    claims: { schemaVersion: 1, credentialType: CredentialType.Instagram as const, handleCommitment: 123n, expiryTs: 2000n } };
  function fixture(options: { failConversion?: boolean; linkedState?: string; lookupError?: string; sourceError?: string; missingReader?: boolean; linkedStatusError?: string } = {}) {
    let issued = false, linked = false, issues = 0, conversions = 0;
    const methods = {
      register_credential: () => ({ send: async () => { if (issued) throw new Error('duplicate issuance'); issued = true; issues++; return {}; } }),
      get_linked_credential_hinted: () => ({ simulate: async () => {
        if (options.lookupError) throw new Error(options.lookupError);
        if (!linked) throw new Error('linked credential note not found');
        return { note: { root_commitment: 99n, claims_hash: computeInstagramClaimsHash(input.claims), credential_type: 3n, expiry_ts: 2000n } };
      } }),
      get_linked_status_hinted: () => ({ simulate: async () => { if (options.linkedStatusError) throw new Error(options.linkedStatusError); return { note: { root_commitment: 99n, claims_hash: computeInstagramClaimsHash(input.claims), credential_type: 3n, revocation_secret: 303n } }; } }),
      get_credential_hinted: () => ({ simulate: async () => { if (options.sourceError) throw new Error(options.sourceError); if (!issued) throw new Error('credential note not found'); return 'credential'; } }),
      get_status_hinted: () => ({ simulate: async () => 'status' }),
      get_root_status_hinted: () => ({ simulate: async () => ({ note: { root_commitment: 99n, revocation_secret: 404n } }) }),
      link_credential_to_root: () => ({ send: async () => { conversions++;
        if (options.failConversion && conversions === 1) throw new Error('conversion rejected');
        linked = true; return { txHash: 'linked' };
      } }),
    };
    const engine = new MagnaVerificationEngine({ orchestratorAddress: owner, issuerContract: { methods } as never,
      readInstagramChainState: options.missingReader ? undefined : async (hints: any) => {
        assert.equal(hints.claimsHash, String(computeInstagramClaimsHash(input.claims)));
        assert.equal(hints.rootCommitment, '99');
        assert.equal(hints.hintedStatusNote.note.revocation_secret, 303n);
        assert.equal(hints.hintedRootStatusNote.note.revocation_secret, 404n);
        assert.equal('hintedRootAuthorityNote' in hints, false);
        return { status: options.linkedState ?? 'active' };
      },
      hintLookupAttempts: 1,
    } as any);
    return { engine, counts: () => ({ issues, conversions }) };
  }
  it('reuses settled standalone issuance after conversion fails', async () => {
    const { engine, counts } = fixture({ failConversion: true });
    await assert.rejects(() => engine.registerLinkedInstagram(input), /conversion rejected/);
    const result = await engine.registerLinkedInstagram(input);
    assert.equal((result as any).txHash, 'linked');
    assert.deepEqual(counts(), { issues: 1, conversions: 2 });
  });
  it('rediscovers and validates a settled conversion without issuing or converting again', async () => {
    const { engine, counts } = fixture();
    await engine.registerLinkedInstagram(input);
    const result = await engine.registerLinkedInstagram(input);
    assert.equal((result as any).alreadyLinked, true);
    assert.deepEqual(counts(), { issues: 1, conversions: 1 });
  });
  it('rejects a revoked linked instance without falling back to its standalone source', async () => {
    const { engine, counts } = fixture({ linkedState: 'inactive' });
    await engine.registerLinkedInstagram(input);
    await assert.rejects(() => engine.registerLinkedInstagram(input), /linked Instagram credential is inactive or expired/);
    assert.deepEqual(counts(), { issues: 1, conversions: 1 });
  });
  it('does not mint when linked discovery fails with a network or authorization error', async () => {
    for (const lookupError of ['network unavailable', 'caller is not owner']) {
      const { engine, counts } = fixture({ lookupError });
      await assert.rejects(() => engine.registerLinkedInstagram(input), new RegExp(lookupError));
      assert.deepEqual(counts(), { issues: 0, conversions: 0 });
    }
  });
  it('does not mint on standalone lookup errors or missing paired linked status', async () => {
    const source = fixture({ sourceError: 'network unavailable' });
    await assert.rejects(() => source.engine.registerLinkedInstagram(input), /network unavailable/);
    assert.deepEqual(source.counts(), { issues: 0, conversions: 0 });
    const linked = fixture({ linkedStatusError: 'linked status note not found' });
    await linked.engine.registerLinkedInstagram(input);
    await assert.rejects(() => linked.engine.registerLinkedInstagram(input), /linked status note not found/);
    assert.deepEqual(linked.counts(), { issues: 1, conversions: 1 });
  });
  it('fails closed when an already-settled link has no chain-state reader', async () => {
    const { engine, counts } = fixture({ missingReader: true });
    await engine.registerLinkedInstagram(input);
    await assert.rejects(() => engine.registerLinkedInstagram(input), /readInstagramChainState is required/);
    assert.deepEqual(counts(), { issues: 1, conversions: 1 });
  });

});
