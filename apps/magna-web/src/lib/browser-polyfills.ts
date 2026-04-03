import { Buffer } from "buffer";

declare global {
  interface Window {
    Buffer?: typeof Buffer;
    global?: typeof globalThis;
    process?: {
      env: Record<string, string | undefined>;
    };
  }
}

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer;
}

if (!(globalThis as { global?: typeof globalThis }).global) {
  (globalThis as { global?: typeof globalThis }).global = globalThis;
}

if (!(globalThis as { process?: { env: Record<string, string | undefined> } }).process) {
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process = { env: {} };
}
