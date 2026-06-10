import type { AuthWitnessProvider } from "@aztec/aztec.js/account";
import type { CompleteAddress } from "@aztec/aztec.js/addresses";
import { loadContractArtifact, type NoirCompiledContract } from "@aztec/aztec.js/abi";
import { Fr } from "@aztec/aztec.js/fields";
import { DefaultAccountContract } from "@aztec/accounts/defaults";
import { AuthWitness } from "@aztec/stdlib/auth-witness";
import MagnaWebAuthnAccountContractArtifactJson from "../../../../contracts/magna-webauthn-account/target/magna_webauthn_account-MagnaWebAuthnAccount.json" with { type: "json" };
import { buildWebAuthnWitnessFields, findOriginIndex } from "./witness.js";
import type { WebAuthnAsserter, WebAuthnRegistration } from "./ceremony.js";

const MagnaWebAuthnAccountContractArtifact = loadContractArtifact(
  MagnaWebAuthnAccountContractArtifactJson as NoirCompiledContract,
);

function originTo64(origin: string): { bytes: number[]; len: number } {
  const raw = new TextEncoder().encode(origin);
  if (raw.length > 64) throw new Error("origin exceeds 64 bytes");
  const bytes = new Array<number>(64).fill(0);
  raw.forEach((b, i) => (bytes[i] = b));
  return { bytes, len: raw.length };
}

function isNodeBuffer(value: Fr | Buffer): value is Buffer {
  return typeof Buffer !== "undefined" && Buffer.isBuffer(value);
}

function requestHashToFr(value: Fr | Buffer): Fr {
  return isNodeBuffer(value) ? Fr.fromBufferReduce(value) : value;
}

export class MagnaWebAuthnAccountContract extends DefaultAccountContract {
  constructor(
    private readonly registration: WebAuthnRegistration,
    private readonly assert: WebAuthnAsserter,
  ) {
    super();
  }

  override async getContractArtifact() {
    return MagnaWebAuthnAccountContractArtifact;
  }

  override async getInitializationFunctionAndArgs() {
    const origin = originTo64(this.registration.origin);
    if (this.registration.rpIdHash.length !== 32) throw new Error("rpIdHash must be 32 bytes");
    return {
      constructorName: "constructor",
      constructorArgs: [
        Array.from(this.registration.publicKey.x),
        Array.from(this.registration.publicKey.y),
        Array.from(this.registration.rpIdHash),
        origin.bytes,
        origin.len,
      ],
    };
  }

  override getAuthWitnessProvider(_address: CompleteAddress): AuthWitnessProvider {
    return {
      createAuthWit: async (messageHash: Fr | Buffer): Promise<AuthWitness> => {
        const requestHash = requestHashToFr(messageHash);
        const challenge = new Uint8Array(requestHash.toBuffer());
        if (challenge.length !== 32) throw new Error("auth witness challenge must be 32 bytes");
        const assertion = await this.assert(challenge);
        const fields = buildWebAuthnWitnessFields({
          signatureRS: assertion.signatureRS,
          authenticatorData: assertion.authenticatorData,
          clientDataJSON: assertion.clientDataJSON,
          originIndex: findOriginIndex(assertion.clientDataJSON),
        });
        return new AuthWitness(requestHash, fields.map(f => new Fr(f)));
      },
    };
  }
}
