import { deriveSecretKeyFromSigningKey } from "@aztec/accounts/utils";
import { getSchnorrAccountContractAddress } from "@aztec/accounts/schnorr";
import { poseidon2HashWithSeparator } from "@aztec/foundation/crypto/sync";
import { Fr } from "@aztec/foundation/curves/bn254";
import { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin";
import type { AztecAddress } from "@aztec/stdlib/aztec-address";
import {
  MAGNA_GHOST_DS,
  MAGNA_PASSPORT_CREDENTIAL_TYPE,
} from "./constants.js";
import {
  computeRecoveryRootCommitmentField,
  recoveryIdentityPreimage,
  type RecoveryIdentityInput,
} from "./encoding.js";
export type { RecoveryIdentityInput } from "./encoding.js";

export type RecoveryGhostIdentity = {
  rootCommitment: Fr;
  signingSeed: Fr;
  signingKey: GrumpkinScalar;
  privacySecret: Fr;
  accountSalt: Fr;
  address: AztecAddress;
};

function ghostPreimage(input: RecoveryIdentityInput): bigint[] {
  return [...recoveryIdentityPreimage(input), MAGNA_PASSPORT_CREDENTIAL_TYPE];
}

export function computeRecoveryRootCommitment(input: RecoveryIdentityInput): Fr {
  return new Fr(computeRecoveryRootCommitmentField(input));
}

export function computeRecoveryGhostAccountSalt(input: RecoveryIdentityInput): Fr {
  return poseidon2HashWithSeparator(ghostPreimage(input), MAGNA_GHOST_DS);
}

export function computeRecoveryGhostSigningSeed(input: RecoveryIdentityInput): Fr {
  return computeRecoveryGhostAccountSalt(input);
}

export async function deriveRecoveryGhostIdentity(
  input: RecoveryIdentityInput,
): Promise<RecoveryGhostIdentity> {
  const rootCommitment = computeRecoveryRootCommitment(input);
  const accountSalt = computeRecoveryGhostAccountSalt(input);
  const signingSeed = computeRecoveryGhostSigningSeed(input);
  if (signingSeed.isZero()) throw new Error("Derived recovery Ghost seed is zero.");
  const signingKey = new GrumpkinScalar(signingSeed.toBigInt());
  const privacySecret = await deriveSecretKeyFromSigningKey(signingKey);
  const address = await getSchnorrAccountContractAddress(signingKey, accountSalt, privacySecret);
  return { rootCommitment, signingSeed, signingKey, privacySecret, accountSalt, address };
}
