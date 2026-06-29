import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { buildPassportWrapperInputs } from "./inputs.js";
import {
  normalizePublicFieldString,
  parsePassportWrapperPublicInputs,
} from "./public-inputs.js";
import type { PassportWrapperLocalWitness, PassportWrapperProofArtifact } from "./types.js";

const circuitArtifactUrl = new URL("../circuit/target/magna_passport_wrapper_proof.json", import.meta.url);
const BB_CRS_IDB_NAME = "keyval-store";
const BB_CRS_IDB_STORE = "keyval";
const BB_CRS_G1_KEY = "g1Data";
const BB_BROWSER_DEFAULT_SRS_SIZE = 2 ** 19;
const BB_BROWSER_IOS_SRS_SIZE = 2 ** 18;

async function loadBrowserPassportWrapperCircuitArtifact(): Promise<CompiledCircuit> {
  const response = await fetch(circuitArtifactUrl);
  if (!response.ok) {
    throw new Error(`Could not load passport wrapper circuit artifact: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as CompiledCircuit;
}

function isBrowserRuntime(): boolean {
  return typeof indexedDB !== "undefined";
}

function getBrowserSrsSize(): number {
  const userAgent =
    typeof self !== "undefined" && typeof self.navigator !== "undefined" ? self.navigator.userAgent : "";
  return /iPad|iPhone/.test(userAgent) ? BB_BROWSER_IOS_SRS_SIZE : BB_BROWSER_DEFAULT_SRS_SIZE;
}

function getByteLength(value: unknown): number | undefined {
  if (value instanceof ArrayBuffer) {
    return value.byteLength;
  }
  if (ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  return undefined;
}

function isSrsInvalidPointsBufferError(error: unknown): boolean {
  return error instanceof Error && /SrsInitSrs: invalid points_buf size/.test(error.message);
}

function isInvalidReusableG1CacheLength(byteLength: number, srsSize: number): boolean {
  if (byteLength < srsSize * 64) {
    return false;
  }
  const bytesPerPoint = byteLength / srsSize;
  return bytesPerPoint !== 32 && bytesPerPoint !== 64;
}

async function openBbCrsStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(BB_CRS_IDB_NAME);
    request.onerror = () => reject(request.error ?? new Error("Could not open Barretenberg CRS cache."));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BB_CRS_IDB_STORE)) {
        request.result.createObjectStore(BB_CRS_IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
  return db.transaction(BB_CRS_IDB_STORE, mode).objectStore(BB_CRS_IDB_STORE);
}

async function getCachedBbG1Data(): Promise<unknown> {
  const store = await openBbCrsStore("readonly");
  return await new Promise<unknown>((resolve, reject) => {
    const request = store.get(BB_CRS_G1_KEY);
    request.onerror = () => reject(request.error ?? new Error("Could not read Barretenberg CRS cache."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function deleteCachedBbG1Data(): Promise<void> {
  const store = await openBbCrsStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = store.delete(BB_CRS_G1_KEY);
    request.onerror = () => reject(request.error ?? new Error("Could not clear Barretenberg CRS cache."));
    request.onsuccess = () => resolve();
  });
}

async function clearInvalidBrowserBbCrsCache(): Promise<boolean> {
  if (!isBrowserRuntime()) {
    return false;
  }
  const cached = await getCachedBbG1Data();
  const byteLength = getByteLength(cached);
  if (byteLength === undefined || !isInvalidReusableG1CacheLength(byteLength, getBrowserSrsSize())) {
    return false;
  }
  await deleteCachedBbG1Data();
  return true;
}

async function createBrowserBarretenberg(
  Barretenberg: typeof import("@aztec/bb.js").Barretenberg,
): Promise<InstanceType<typeof Barretenberg>> {
  try {
    await clearInvalidBrowserBbCrsCache();
  } catch {
    // Cache cleanup is best-effort; Barretenberg can still initialize from a valid cache or the CDN.
  }

  try {
    const api = await Barretenberg.new({ threads: 1 });
    try {
      await clearInvalidBrowserBbCrsCache();
    } catch {
      // A failed post-init cleanup should not invalidate an already initialized local prover.
    }
    return api;
  } catch (error) {
    if (!isSrsInvalidPointsBufferError(error)) {
      throw error;
    }
    try {
      await deleteCachedBbG1Data();
    } catch {
      throw error;
    }
    const api = await Barretenberg.new({ threads: 1 });
    try {
      await clearInvalidBrowserBbCrsCache();
    } catch {
      // Keep the current proof attempt alive even if the stale-cache prevention cleanup fails.
    }
    return api;
  }
}

export async function provePassportWrapper(
  witness: PassportWrapperLocalWitness,
  options: { circuit?: CompiledCircuit } = {},
): Promise<PassportWrapperProofArtifact> {
  const circuit = options.circuit ?? (await loadBrowserPassportWrapperCircuitArtifact());
  const { Barretenberg, UltraHonkBackend } = await import("@aztec/bb.js");
  const { inputs, metadata } = await buildPassportWrapperInputs(witness);
  const noir = new Noir(circuit);
  const { witness: compressedWitness } = await noir.execute(inputs);
  const api = await createBrowserBarretenberg(Barretenberg);
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    const proof = await backend.generateProof(compressedWitness);
    const verified = await backend.verifyProof(proof);
    if (!verified) {
      throw new Error("Generated passport wrapper proof did not verify.");
    }
    const publicInputs = proof.publicInputs.map((entry, index) =>
      normalizePublicFieldString(String(entry), `publicInputs[${index}]`),
    );
    return {
      proof,
      publicInputs,
      outputs: parsePassportWrapperPublicInputs(publicInputs),
      metadata,
    };
  } finally {
    await api.destroy();
  }
}
