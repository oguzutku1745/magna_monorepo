import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MagnaClient } from "./client.js";
import {
  CredentialType,
  type PassportCanonicalClaims,
} from "./types.js";
import {
  MAGNA_GHOST_DS,
  computeRevocationNullifier,
  poseidon2FieldHasher,
  packAlpha3,
} from "./encoding.js";
import { LEGACY_GHOST_DERIVATION_VERSION } from "./ghost.js";

type RecoveryNoteLike = {
  revocation_secret: bigint;
  claims_hash: bigint;
  credential_type: number;
  expiry_ts: bigint;
};

type HintedRecoveryLike = {
  note: RecoveryNoteLike;
  contract_address: string;
  owner: string;
  randomness: bigint;
  storage_slot: bigint;
  metadata: { stage: number; maybe_note_nonce: bigint };
};

function pseudoAddressFromSecret(secretHex: string): string {
  const digest = createHash("sha256").update(secretHex, "hex").digest("hex");
  return `0x${digest.slice(0, 40)}`;
}

describe("ghost recovery flow", () => {
  it("derives ghost deterministically and applies kill-switch nullifier during recovery", async () => {
    const orchestratorAddress = "0x1111111111111111111111111111111111111111";
    const activeOwner = "0x2222222222222222222222222222222222222222";
    const uniqueIdentifier = 0x0123456789abcdefn;

    // Device A derives ghost wallet material from zkPassport uniqueIdentifier.
    const bootstrapClient = new MagnaClient({
      orchestratorAddress,
      issuerContract: { methods: {} } as never,
      hasher: poseidon2FieldHasher,
    });
    const ghostA = bootstrapClient.deriveGhost({
      uniqueIdentifier,
      credentialType: CredentialType.Passport,
      derivationVersion: LEGACY_GHOST_DERIVATION_VERSION,
      domainSeparator: MAGNA_GHOST_DS,
    });
    const ghostAddressA = pseudoAddressFromSecret(ghostA.secretHex);

    const claims: PassportCanonicalClaims = {
      schemaVersion: 1,
      credentialType: CredentialType.Passport,
      nationalityAlpha3Packed: packAlpha3("CAN"),
      minAgeProven: 21,
      expiryTs: 1_893_456_000n,
    };

    const recoveryInbox = new Map<string, RecoveryNoteLike>();
    const killSwitchNullifiers = new Set<string>();
    let revocationSeed = 700n;

    const mockIssuer = {
      methods: {
        register_credential: (
          activeOwnerArg: string,
          ghostOwnerArg: string,
          claimsHashArg: bigint,
          credentialTypeArg: number,
          expiryTsArg: bigint,
        ) => ({
          send: async ({ from }: { from: string }) => {
            assert.equal(from, orchestratorAddress, "only orchestrator can issue");

            // Simulate issuer minting RecoveryNote to the ghost wallet address.
            const revocationSecret = revocationSeed;
            revocationSeed += 1n;
            recoveryInbox.set(ghostOwnerArg, {
              revocation_secret: revocationSecret,
              claims_hash: claimsHashArg,
              credential_type: credentialTypeArg,
              expiry_ts: BigInt(expiryTsArg),
            });

            return { activeOwner: activeOwnerArg };
          },
        }),
        recover: (
          hintedRecoveryArg: HintedRecoveryLike,
          _newActiveOwnerArg: string,
          _remintCredentialArg: boolean,
        ) => ({
          send: async ({ from }: { from: string }) => {
            assert.equal(from, hintedRecoveryArg.owner, "ghost owner must call recover");

            const expected = recoveryInbox.get(from);
            assert.ok(expected, "expected recovery note in ghost inbox");
            assert.deepEqual(
              hintedRecoveryArg.note,
              expected,
              "recovery note payload mismatch",
            );

            // Kill-switch nullifier formula mirrors the contract:
            // H(revocation_secret, credential_type, claims_hash; ds)
            const killSwitchNullifier = computeRevocationNullifier(
              hintedRecoveryArg.note.revocation_secret,
              hintedRecoveryArg.note.credential_type,
              hintedRecoveryArg.note.claims_hash,
              poseidon2FieldHasher,
            );
            killSwitchNullifiers.add(killSwitchNullifier.toString(16));
            recoveryInbox.delete(from);

            return { killSwitchNullifier };
          },
        }),
      },
    };

    const clientA = new MagnaClient({
      orchestratorAddress,
      issuerContract: mockIssuer as never,
      hasher: poseidon2FieldHasher,
    });

    await clientA.registerPassport({
      activeOwner,
      ghostOwner: ghostAddressA,
      claims,
    });

    const issuedRecovery = recoveryInbox.get(ghostAddressA);
    assert.ok(issuedRecovery, "recovery note should be delivered to ghost owner");

    // Device B re-derives same ghost wallet from the same uniqueIdentifier.
    const clientB = new MagnaClient({
      orchestratorAddress,
      issuerContract: mockIssuer as never,
      hasher: poseidon2FieldHasher,
    });
    const ghostB = clientB.deriveGhost({
      uniqueIdentifier,
      credentialType: CredentialType.Passport,
      derivationVersion: LEGACY_GHOST_DERIVATION_VERSION,
      domainSeparator: MAGNA_GHOST_DS,
    });
    const ghostAddressB = pseudoAddressFromSecret(ghostB.secretHex);
    assert.equal(ghostAddressB, ghostAddressA, "ghost wallet re-derivation must be stable");

    const hintedRecovery: HintedRecoveryLike = {
      note: issuedRecovery!,
      contract_address: "0xissuer",
      owner: ghostAddressB,
      randomness: 1n,
      storage_slot: 1n,
      metadata: { stage: 2, maybe_note_nonce: 1n },
    };

    await clientB.recover(
      {
        hintedRecoveryNote: hintedRecovery,
        newActiveOwner: "0x3333333333333333333333333333333333333333",
        remintCredential: true,
      },
      ghostAddressB,
    );

    const expectedNullifier = computeRevocationNullifier(
      issuedRecovery!.revocation_secret,
      issuedRecovery!.credential_type,
      issuedRecovery!.claims_hash,
      poseidon2FieldHasher,
    );
    assert.equal(
      killSwitchNullifiers.has(expectedNullifier.toString(16)),
      true,
      "recovery must emit kill-switch nullifier",
    );
  });
});
