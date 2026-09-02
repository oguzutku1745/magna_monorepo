const BB_CRS_IDB_NAME = "keyval-store";
const BB_CRS_IDB_STORE = "keyval";
const BB_CRS_G1_KEY = "g1Data";
const CRS_PRIMARY_HOST = "https://crs.aztec-cdn.foundation";
const CRS_FALLBACK_HOST = "https://crs.aztec-labs.com";
const GRUMPKIN_SRS_SIZE = 2 ** 16;

type BarretenbergConstructor = typeof import("@aztec/bb.js").Barretenberg;
type BarretenbergInstance = Awaited<ReturnType<BarretenbergConstructor["new"]>>;

function isBrowserRuntime(): boolean {
  return typeof indexedDB !== "undefined";
}

function asUint8Array(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

/** Barretenberg runs in a Web Worker in browsers, so its exceptions can cross
 * a realm boundary or arrive as structured-cloned error-shaped objects. An
 * `instanceof Error` check alone is therefore not reliable here. */
export function isSrsPointsBufferError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
        ? error.message
        : String(error);
  return /SrsInit(?:Grumpkin)?Srs: invalid points_buf size/.test(message);
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

async function putCachedBbG1Data(value: Uint8Array): Promise<void> {
  const store = await openBbCrsStore("readwrite");
  await new Promise<void>((resolve, reject) => {
    const request = store.put(value, BB_CRS_G1_KEY);
    request.onerror = () => reject(request.error ?? new Error("Could not update Barretenberg CRS cache."));
    request.onsuccess = () => resolve();
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

/**
 * bb.js 5.x stores one origin-wide, uncompressed G1 buffer and reuses the
 * complete buffer for smaller circuits. The native initializer requires
 * exactly 32 or 64 bytes per requested point, so retain only the canonical
 * prefix needed by this wrapper before handing control to bb.js.
 */
export async function normalizeSharedBrowserG1Cache(srsSize: number): Promise<void> {
  if (!Number.isSafeInteger(srsSize) || srsSize <= 0) {
    throw new Error("Browser CRS size must be a positive safe integer.");
  }
  if (!isBrowserRuntime()) return;
  const cached = asUint8Array(await getCachedBbG1Data());
  if (!cached) return;

  const exactUncompressedLength = srsSize * 64;
  if (cached.byteLength === exactUncompressedLength) return;
  if (cached.byteLength > exactUncompressedLength && cached.byteLength % 64 === 0) {
    await putCachedBbG1Data(cached.slice(0, exactUncompressedLength));
    return;
  }
  if (cached.byteLength >= exactUncompressedLength) {
    await deleteCachedBbG1Data();
  }
}

async function fetchOfficialCrsFile(
  path: string,
  options: { exactBytes?: number; label: string },
): Promise<Uint8Array> {
  const failures: string[] = [];
  for (const host of [CRS_PRIMARY_HOST, CRS_FALLBACK_HOST]) {
    try {
      const headers = options.exactBytes === undefined
        ? undefined
        : { Range: `bytes=0-${options.exactBytes - 1}` };
      const response = await fetch(`${host}/${path}`, {
        ...(headers ? { headers } : {}),
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (options.exactBytes !== undefined && bytes.byteLength !== options.exactBytes) {
        throw new Error(`expected ${options.exactBytes} bytes, received ${bytes.byteLength}`);
      }
      if (bytes.byteLength === 0) {
        throw new Error("received an empty response");
      }
      return bytes;
    } catch (error) {
      failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not download exact ${options.label} data (${failures.join("; ")}).`);
}

async function createBarretenbergWithExactOfficialCrs(
  Barretenberg: BarretenbergConstructor,
  srsSize: number,
): Promise<BarretenbergInstance> {
  const api = await Barretenberg.new({ threads: 1, skipSrsInit: true });
  try {
    const [g1Data, g2Data, grumpkinG1Data] = await Promise.all([
      fetchOfficialCrsFile("g1_compressed.dat", {
        exactBytes: srsSize * 32,
        label: "BN254 G1 CRS",
      }),
      fetchOfficialCrsFile("g2.dat", { label: "BN254 G2 CRS" }),
      fetchOfficialCrsFile("grumpkin_g1_v2.dat", {
        exactBytes: GRUMPKIN_SRS_SIZE * 64,
        label: "Grumpkin G1 CRS",
      }),
    ]);

    const initialized = await api.srsInitSrs({
      pointsBuf: g1Data,
      numPoints: srsSize,
      g2Point: g2Data,
    });
    await api.srsInitGrumpkinSrs({
      pointsBuf: grumpkinG1Data,
      numPoints: GRUMPKIN_SRS_SIZE,
    });

    if (isBrowserRuntime() && initialized.pointsBuf.byteLength === srsSize * 64) {
      try {
        await putCachedBbG1Data(initialized.pointsBuf);
      } catch {
        // The exact CRS is already initialized; cache persistence is optional.
      }
    }
    return api;
  } catch (error) {
    try {
      await api.destroy();
    } catch {
      // Preserve the CRS initialization error, which is the actionable cause.
    }
    throw error;
  }
}

export async function createBrowserBarretenberg(
  Barretenberg: BarretenbergConstructor,
  srsSize: number,
): Promise<BarretenbergInstance> {
  try {
    await normalizeSharedBrowserG1Cache(srsSize);
  } catch {
    // The strict fallback below does not depend on IndexedDB being writable.
  }

  try {
    return await Barretenberg.new({ threads: 1, srsSize });
  } catch (error) {
    if (!isSrsPointsBufferError(error)) throw error;
    try {
      await deleteCachedBbG1Data();
    } catch {
      // The retry bypasses both the shared IndexedDB entry and HTTP cache.
    }
    return await createBarretenbergWithExactOfficialCrs(Barretenberg, srsSize);
  }
}
