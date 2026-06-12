import test from "node:test";
import assert from "node:assert/strict";
import * as walletRoot from "../index.js";

test("debug sync helpers are not exported from the package root", () => {
  assert.equal((walletRoot as Record<string, unknown>).syncEmbeddedWalletPxeIfAvailable, undefined);
  assert.equal((walletRoot as Record<string, unknown>).syncPrivateStateForIssuer, undefined);
});
