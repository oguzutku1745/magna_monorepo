import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { getScopeHash, getServiceScopeHash } from "@zkpassport/utils";
import {
  deriveZkPassportOuterProofData,
  verifyZkPassportOuterEvmProof,
  type VerifyZkPassportOuterEvmProofOptions,
} from "./zkpassport-evm.js";

function fieldHex(value: string | number | bigint): string {
  return BigInt(value).toString(16).padStart(64, "0");
}

function packedOuterProof(publicInputs: readonly (string | number | bigint)[]): string {
  return [...publicInputs.map(fieldHex), "aa".repeat(32), "bb".repeat(32)].join("");
}

function proofFor(publicInputs: readonly (string | number | bigint)[]) {
  return {
    proof: packedOuterProof(publicInputs),
    name: "outer_evm_5",
    version: "0.15.1",
    vkeyHash: "0x1234",
  };
}

function registryClient(overrides: Partial<VerifyZkPassportOuterEvmProofOptions["registryClient"]> = {}) {
  return {
    isCertificateRootValid: async () => true,
    isCircuitRootValid: async () => true,
    getCircuitManifest: async () => ({ root: "manifest-root", circuits: { outer_evm_5: { hash: "0x1234" } } }),
    getPackagedCircuit: async () => ({
      hash: 999,
      vkey_hash: "0x1234",
      vkey: Buffer.from("verification-key").toString("base64"),
    }),
    ...overrides,
  } satisfies NonNullable<VerifyZkPassportOuterEvmProofOptions["registryClient"]>;
}

describe("deriveZkPassportOuterProofData", () => {
  it("derives public inputs from a packed outer EVM proof", () => {
    const publicInputs = ["11", "22", "1700000000", "33", "44", "555", "666", "1", "999", "1000"];
    const { proofRecord, proofData } = deriveZkPassportOuterProofData(proofFor(publicInputs));

    assert.equal(proofRecord.name, "outer_evm_5");
    assert.deepEqual(proofData.publicInputs, publicInputs.map(value => `0x${fieldHex(value)}`));
    assert.equal(proofData.proof.length, 2);
  });

  it("rejects missing safe SDK metadata and non-hex proof bytes", () => {
    assert.throws(
      () => deriveZkPassportOuterProofData({ proof: packedOuterProof(["0", "1"]), name: "outer_evm_5", version: "0.15.1" }),
      /vkeyHash must be a non-empty string/,
    );
    assert.throws(
      () =>
        deriveZkPassportOuterProofData({
          proof: "not-hex",
          name: "outer_evm_5",
          version: "0.15.1",
          vkeyHash: "0x1234",
        }),
      /must be an even-length hex string/,
    );
  });
});

describe("verifyZkPassportOuterEvmProof", () => {
  it("validates roots, fetches the registry vkey, and verifies without committedInputs", async () => {
    const publicInputs = ["11", "22", "1700000000", "33", "44", "555", "666", "1", "999", "1000"];
    const calls: string[] = [];
    let verifierInput: { publicInputs: string[]; verificationKey: Uint8Array } | undefined;
    let verifierOptions: unknown;
    const result = await verifyZkPassportOuterEvmProof({
      proof: proofFor(publicInputs),
      publicInputs,
      registryClient: registryClient({
        isCertificateRootValid: async root => {
          calls.push(`cert:${root}`);
          return true;
        },
        isCircuitRootValid: async root => {
          calls.push(`circuit:${root}`);
          return true;
        },
        getCircuitManifest: async root => {
          calls.push(`manifest:${root}`);
          return { root, circuits: { outer_evm_5: { hash: "0x1234" } } };
        },
        getPackagedCircuit: async (name, _manifest, options) => {
          calls.push(`circuit-name:${name}:validate=${options?.validate === true}`);
          return { hash: 999, vkey_hash: "0x1234", vkey: Buffer.from("verification-key").toString("base64") };
        },
      }),
      nowMs: () => 1_700_000_000_000,
      verifyProof: async (input, options) => {
        verifierInput = input;
        verifierOptions = options;
        return true;
      },
    });

    assert.equal(result, true);
    assert.deepEqual(calls, [
      `cert:${fieldHex(11)}`,
      `circuit:${fieldHex(22)}`,
      `manifest:${fieldHex(22)}`,
      "circuit-name:outer_evm_5:validate=false",
    ]);
    assert.deepEqual(verifierInput?.publicInputs, publicInputs.map(value => `0x${fieldHex(value)}`));
    assert.deepEqual(Array.from(verifierInput?.verificationKey ?? []), Array.from(Buffer.from("verification-key")));
    assert.deepEqual(verifierOptions, { verifierTarget: "evm-no-zk" });
  });

  it("rejects manifest vkey hashes that do not match the proof metadata", async () => {
    const publicInputs = ["11", "22", "1700000000", "33", "44", "555", "666", "1", "999", "1000"];

    await assert.rejects(
      () =>
        verifyZkPassportOuterEvmProof({
          proof: proofFor(publicInputs),
          publicInputs,
          registryClient: registryClient({
            getCircuitManifest: async () => ({ circuits: { outer_evm_5: { hash: "0xabcd" } } }),
          }),
          nowMs: () => 1_700_000_000_000,
          verifyProof: async () => true,
        }),
      /Circuit manifest hash must match zkPassportOuterProof\.vkeyHash/,
    );
  });

  it("throws a diagnostic when the raw bb verifier returns false", async () => {
    const publicInputs = ["11", "22", "1700000000", "33", "44", "555", "666", "1", "999", "1000"];

    await assert.rejects(
      () =>
        verifyZkPassportOuterEvmProof({
          proof: proofFor(publicInputs),
          publicInputs,
          registryClient: registryClient(),
          nowMs: () => 1_700_000_000_000,
          verifyProof: async () => false,
        }),
      /outer_evm raw bb verifier returned false; name=outer_evm_5; version=0\.15\.1/,
    );
  });

  it("rejects supplied public inputs that do not match the packed proof", async () => {
    const publicInputs = ["11", "22", "1700000000", "33", "44", "555", "666", "1", "999", "1000"];

    await assert.rejects(
      () =>
        verifyZkPassportOuterEvmProof({
          proof: proofFor(publicInputs),
          publicInputs: [...publicInputs.slice(0, -1), "9999"],
          registryClient: registryClient(),
          nowMs: () => 1_700_000_000_000,
          verifyProof: async () => true,
        }),
      /must match derived outer proof public inputs/,
    );
  });

  it("rejects invalid registry roots and stale proof dates", async () => {
    const publicInputs = ["11", "22", "1700000000", "33", "44", "555", "666", "1", "999", "1000"];

    await assert.rejects(
      () =>
        verifyZkPassportOuterEvmProof({
          proof: proofFor(publicInputs),
          publicInputs,
          registryClient: registryClient({ isCertificateRootValid: async () => false }),
          nowMs: () => 1_700_000_000_000,
          verifyProof: async () => true,
        }),
      /certificate registry root is not valid/,
    );

    await assert.rejects(
      () =>
        verifyZkPassportOuterEvmProof({
          proof: proofFor(publicInputs),
          publicInputs,
          registryClient: registryClient(),
          validityPeriodInSeconds: 1,
          nowMs: () => 1_700_086_400_000,
          verifyProof: async () => true,
        }),
      /outside the configured validity window/,
    );
  });

  it("rejects wrong domain/scope and mock nullifiers outside dev mode", async () => {
    const scopedInputs = [
      "11",
      "22",
      "1700000000",
      getServiceScopeHash("localhost").toString(),
      getScopeHash("magna-passport-onboarding").toString(),
      "555",
      "666",
      "1",
      "999",
      "1000",
    ];
    await assert.rejects(
      () =>
        verifyZkPassportOuterEvmProof({
          proof: proofFor(scopedInputs),
          publicInputs: scopedInputs,
          registryClient: registryClient(),
          domain: "example.com",
          scope: "magna-passport-onboarding",
          nowMs: () => 1_700_000_000_000,
          verifyProof: async () => true,
        }),
      /domain scope does not match/,
    );

    const mockNullifierInputs = [...scopedInputs];
    mockNullifierInputs[7] = "2";
    await assert.rejects(
      () =>
        verifyZkPassportOuterEvmProof({
          proof: proofFor(mockNullifierInputs),
          publicInputs: mockNullifierInputs,
          registryClient: registryClient(),
          domain: "localhost",
          scope: "magna-passport-onboarding",
          nowMs: () => 1_700_000_000_000,
          verifyProof: async () => true,
        }),
      /mock passport proofs are only accepted when dev mode is enabled/,
    );

    await assert.doesNotReject(() =>
      verifyZkPassportOuterEvmProof({
        proof: proofFor(mockNullifierInputs),
        publicInputs: mockNullifierInputs,
        registryClient: registryClient(),
        domain: "localhost",
        scope: "magna-passport-onboarding",
        devMode: true,
        nowMs: () => 1_700_000_000_000,
        verifyProof: async () => true,
      }),
    );
  });
});
