import test from "node:test";
import assert from "node:assert/strict";
import * as walletRoot from "../index.js";

test("debug sync helpers are not exported from the package root", () => {
  assert.equal((walletRoot as Record<string, unknown>).syncEmbeddedWalletPxeIfAvailable, undefined);
  assert.equal((walletRoot as Record<string, unknown>).syncPrivateStateForIssuer, undefined);
});


test("credential-derived key material is gone", async () => {
  const root = await import("../index.js");
  for (const banned of [
    "deriveValidSecp256r1PrivateKey",
    "derivePasskeyAccountMaterial",
    "createPasskeyWalletSession",
  ]) {
    assert.equal((root as Record<string, unknown>)[banned], undefined, banned);
  }
});
