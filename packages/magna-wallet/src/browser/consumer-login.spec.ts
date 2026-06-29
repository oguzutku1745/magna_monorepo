import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CredentialType, ClaimId, ConstraintOp } from "@magna/core";
import { ContractInitializationStatus } from "@aztec/aztec.js/wallet";
import { MagnaCompanySponsorContract, MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import { runMagnaConsumerLogin } from "./consumer-login.js";

const activeAddress = "0x0222222222222222222222222222222222222222222222222222222222222222";
const issuerAddress = "0x0111111111111111111111111111111111111111111111111111111111111111";
const orchestratorAddress = "0x0333333333333333333333333333333333333333333333333333333333333333";
const consumerGatewayAddress = "0x0444444444444444444444444444444444444444444444444444444444444444";
const sponsorAddress = "0x0555555555555555555555555555555555555555555555555555555555555555";
const aztecNodeUrl = "http://127.0.0.1:8080";

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

test("runMagnaConsumerLogin routes rooted credentials through the linked sponsor gateway", async () => {
  const hintedRootStatusNote = { id: "root-status" };
  const hintedRootAuthorityNote = { id: "root-authority" };
  const hintedCredentialNote = { id: "linked-credential" };
  const hintedStatusNote = { id: "linked-status" };
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
      sponsored_verify_linked: (...args: unknown[]) => {
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
  assert.deepEqual(linkedArgs?.slice(1, 5), [
    hintedRootStatusNote,
    hintedRootAuthorityNote,
    hintedCredentialNote,
    hintedStatusNote,
  ]);
  assert.equal((await assertSponsorFeeOptions(linkedSendOptions)).toString(), sponsorAddress);
  assert.deepEqual(outcome, { verified: true, receipt: "0xlinked" });
});

test("runMagnaConsumerLogin routes v2-only rooted passports through the linked sponsor gateway", async () => {
  const hintedRootStatusNote = { id: "root-status" };
  const hintedRootAuthorityNote = { id: "root-authority" };
  const hintedCredentialNote = { id: "linked-credential" };
  const hintedStatusNote = { id: "linked-status" };
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
      sponsored_verify_linked_v2: (...args: unknown[]) => {
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
      registerSender: async () => undefined,
      getContractMetadata: async (address: { toString(): string }) => ({
        instance: { address: address.toString() },
        initializationStatus: ContractInitializationStatus.INITIALIZED,
      }),
      registerContract: async () => undefined,
    } as never,
    activeAddress,
    consumerGatewayAddress,
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

  assert.deepEqual(v2Args?.slice(1), [
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
    0,
  ]);
  assert.equal((await assertSponsorFeeOptions(linkedSendOptions)).toString(), sponsorAddress);
  assert.deepEqual(outcome, { verified: true, receipt: "0xlinkedv2" });
});

test("runMagnaConsumerLogin routes instagram credentials through sponsored issuer verification", async () => {
  const hintedCredentialNote = { id: "instagram-credential" };
  const hintedStatusNote = { id: "instagram-status" };
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
        sponsored_verify_instagram: (...args: unknown[]) => {
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
      instagramHandle: "akinspur",
    },
  });

  assert.deepEqual(registeredContracts.slice(0, 2), [issuerAddress, sponsorAddress]);
  assert.deepEqual(verifyArgs?.slice(1), [
    hintedCredentialNote,
    hintedStatusNote,
    123n,
    0,
  ]);
  assert.equal((await assertSponsorFeeOptions(sendOptions)).toString(), sponsorAddress);
  assert.deepEqual(outcome, { verified: true, receipt: "0xinstagram" });
});
