import test from "node:test";
import assert from "node:assert/strict";
import {
  LOCAL_PIPELINED_MIN_FEE_PADDING,
  buildWalletSession,
  configureLocalTestFeePadding,
} from "./lifecycle.js";

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

test("configureLocalTestFeePadding uses Aztec's pipelining-aware local setup padding", () => {
  let configuredPadding: number | undefined;
  const wallet = {
    setMinFeePadding(value?: number) {
      configuredPadding = value;
    },
  };

  configureLocalTestFeePadding(wallet as never);

  assert.equal(LOCAL_PIPELINED_MIN_FEE_PADDING, 30);
  assert.equal(configuredPadding, 30);
});
