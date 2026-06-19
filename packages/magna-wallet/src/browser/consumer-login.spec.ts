import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CredentialType, ClaimId, ConstraintOp } from "@magna/core";
import { MagnaConsumerContract, MagnaIssuerContract } from "@magna/contracts-bindings";
import { runMagnaConsumerLogin } from "./consumer-login.js";

const activeAddress = "0x0222222222222222222222222222222222222222222222222222222222222222";
const issuerAddress = "0x0111111111111111111111111111111111111111111111111111111111111111";
const orchestratorAddress = "0x0333333333333333333333333333333333333333333333333333333333333333";
const consumerGatewayAddress = "0x0444444444444444444444444444444444444444444444444444444444444444";
const aztecNodeUrl = "http://127.0.0.1:8080";

const originalIssuerAt = MagnaIssuerContract.at;
const originalConsumerAt = MagnaConsumerContract.at;

after(() => {
  (MagnaIssuerContract as unknown as { at: typeof originalIssuerAt }).at = originalIssuerAt;
  (MagnaConsumerContract as unknown as { at: typeof originalConsumerAt }).at = originalConsumerAt;
});

test("runMagnaConsumerLogin routes rooted credentials through linked consumer gateway", async () => {
  const hintedRootStatusNote = { id: "root-status" };
  const hintedRootAuthorityNote = { id: "root-authority" };
  const hintedCredentialNote = { id: "linked-credential" };
  const hintedStatusNote = { id: "linked-status" };
  let legacyCalled = false;
  let linkedSendOptions: unknown;
  const registeredContracts: string[] = [];

  (MagnaIssuerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => ({
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
    assert.deepEqual(registeredContracts, [issuerAddress, consumerGatewayAddress]);
    return {
    methods: {
      login_with_magna: () => {
        legacyCalled = true;
        return { send: async () => ({ txHash: "0xlegacy" }) };
      },
      login_with_linked_magna: () => ({
        send: async (options: unknown) => {
          linkedSendOptions = options;
          return { txHash: "0xlinked" };
        },
      }),
    },
    };
  };

  const outcome = await runMagnaConsumerLogin({
    env: {
      aztecNodeUrl,
      issuerAddress,
      orchestratorAddress,
    },
    wallet: {
      registerSender: async () => undefined,
      getContractMetadata: async (address: { toString(): string }) => ({
        instance: { address: address.toString() },
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
  assert.deepEqual(linkedSendOptions, { from: activeAddress });
  assert.deepEqual(outcome, { verified: true, receipt: "0xlinked" });
});

test("runMagnaConsumerLogin routes instagram credentials through issuer verification", async () => {
  const hintedCredentialNote = { id: "instagram-credential" };
  const hintedStatusNote = { id: "instagram-status" };
  const registeredContracts: string[] = [];
  let verifyArgs: unknown[] | undefined;

  (MagnaIssuerContract as unknown as { at: (address: unknown, wallet: unknown) => unknown }).at = () => ({
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

  const outcome = await runMagnaConsumerLogin({
    env: {
      aztecNodeUrl,
      issuerAddress,
      orchestratorAddress,
    },
    wallet: {
      registerSender: async () => undefined,
      getContractMetadata: async (address: { toString(): string }) => ({
        instance: { address: address.toString() },
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

  assert.deepEqual(registeredContracts, [issuerAddress]);
  assert.deepEqual(verifyArgs?.slice(1), [
    hintedCredentialNote,
    hintedStatusNote,
    123n,
    0,
  ]);
  assert.deepEqual(outcome, { verified: true, receipt: "0xinstagram" });
});
