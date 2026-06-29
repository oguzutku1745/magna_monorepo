import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { RegistryClient } from "@zkpassport/registry";
import {
  NullifierType,
  getCertificateRegistryRootFromOuterProof,
  getCircuitRegistryRootFromOuterProof,
  getCurrentDateFromOuterProof,
  getNumberOfPublicInputs,
  getProofData,
  getScopeFromOuterProof,
  getScopeHash,
  getServiceScopeHash,
  getSubscopeFromOuterProof,
  getNullifierTypeFromOuterProof,
} from "@zkpassport/utils";

type ProofData = {
  proof: string[];
  publicInputs: string[];
};

type ZkPassportOuterProofRecord = {
  proof: string;
  name: string;
  version: string;
  vkeyHash: string;
};

type CircuitManifest = Record<string, unknown>;

type PackagedCircuit = {
  hash?: unknown;
  vkey_hash?: string | number | bigint;
  vkeyHash?: string | number | bigint;
  vkey: string;
};

type RegistryClientLike = {
  isCertificateRootValid(root: string, timestamp?: number): Promise<boolean>;
  isCircuitRootValid(root: string, timestamp?: number): Promise<boolean>;
  getCircuitManifest(
    root?: string,
    options?: { validate?: boolean; ipfs?: boolean; version?: string },
  ): Promise<CircuitManifest>;
  getPackagedCircuit(
    circuit: string,
    manifest: CircuitManifest,
    options?: { validate?: boolean; ipfs?: boolean },
  ): Promise<PackagedCircuit>;
};

type VerifyOuterProofInput = {
  proof: Uint8Array;
  publicInputs: string[];
  verificationKey: Uint8Array;
};

type ZkPassportEvmVerifierTarget = "evm" | "evm-no-zk";

type VerifyOuterProofOptions = {
  verifierTarget: ZkPassportEvmVerifierTarget;
};

type SdkCompatibleBb = {
  Barretenberg: {
    "new": (options?: { threads?: number; crsPath?: string }) => Promise<{ destroy(): Promise<void> }>;
  };
  UltraHonkVerifierBackend: new (api: unknown) => {
    verifyProof(proof: VerifyOuterProofInput, options?: VerifyOuterProofOptions): Promise<boolean>;
  };
};

export type VerifyZkPassportOuterEvmProofOptions = {
  proof: unknown;
  publicInputs: readonly string[];
  rpcUrl?: string;
  validityPeriodInSeconds?: number;
  domain?: string;
  scope?: string;
  devMode?: boolean;
  nowMs?: () => number;
  crsPath?: string;
  registryClient?: RegistryClientLike;
  verifyProof?: (input: VerifyOuterProofInput, options?: VerifyOuterProofOptions) => Promise<boolean>;
};

const DEFAULT_VALIDITY_SECONDS = 604800;
// zkPassport's `outer_evm` proof is the non-ZK keccak UltraHonk variant (it targets a
// gas-optimized on-chain Solidity verifier). Off-chain bb verification must therefore use
// "evm-no-zk" (disableZk: true); "evm" (disableZk: false) returns false for the same proof.
const OUTER_EVM_VERIFIER_OPTIONS = { verifierTarget: "evm-no-zk" } satisfies VerifyOuterProofOptions;
const requireFromHere = createRequire(import.meta.url);
const requireFromZkPassportSdk = createRequire(requireFromHere.resolve("@zkpassport/sdk"));

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireOuterProofRecord(value: unknown): ZkPassportOuterProofRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("zkPassport outer proof must be an object.");
  }
  const record = value as Record<string, unknown>;
  const proof = requireString(record.proof, "zkPassportOuterProof.proof");
  const name = requireString(record.name, "zkPassportOuterProof.name");
  const version = requireString(record.version, "zkPassportOuterProof.version");
  const vkeyHash = requireString(record.vkeyHash, "zkPassportOuterProof.vkeyHash");
  if (!name.startsWith("outer_evm")) {
    throw new Error("zkPassport outer proof must be an outer_evm proof.");
  }
  if ("committedInputs" in record) {
    throw new Error("zkPassport outer proof must not include committedInputs.");
  }
  return { proof, name, version, vkeyHash };
}

function strip0x(value: string): string {
  return value.replace(/^0x/i, "");
}

function normalizeProofHex(value: string): string {
  const proof = strip0x(value.trim());
  if (!proof) {
    throw new Error("zkPassportOuterProof.proof must not be empty.");
  }
  if (!/^[0-9a-fA-F]+$/.test(proof) || proof.length % 2 !== 0) {
    throw new Error("zkPassportOuterProof.proof must be an even-length hex string.");
  }
  return proof;
}

function normalizeField(value: string, label: string): string {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error("negative");
    }
    return parsed.toString();
  } catch {
    throw new Error(`${label} must be a decimal or 0x-prefixed field string.`);
  }
}

function assertPublicInputsMatch(supplied: readonly string[], derived: readonly string[]): void {
  if (supplied.length !== derived.length) {
    throw new Error("zkPassportOuterPublicInputs length must match derived outer proof public inputs.");
  }
  supplied.forEach((entry, index) => {
    const suppliedField = normalizeField(entry, `zkPassportOuterPublicInputs[${index}]`);
    const derivedField = normalizeField(derived[index], `derivedPublicInputs[${index}]`);
    if (suppliedField !== derivedField) {
      throw new Error(`zkPassportOuterPublicInputs[${index}] must match derived outer proof public inputs.`);
    }
  });
}

function normalizeHash(value: string | number | bigint, label: string): string {
  if (typeof value === "number" || typeof value === "bigint") {
    const hash = BigInt(value);
    if (hash < 0n) {
      throw new Error(`${label} must be a non-negative hash value.`);
    }
    return `0x${hash.toString(16).padStart(64, "0")}`;
  }
  const hash = strip0x(requireString(value, label));
  if (!/^[0-9a-fA-F]+$/.test(hash) || hash.length > 64) {
    throw new Error(`${label} must be a 0x-prefixed hash string.`);
  }
  return `0x${hash.toLowerCase().padStart(64, "0")}`;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function readManifestCircuitHash(manifest: CircuitManifest, circuitName: string): string | undefined {
  const circuits = optionalRecord(manifest.circuits);
  const circuit = optionalRecord(circuits?.[circuitName]);
  const hash = circuit?.hash ?? circuit?.vkey_hash ?? circuit?.vkeyHash;
  return typeof hash === "string" || typeof hash === "number" || typeof hash === "bigint"
    ? normalizeHash(hash, `circuit manifest hash for ${circuitName}`)
    : undefined;
}

function readPackagedCircuitHash(packagedCircuit: PackagedCircuit): string | undefined {
  const hash = packagedCircuit.vkey_hash ?? packagedCircuit.vkeyHash;
  return typeof hash === "string" || typeof hash === "number" || typeof hash === "bigint"
    ? normalizeHash(hash, "packaged circuit hash")
    : undefined;
}

function assertMatchingVkeyHash(actual: string | undefined, expected: string, label: string): void {
  if (actual && actual !== expected) {
    throw new Error(`${label} must match zkPassportOuterProof.vkeyHash.`);
  }
}

function fieldHex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function proofBytes(proofData: ProofData): Uint8Array {
  return Buffer.from(proofData.proof.join(""), "hex");
}

function todayStartMs(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
}

async function defaultVerifyProof(
  input: VerifyOuterProofInput,
  crsPath?: string,
  options: VerifyOuterProofOptions = OUTER_EVM_VERIFIER_OPTIONS,
): Promise<boolean> {
  const { Barretenberg, UltraHonkVerifierBackend } = requireFromZkPassportSdk("@aztec/bb.js") as SdkCompatibleBb;
  const api = await Barretenberg.new({ threads: 1, crsPath });
  try {
    const verifier = new UltraHonkVerifierBackend(api);
    return await verifier.verifyProof(input, options);
  } finally {
    await api.destroy();
  }
}

function createRegistryClient(options: VerifyZkPassportOuterEvmProofOptions): RegistryClientLike {
  if (!options.rpcUrl) {
    throw new Error("MAGNA_ZKPASSPORT_EVM_RPC_URL is required for Passport A1 outer proof verification.");
  }
  return new RegistryClient({
    chainId: options.devMode ? 11155111 : 1,
    rpcUrl: options.rpcUrl,
  });
}

async function assertOuterPublicInputPolicy(
  proofData: ProofData,
  options: VerifyZkPassportOuterEvmProofOptions,
  registryClient: RegistryClientLike,
): Promise<{ circuitRoot: string }> {
  const certificateRoot = fieldHex(getCertificateRegistryRootFromOuterProof(proofData));
  const circuitRoot = fieldHex(getCircuitRegistryRootFromOuterProof(proofData));
  const [certificateRootValid, circuitRootValid] = await Promise.all([
    registryClient.isCertificateRootValid(certificateRoot),
    registryClient.isCircuitRootValid(circuitRoot),
  ]);
  if (!certificateRootValid) {
    throw new Error("zkPassport certificate registry root is not valid.");
  }
  if (!circuitRootValid) {
    throw new Error("zkPassport circuit registry root is not valid.");
  }

  if (options.domain && getServiceScopeHash(options.domain) !== getScopeFromOuterProof(proofData)) {
    throw new Error("zkPassport outer proof domain scope does not match the configured domain.");
  }
  if (options.scope && getScopeHash(options.scope) !== getSubscopeFromOuterProof(proofData)) {
    throw new Error("zkPassport outer proof request scope does not match the configured scope.");
  }

  const currentDate = getCurrentDateFromOuterProof(proofData);
  const validityMs = (options.validityPeriodInSeconds ?? DEFAULT_VALIDITY_SECONDS) * 1000;
  const proofAgeMs = todayStartMs(options.nowMs?.() ?? Date.now()) - currentDate.getTime();
  if (proofAgeMs >= validityMs) {
    throw new Error("zkPassport outer proof date is outside the configured validity window.");
  }

  const nullifierType = getNullifierTypeFromOuterProof(proofData);
  if (
    !options.devMode &&
    (nullifierType === NullifierType.NON_SALTED_MOCK || nullifierType === NullifierType.SALTED_MOCK)
  ) {
    throw new Error("zkPassport mock passport proofs are only accepted when dev mode is enabled.");
  }

  return { circuitRoot };
}

export function deriveZkPassportOuterProofData(proof: unknown): {
  proofRecord: ZkPassportOuterProofRecord;
  proofData: ProofData;
} {
  const proofRecord = requireOuterProofRecord(proof);
  const proofData = getProofData(normalizeProofHex(proofRecord.proof), getNumberOfPublicInputs(proofRecord.name));
  return { proofRecord, proofData };
}

export async function verifyZkPassportOuterEvmProof(
  options: VerifyZkPassportOuterEvmProofOptions,
): Promise<boolean> {
  const registryClient = options.registryClient ?? createRegistryClient(options);
  const { proofRecord, proofData } = deriveZkPassportOuterProofData(options.proof);
  assertPublicInputsMatch(options.publicInputs, proofData.publicInputs);
  const proofVkeyHash = normalizeHash(proofRecord.vkeyHash, "zkPassportOuterProof.vkeyHash");

  const { circuitRoot } = await assertOuterPublicInputPolicy(proofData, options, registryClient);
  const manifest = await registryClient.getCircuitManifest(circuitRoot, { validate: true });
  assertMatchingVkeyHash(readManifestCircuitHash(manifest, proofRecord.name), proofVkeyHash, "Circuit manifest hash");
  const packagedCircuit = await registryClient.getPackagedCircuit(proofRecord.name, manifest, {
    validate: false,
  });
  assertMatchingVkeyHash(readPackagedCircuitHash(packagedCircuit), proofVkeyHash, "Packaged circuit hash");
  const verificationKey = Buffer.from(packagedCircuit.vkey, "base64");
  const verifier =
    options.verifyProof ??
    ((input, verifierOptions) => defaultVerifyProof(input, options.crsPath ?? "/tmp/.bb-crs", verifierOptions));

  const verified = await verifier(
    {
      proof: proofBytes(proofData),
      publicInputs: proofData.publicInputs,
      verificationKey,
    },
    OUTER_EVM_VERIFIER_OPTIONS,
  );
  if (!verified) {
    throw new Error(
      [
        "zkPassport outer_evm raw bb verifier returned false",
        `name=${proofRecord.name}`,
        `version=${proofRecord.version}`,
        `vkeyHash=${proofVkeyHash}`,
        `publicInputs=${proofData.publicInputs.length}`,
        `proofFields=${proofData.proof.length}`,
        `verificationKeyBytes=${verificationKey.byteLength}`,
        `circuitRoot=0x${circuitRoot}`,
      ].join("; "),
    );
  }
  return true;
}
