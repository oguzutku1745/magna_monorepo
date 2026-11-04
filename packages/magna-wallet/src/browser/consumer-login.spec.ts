import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CredentialType, ClaimId, ConstraintOp } from "@magna-protocol/core";
import { ContractInitializationStatus } from "@aztec-labs/aztec.js/wallet";
import { MagnaCompanySponsorContract, MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import { MagnaBrowserClient } from "./client.js";
import { runMagnaConsumerLogin } from "./consumer-login.js";

const activeAddress = "0x0222222222222222222222222222222222222222222222222222222222222222";
const issuerAddress = "0x0111111111111111111111111111111111111111111111111111111111111111";
const orchestratorAddress = "0x0333333333333333333333333333333333333333333333333333333333333333";
const consumerGatewayAddress = "0x0444444444444444444444444444444444444444444444444444444444444444";
const sponsorAddress = "0x0555555555555555555555555555555555555555555555555555555555555555";
const aztecNodeUrl = "http://127.0.0.1:8080";
const sessionAuthorization = {
  requestId: "11".repeat(16),
  sessionChallenge: `00${"22".repeat(31)}`,
  expiresAt: 1_800_000_000,
  requirementIndex: 0,
};

// Slot 0 is already spent in this chain snapshot, even in a fresh wallet session.
const chainNode = {
  getBlockNumber: async () => 77,
  getBlockData: async () => ({ header: { globalVariables: { timestamp: 1_728_000_123n } } }),
  getNullifierMembershipWitness: async (_block: unknown, hash: { toString(): string }) =>
    ["0x28a16dbecf86be9dc005c2c3b6bd62045c09eccda236e08561bbae0d5728691f",
     "0x1ce7510a5779996c519dfd2c6809f9af1d5ae4ae25c3422b85e3efd1e6ef9f1d"].includes(hash.toString())
      ? { index: 1n } : undefined,
};
function statusNote(type: number, claims: bigint) {
  return { note: { revocation_secret: 77n, credential_type: BigInt(type), claims_hash: claims } };
}

const originalIssuerAt = MagnaIssuerContract.at;
const originalConsumerAt = MagnaConsumerContract.at;
const originalSponsorAt = MagnaCompanySponsorContract.at;

after(() => {
  (MagnaIssuerContract as unknown as { at: typeof originalIssuerAt }).at = originalIssuerAt;
  (MagnaConsumerContract as unknown as { at: typeof originalConsumerAt }).at = originalConsumerAt;
  (MagnaCompanySponsorContract as unknown as { at: typeof originalSponsorAt }).at = originalSponsorAt;
});

function sponsorEnv() {
  return {
    aztecNodeUrl,
    issuerAddress,
    orchestratorAddress,
    activeCompanySponsorAddress: sponsorAddress,
    companySponsorAddresses: [sponsorAddress],
  };
}

function assertSponsorFeeOptions(options: unknown) {
  const sendOptions = options as {
    from?: { toString(): string };
    fee?: {
      paymentMethod?: {
        getFeePayer: () => Promise<{ toString(): string }>;
      };
    };
    additionalScopes?: { toString(): string }[];
  };
  assert.equal(sendOptions.from?.toString(), activeAddress);
  assert.ok(sendOptions.fee, "expected sponsored fee config");
  assert.equal(sendOptions.additionalScopes?.[0]?.toString(), sponsorAddress);
  assert.equal(sendOptions.additionalScopes?.[1]?.toString(), issuerAddress);
  return sendOptions.fee!.paymentMethod!.getFeePayer();
}

test("runMagnaConsumerLogin routes rooted credentials through the linked sponsor gateway", async (t) => {
  const hintedRootStatusNote = { id: "root-status" };
  t.mock.method(MagnaBrowserClient.prototype as any, "selectRootStatusHint", async () => hintedRootStatusNote);
  const hintedRootAuthorityNote = { id: "root-authority" };
  const hintedCredentialNote = { id: "linked-credential" };
  const hintedStatusNote = statusNote(1, 123n);
  let legacyCalled = false;
  let linkedArgs: unknown[] | undefined;
  let linkedSendOptions: unknown;
  const registeredContracts: string[] = [];

  (MagnaIssuerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => ({
    address: { toString: () => issuerAddress },
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
  });
  (MagnaConsumerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => {
    throw new Error("consumer contract should not be bound for sponsored login");
  };
  (MagnaCompanySponsorContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => {
    assert.deepEqual(registeredContracts, [issuerAddress, sponsorAddress]);
    return {
      address: { toString: () => sponsorAddress },
      methods: {
      sponsored_verify: () => {
        legacyCalled = true;
        return { send: async () => ({ txHash: "0xlegacy" }) };
      },
      sponsored_verify_linked_session: (...args: unknown[]) => {
        linkedArgs = args;
        return {
        send: async (options: unknown) => {
          linkedSendOptions = options;
          return { txHash: "0xlinked" };
        },
        };
      },
      },
    };
  };

  const outcome = await runMagnaConsumerLogin({
    env: sponsorEnv(),
    wallet: {
      aztecNode: chainNode,
      pxe: { debug: { getNotes: async () => [{ id: "account-auth" }] } },
      registerSender: async () => undefined,
      getContractMetadata: async (address: { toString(): string }) => ({
        instance: { address: address.toString() },
        initializationStatus: ContractInitializationStatus.INITIALIZED,
      }),
      registerContract: async (instance: { address: string }) => {
        registeredContracts.push(instance.address);
      },
    } as never,
    activeAddress,
    consumerGatewayAddress,
    sessionAuthorization,
    policy: {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    },
    credential: {
      ownerAddress: activeAddress,
      claimsHash: "123",
      mode: "rooted",
      rootCommitment: "99",
      normalizedClaims: {
        nationalityAlpha3: "ZKR",
        minAgeProven: 18,
      },
    },
  });

  assert.equal(legacyCalled, false);
  assert.equal(linkedArgs?.[7], 1, "must skip the spent slot on a reopened wallet");
  assert.deepEqual(linkedArgs?.slice(1, 5), [
    hintedRootStatusNote,
    hintedRootAuthorityNote,
    hintedCredentialNote,
    hintedStatusNote,
  ]);
  assert.equal((await assertSponsorFeeOptions(linkedSendOptions)).toString(), sponsorAddress);
  assert.deepEqual(outcome, { verified: true, receipt: "0xlinked", authorizationContract: sponsorAddress });
});

test("runMagnaConsumerLogin routes v2-only rooted passports through the linked sponsor gateway", async (t) => {
  const hintedRootStatusNote = { id: "root-status" };
  t.mock.method(MagnaBrowserClient.prototype as any, "selectRootStatusHint", async () => hintedRootStatusNote);
  const hintedRootAuthorityNote = { id: "root-authority" };
  const hintedCredentialNote = { id: "linked-credential" };
  const hintedStatusNote = statusNote(1, 123n);
  let v2Args: unknown[] | undefined;
  let linkedSendOptions: unknown;

  (MagnaIssuerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => ({
    address: { toString: () => issuerAddress },
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
  });
  (MagnaConsumerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => ({
    methods: {},
  });
  (MagnaCompanySponsorContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => ({
    address: { toString: () => sponsorAddress },
    methods: {
      sponsored_verify_linked_session_v2: (...args: unknown[]) => {
        v2Args = args;
        return {
          send: async (options: unknown) => {
            linkedSendOptions = options;
            return { txHash: "0xlinkedv2" };
          },
        };
      },
    },
  });

  const outcome = await runMagnaConsumerLogin({
    env: sponsorEnv(),
    wallet: {
      aztecNode: chainNode,
      pxe: { debug: { getNotes: async () => [{ id: "account-auth" }] } },
      registerSender: async () => undefined,
      getContractMetadata: async (address: { toString(): string }) => ({
        instance: { address: address.toString() },
        initializationStatus: ContractInitializationStatus.INITIALIZED,
      }),
      registerContract: async () => undefined,
    } as never,
    activeAddress,
    consumerGatewayAddress,
    sessionAuthorization,
    policy: {
      credentialType: CredentialType.Passport,
      constraints: [
        {
          claimId: ClaimId.AgeMinProven,
          op: ConstraintOp.Gte,
          value: 18n,
        },
      ],
    },
    credential: {
      ownerAddress: activeAddress,
      claimsHash: "123",
      mode: "rooted",
      rootCommitment: "99",
      committedClaimsWitness: {
        minAgeProven: 18,
        nationalityAlpha3Packed: "5925714",
        nationalityBlind: "111",
        expiryTs: "1893456000",
        expiryBlind: "222",
      },
    },
  });

  assert.deepEqual(v2Args?.slice(1, 7), [
    hintedRootStatusNote,
    hintedRootAuthorityNote,
    hintedCredentialNote,
    hintedStatusNote,
    {
      min_age_proven: 18,
      nationality_alpha3_packed: 5925714n,
      nationality_blind: 111n,
      expiry_ts: 1893456000n,
      expiry_blind: 222n,
    },
    1,
  ]);
  assert.equal((await assertSponsorFeeOptions(linkedSendOptions)).toString(), sponsorAddress);
  assert.deepEqual(outcome, { verified: true, receipt: "0xlinkedv2", authorizationContract: sponsorAddress });
});

test("runMagnaConsumerLogin routes instagram credentials through sponsored issuer verification", async () => {
  const hintedCredentialNote = { id: "instagram-credential" };
  const hintedStatusNote = statusNote(3, 456n);
  const registeredContracts: string[] = [];
  let verifyArgs: unknown[] | undefined;
  let sendOptions: unknown;

  (MagnaIssuerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => ({
    address: { toString: () => issuerAddress },
    methods: {
      get_credential_hinted: () => ({
        simulate: async () => hintedCredentialNote,
      }),
      get_status_hinted: () => ({
        simulate: async () => hintedStatusNote,
      }),
      verify_instagram: (...args: unknown[]) => {
        verifyArgs = args;
        return {
          send: async () => ({ txHash: "0xinstagram" }),
        };
      },
    },
  });
  (MagnaConsumerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => {
    throw new Error("consumer contract should not be bound for instagram login");
  };
  (MagnaCompanySponsorContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => {
    assert.deepEqual(registeredContracts, [issuerAddress, sponsorAddress]);
    return {
      address: { toString: () => sponsorAddress },
      methods: {
        sponsored_verify_session_instagram: (...args: unknown[]) => {
          verifyArgs = args;
          return {
            send: async (options: unknown) => {
              sendOptions = options;
              return { txHash: "0xinstagram" };
            },
          };
        },
      },
    };
  };

  const outcome = await runMagnaConsumerLogin({
    env: sponsorEnv(),
    wallet: {
      aztecNode: chainNode,
      pxe: { debug: { getNotes: async () => [{ id: "account-auth" }] } },
      registerSender: async () => undefined,
      getContractMetadata: async (address: { toString(): string }) => ({
        instance: { address: address.toString() },
        initializationStatus: ContractInitializationStatus.INITIALIZED,
      }),
      registerContract: async (instance: { address: string }) => {
        registeredContracts.push(instance.address);
      },
    } as never,
    activeAddress,
    consumerGatewayAddress,
    sessionAuthorization,
    policy: {
      credentialType: CredentialType.Instagram,
      constraints: [
        {
          claimId: ClaimId.InstagramHandleHash,
          op: ConstraintOp.Eq,
          value: 123n,
        },
      ],
    },
    credential: {
      ownerAddress: activeAddress,
      kind: "instagram",
      claimsHash: "456",
      handleHash: "123",
      handleBlind: "789",
      instagramHandle: "akinspur",
    },
  });

  assert.deepEqual(registeredContracts.slice(0, 2), [issuerAddress, sponsorAddress]);
  assert.deepEqual(verifyArgs?.slice(1, 5), [
    hintedCredentialNote,
    hintedStatusNote,
    { handle_hash: 123n, handle_blind: 789n },
    1,
  ]);
  assert.equal((await assertSponsorFeeOptions(sendOptions)).toString(), sponsorAddress);
  assert.deepEqual(outcome, { verified: true, receipt: "0xinstagram", authorizationContract: sponsorAddress });
});

for (const missingRoot of [false, true]) {
  test(`rooted Instagram ${missingRoot ? 'rejects missing root metadata' : 'uses linked session sponsorship without authority'}`, async () => {
    let linkedArgs: unknown[] | undefined;
    let options: unknown;
    (MagnaIssuerContract as any).at = () => ({ address: { toString: () => issuerAddress }, methods: {} });
    (MagnaCompanySponsorContract as any).at = () => ({ address: { toString: () => sponsorAddress }, methods: {
      sponsored_verify_linked_session_instagram: (...args: unknown[]) => { linkedArgs = args; return { send: async (opts: unknown) => { options = opts; return { txHash: '0xlinkedig' }; } }; },
    } });
    const { MagnaBrowserClient } = await import('./client.js');
    const proto = MagnaBrowserClient.prototype as any;
    const original = proto.fetchLinkedInstagramHints;
    proto.fetchLinkedInstagramHints = async () => ({ hintedRootStatusNote: 'root', hintedCredentialNote: 'credential', hintedStatusNote: statusNote(3, 456n) });
    try {
      const input = { env: sponsorEnv(), wallet: {
      aztecNode: chainNode,
        pxe: { debug: { getNotes: async () => [{ id: 'auth' }] } }, registerSender: async () => {}, registerContract: async () => {},
        getContractMetadata: async () => ({ instance: {}, initializationStatus: ContractInitializationStatus.INITIALIZED }),
      } as never, activeAddress, consumerGatewayAddress, sessionAuthorization,
        policy: { credentialType: CredentialType.Instagram, constraints: [{ claimId: ClaimId.InstagramHandleHash, op: ConstraintOp.Eq, value: 123n }] },
        credential: { ownerAddress: activeAddress, kind: 'instagram' as const, mode: 'rooted' as const, rootCommitment: missingRoot ? undefined : '99', claimsHash: '456', handleHash: '123', handleBlind: '789' },
      };
      if (missingRoot) await assert.rejects(() => runMagnaConsumerLogin(input), /missing its root commitment/);
      else {
        const outcome = await runMagnaConsumerLogin(input);
        assert.deepEqual(linkedArgs?.slice(1, 6), ['root', 'credential', statusNote(3, 456n), { handle_hash: 123n, handle_blind: 789n }, 1]);
        assert.equal(linkedArgs?.length, 11);
        assert.equal((await assertSponsorFeeOptions(options)).toString(), sponsorAddress);
        assert.deepEqual(outcome, { verified: true, receipt: '0xlinkedig', authorizationContract: sponsorAddress });
      }
    } finally { proto.fetchLinkedInstagramHints = original; }
  });
}

// Exercise every supported route using the real verification engine. Only chain
// reads and transaction submission are replaced; no slot-selection code is mocked.
for (const kind of ["passport", "passport-v2", "instagram"] as const) {
  for (const rooted of [false, true]) {
    test(`${kind} ${rooted ? "linked" : "standalone"} logins select new slots across fresh sessions`, async t => {
      const instagram = kind === "instagram";
      const method = instagram
        ? (rooted ? "sponsored_verify_linked_session_instagram" : "sponsored_verify_session_instagram")
        : kind === "passport-v2"
          ? (rooted ? "sponsored_verify_linked_session_v2" : "sponsored_verify_session_v2")
          : (rooted ? "sponsored_verify_linked_session" : "sponsored_verify_session");
      const slotIndex = instagram ? (rooted ? 5 : 4) : kind === "passport-v2" ? (rooted ? 6 : 4) : (rooted ? 7 : 5);
      const vectors = instagram ? [
        "0x2008bd78e460062f5990d80664502792d1fc207ba2664140b0537ae613135f12",
        "0x10f0acded83b2f23ae12e2197d64c5f219bd2d434a57e2b23060d2efa4306add",
      ] : [
        "0x28a16dbecf86be9dc005c2c3b6bd62045c09eccda236e08561bbae0d5728691f",
        "0x059b47e9717aa39bb7e9c6d57ab0eadb720062345ac3ba704f181e6d460870e5",
      ];
      const spent = new Set<string>();
      const hints = { claimsHash: "123", rootCommitment: "99", hintedCredentialNote: {},
        hintedStatusNote: statusNote(instagram ? 3 : 1, 123n), hintedRootStatusNote: {}, hintedRootAuthorityNote: {} };
      for (const lookup of ["fetchLinkedInstagramHints", "fetchRootedPassportHintsByClaimsHash", "fetchPassportHintsByClaimsHash"] as const) {
        t.mock.method(MagnaBrowserClient.prototype, lookup, async () => hints);
      }
      (MagnaIssuerContract as any).at = () => ({ address: { toString: () => issuerAddress }, methods: {} });
      const selectedSlots: number[] = [];
      let expectedRequestId = sessionAuthorization.requestId;
      (MagnaCompanySponsorContract as any).at = () => ({ address: { toString: () => sponsorAddress }, methods: {
        [method]: (...args: unknown[]) => ({ send: async (options: unknown) => {
          const slot = args[slotIndex] as number;
          selectedSlots.push(slot);
          assert.equal((await assertSponsorFeeOptions(options)).toString(), sponsorAddress);
          // Preserve the existing request/session authorization argument ordering.
          assert.equal(BigInt(String(args[slotIndex + 2])), BigInt(`0x${expectedRequestId}`));
          assert.ok(!spent.has(vectors[slot]), "must not submit an already spent slot");
          spent.add(vectors[slot]);
          return { txHash: `0xreceipt${slot}` };
        } }),
      } });
      for (let attempt = 0; attempt < 2; attempt++) {
        expectedRequestId = attempt === 0 ? sessionAuthorization.requestId : "33".repeat(16);
        let synchronized = false;
        const wallet = {
          aztecNode: { ...chainNode,
            getBlockData: async () => ({ header: { globalVariables: { timestamp: 1_728_086_523n } } }),
            getNullifierMembershipWitness: async (_block: unknown, hash: { toString(): string }) =>
              spent.has(hash.toString()) ? { index: 1n } : undefined },
          pxe: {
            debug: { getNotes: async () => [{ id: "auth" }], sync: async () => { synchronized = true; } },
            getSyncedBlockHeader: async () => {
              assert.ok(synchronized, "must synchronize before checking the proving anchor's day");
              return { globalVariables: { timestamp: 1_728_000_123n } };
            },
          },
          registerSender: async () => {}, registerContract: async () => {},
          getContractMetadata: async () => ({ instance: {}, initializationStatus: ContractInitializationStatus.INITIALIZED }),
        };
        const credential = { ownerAddress: activeAddress, claimsHash: "123", mode: rooted ? "rooted" as const : "passport" as const,
          rootCommitment: rooted ? "99" : undefined,
          ...(instagram ? { handleHash: "123", handleBlind: "789" } : kind === "passport-v2"
            ? { committedClaimsWitness: { minAgeProven: 18, nationalityAlpha3Packed: "5925714", nationalityBlind: "111", expiryTs: "1893456000", expiryBlind: "222" } }
            : { normalizedClaims: { nationalityAlpha3: "ZKR", minAgeProven: 18 } }) };
        const outcome = await runMagnaConsumerLogin({ env: sponsorEnv(), wallet: wallet as never, activeAddress,
          consumerGatewayAddress, sessionAuthorization: { ...sessionAuthorization, requestId: expectedRequestId },
          policy: { credentialType: instagram ? CredentialType.Instagram : CredentialType.Passport,
            constraints: instagram ? [{ claimId: ClaimId.InstagramHandleHash, op: ConstraintOp.Eq, value: 123n }]
              : [{ claimId: ClaimId.AgeMinProven, op: ConstraintOp.Gte, value: 18n }] }, credential });
        assert.equal(outcome.receipt, `0xreceipt${attempt}`);
      }
      assert.deepEqual(selectedSlots, [0, 1]);
    });
  }
}
