import { createRequire } from "node:module";
import type { ProofData } from "@aztec/bb.js";
import { PASSPORT_A2_WRAPPER_SRS_SIZE } from "./types.js";

type BackendOptions = {
  backend?: import("@aztec/bb.js").BackendType;
  threads?: number;
  srsSize?: number;
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
  instantiate?: () => Promise<void>;
  generateProof(compressedWitness: Uint8Array): Promise<ProofData>;
  verifyProof(proof: ProofData): Promise<boolean>;
  destroy?: () => Promise<void>;
};

type UltraHonkBackendConstructor = new (
  acirBytecode: string,
  api?: unknown,
  circuitOptions?: CircuitOptions,
) => UltraHonkBackendInstance;

const require = createRequire(import.meta.url);

export async function createUltraHonkBackend(acirBytecode: string): Promise<UltraHonkBackendInstance> {
  // Match the Instagram proof package's CJS load path so bb.js resolves its WASM asset.
  const { BackendType, Barretenberg, UltraHonkBackend } = require("@aztec/bb.js") as {
    BackendType: typeof import("@aztec/bb.js").BackendType;
    Barretenberg: {
      "new": (options?: BackendOptions) => Promise<{ destroy(): Promise<void> }>;
    };
    UltraHonkBackend: UltraHonkBackendConstructor;
  };
  const api = await Barretenberg.new({
    // The Aztec V6 image sets BB_BINARY_PATH to its network BB6 binary.
    // Keep standalone Passport proofs on this package's BB5 WASM runtime.
    backend: BackendType.Wasm,
    threads: 1,
    srsSize: PASSPORT_A2_WRAPPER_SRS_SIZE,
  });
  const backend = new UltraHonkBackend(acirBytecode, api);
  return {
    generateProof: backend.generateProof.bind(backend),
    verifyProof: backend.verifyProof.bind(backend),
    destroy: () => api.destroy(),
  };
}
