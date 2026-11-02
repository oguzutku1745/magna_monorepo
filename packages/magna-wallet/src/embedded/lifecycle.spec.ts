import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureAccountManagerDeployed,
  LOCAL_PIPELINED_MIN_FEE_PADDING,
  buildWalletSession,
  configureLocalTestFeePadding,
} from "./lifecycle.js";
import { ContractInitializationStatus } from "@aztec-labs/aztec.js/wallet";
import { AztecAddress } from "@aztec-labs/aztec.js/addresses";

test("prepares an existing account's configuration notes before returning it for simulation", async () => {
  const address = AztecAddress.fromStringUnsafe(`0x${"11".repeat(32)}`);
  const events: string[] = [];
  const wallet = {
    getContractMetadata: async () => ({ initializationStatus: ContractInitializationStatus.INITIALIZED }),
    pxe: { debug: { getNotes: async (filter: any) => {
      assert.equal(filter.contractAddress.toString(), address.toString());
      assert.equal(filter.owner.toString(), address.toString());
      assert.deepEqual(filter.scopes.map(String), [address.toString()]);
      await Promise.resolve();
      events.push("configuration-discovered");
      return [{}];
    } } },
  };
  const result = await ensureAccountManagerDeployed(wallet as never, { address } as never);
  events.push("account-ready");
  assert.equal(result.isReady, true);
  assert.deepEqual(events, ["configuration-discovered", "account-ready"]);
});

test("does not read configuration notes for a counterfactual account without deployment funding", async () => {
  const wallet = {
    getContractMetadata: async () => ({ initializationStatus: ContractInitializationStatus.UNINITIALIZED }),
    pxe: { debug: { getNotes: async () => { throw Error("Account is not deployed"); } } },
  };
  const result = await ensureAccountManagerDeployed(wallet as never, { address: AztecAddress.ZERO } as never);
  assert.equal(result.isReady, false);
});

test("discovers configuration notes after deploying a new account", async () => {
  const address = AztecAddress.fromStringUnsafe(`0x${"11".repeat(32)}`);
  const events: string[] = [];
  const wallet = {
    getContractMetadata: async () => ({ initializationStatus: ContractInitializationStatus.UNINITIALIZED }),
    pxe: { debug: { getNotes: async () => {
      events.push("configuration-discovered");
      return [{}];
    } } },
  };
  const manager = {
    address,
    getDeployMethod: async () => ({ send: async () => { events.push("deployed"); } }),
  };
  const result = await ensureAccountManagerDeployed(wallet as never, manager as never, {
    fromAddress: AztecAddress.ZERO.toString(),
  });
  events.push("account-ready");
  assert.equal(result.isReady, true);
  assert.deepEqual(events, ["deployed", "configuration-discovered", "account-ready"]);
});

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
