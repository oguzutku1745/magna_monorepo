import { createRequire } from "node:module";
import type { ProofData } from "@aztec/bb.js";

type BackendOptions = {
  threads?: number;
  memory?: {
    initial?: number;
    maximum?: number;
  };
  crsPath?: string;
};

type CircuitOptions = {
  recursive: boolean;
};

export type UltraHonkBackendInstance = {
  instantiate(): Promise<void>;
  generateProof(compressedWitness: Uint8Array): Promise<ProofData>;
  verifyProof(proof: ProofData): Promise<boolean>;
  destroy(): Promise<void>;
};

type UltraHonkBackendConstructor = new (
  acirBytecode: string,
  backendOptions?: BackendOptions,
  circuitOptions?: CircuitOptions,
) => UltraHonkBackendInstance;

const require = createRequire(import.meta.url);

export function createUltraHonkBackend(acirBytecode: string): UltraHonkBackendInstance {
  // The ESM bb.js entry resolves its bundled WASM relative to process.cwd().
  // Loading the CJS export gives bb.js a real __dirname and resolves the packaged asset.
  const { UltraHonkBackend } = require("@aztec/bb.js") as {
    UltraHonkBackend: UltraHonkBackendConstructor;
  };
  return new UltraHonkBackend(acirBytecode);
}
