import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computePassportCommittedClaimsHashFromWitness, poseidon2FieldHasher } from "../engine/encoding.js";
import type { PassportCommittedClaimsWitness } from "../engine/types.js";
import { MagnaBrowserClient } from "./client.js";

describe("MagnaBrowserClient Passport A2 renewal", () => {
  it("consumes the public authorization locally from the active owner wallet", async () => {
    const activeOwner = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const ghostOwner = "0x2222222222222222222222222222222222222222222222222222222222222222";
    const claimsWitness: PassportCommittedClaimsWitness = {
      minAgeProven: 21,
      nationalityAlpha3Packed: 0x545552n,
      nationalityBlind: 123n,
      expiryTs: 1_893_456_000n,
      expiryBlind: 456n,
    };
    const hints = {
      claimsHash: "old-claims",
      rootCommitment: "root",
      hintedCredentialNote: { id: "credential" },
      hintedStatusNote: { id: "status" },
      hintedRootStatusNote: { id: "root-status" },
      hintedRootAuthorityNote: { id: "root-authority" },
    };
    let capturedArgs: unknown[] | undefined;
    let capturedFrom: unknown;
    const client = Object.create(MagnaBrowserClient.prototype) as any;
    client.env = { requireRealSends: true };
    client.userAddress = activeOwner;
    client.ensureContractsRegistered = async () => undefined;
    client.ensureUserAccountIsDeployed = async () => undefined;
    client.issuer = {
      methods: {
        refresh_root_authority_authorized: (...args: unknown[]) => {
          capturedArgs = args;
          return {
            send: async ({ from }: { from: unknown }) => {
              capturedFrom = from;
              return { txHash: "0xrenew" };
            },
          };
        },
      },
    };

    const outcome = await client.refreshRootAuthorityAuthorized(
      ghostOwner,
      claimsWitness,
      1_800_000_000n,
      hints,
    );

    assert.equal(String(capturedArgs?.[0]), ghostOwner);
    assert.deepEqual(capturedArgs?.slice(1, 3), [hints.hintedRootStatusNote, hints.hintedRootAuthorityNote]);
    assert.equal(
      (capturedArgs?.[3] as { toBigInt(): bigint }).toBigInt(),
      computePassportCommittedClaimsHashFromWitness(claimsWitness, poseidon2FieldHasher),
    );
    assert.equal(capturedArgs?.[4], 1_800_000_000n);
    assert.equal(String(capturedFrom), activeOwner);
    assert.equal(outcome.txHash, "0xrenew");
  });
});
