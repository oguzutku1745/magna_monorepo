import { randomUUID } from "node:crypto";

export type StoredSessionAssertion = { assertion: unknown; expiresAtMs: number };

const codes = new Map<string, StoredSessionAssertion>();
const TTL_MS = 60_000;

export function createSessionCode(assertion: unknown): string {
  const code = randomUUID().replace(/-/g, "");
  codes.set(code, { assertion, expiresAtMs: Date.now() + TTL_MS });
  return code;
}

export function exchangeSessionCode(code: string): unknown | null {
  const entry = codes.get(code);
  codes.delete(code);
  if (!entry || entry.expiresAtMs < Date.now()) return null;
  return entry.assertion;
}

export function clearSessionCodesForTest(): void {
  codes.clear();
}
