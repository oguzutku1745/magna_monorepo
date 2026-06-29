import test from "node:test";
import assert from "node:assert/strict";
import { buildWalletSession } from "./lifecycle.js";

test("buildWalletSession keeps a preferred WebAuthn account active even when getAccounts only lists the fee payer", async () => {
  const session = await buildWalletSession(
    "passkey",
    "WebAuthn magna-user",
    {
      getAccounts: async () => [
        {
          alias: "local-test-0",
          item: {
            toString: () => "0xfee",
          },
        },
      ],
    } as never,
    async () => undefined,
    "0xpasskey",
  );

  assert.equal(session.activeAccount.address, "0xpasskey");
  assert.equal(session.activeAccount.alias, "WebAuthn magna-user");
  assert.deepEqual(
    session.accounts.map(account => account.address),
    ["0xfee", "0xpasskey"],
  );
});

test("buildWalletSession hides the fee payer from non-fee-payer passkey sessions", async () => {
  const session = await buildWalletSession(
    "passkey",
    "WebAuthn magna-user",
    {
      getAccounts: async () => [
        {
          alias: "local-test-0",
          item: {
            toString: () => "0xfee",
          },
        },
        {
          alias: "WebAuthn magna-user",
          item: {
            toString: () => "0xpasskey",
          },
        },
      ],
    } as never,
    async () => undefined,
    "0xpasskey",
    {
      feePayer: "0xfee",
    },
  );

  assert.equal(session.activeAccount.address, "0xpasskey");
  assert.deepEqual(
    session.accounts.map(account => account.address),
    ["0xpasskey"],
  );
});
