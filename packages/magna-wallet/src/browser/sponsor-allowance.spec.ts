import assert from "node:assert/strict";
import { test } from "node:test";
import type { AztecNode } from "@aztec-labs/aztec.js/node";
import { selectUnusedSponsorSlot, sendWithAvailableSponsorSlot, SponsorAllowanceExhaustedError } from "./sponsor-allowance.js";

const issuerAddress = "0x0111111111111111111111111111111111111111111111111111111111111111";
// Fixed vectors for revocation secret 77, Passport (1), claims 123, day 20000.
const slots = [
  "0x28a16dbecf86be9dc005c2c3b6bd62045c09eccda236e08561bbae0d5728691f",
  "0x059b47e9717aa39bb7e9c6d57ab0eadb720062345ac3ba704f181e6d460870e5",
  "0x003362f1cc2274b15b395d049b8ab948777116c1dd2b9b26987825fe949fd2e7",
  "0x232f1e169b623f1ce9715f13e944ca12d76af5adf087f35421e34c9ccbd7285f",
  "0x26174b8c7cee7bdc1fa6451ee8e8ae98d00ef74ed396553f4925a5e768784845",
];
function fixture(used: string[] = []) {
  const spent = new Set(used);
  let timestamp = 1_728_000_123n;
  const queriedBlocks: unknown[] = [];
  const node = {
    getBlockNumber: async () => 77,
    getBlockData: async () => ({ header: { globalVariables: { timestamp } } }),
    getNullifierMembershipWitness: async (block: unknown, hash: { toString(): string }) => {
      queriedBlocks.push(block);
      return spent.has(hash.toString()) ? { index: 1n } : undefined;
    },
  } as unknown as Pick<AztecNode, "getBlockNumber" | "getBlockData" | "getNullifierMembershipWitness">;
  const input = { node, issuerAddress, credentialType: 1, claimsHash: "123",
    hintedStatusNote: { note: { revocation_secret: 77n, credential_type: 1n, claims_hash: 123n } } };
  return { input, spent, queriedBlocks, advanceDay: () => { timestamp += 86_400n; } };
}
function collision(nullifier: string) {
  return new Error(`AVM simulation failed: [R_NULLIFIER_INSERTION] Nullifier collision: Attempted to emit duplicate siloed nullifier ${nullifier}`);
}

test("uses canonical spent state across repeated calls and fresh inputs", async () => {
  const { input, spent, queriedBlocks } = fixture();
  for (let expected = 0; expected < 5; expected++) {
    const selected = await selectUnusedSponsorSlot({ ...input });
    assert.equal(selected.slot, expected);
    assert.equal(selected.nullifier.toString(), slots[expected]);
    spent.add(selected.nullifier.toString());
  }
  assert.ok(queriedBlocks.every(block => block === 77), "pin membership checks to the timestamp's block");
});

test("exhaustion reports the credential and exact chain-day reset without sending", async () => {
  const { input } = fixture(slots);
  let sent = false;
  await assert.rejects(() => sendWithAvailableSponsorSlot(input, async () => { sent = true; }), error => {
    assert.ok(error instanceof SponsorAllowanceExhaustedError);
    assert.equal(error.resetsAt, 1_728_086_400n);
    assert.match(error.message, /Passport/);
    assert.match(error.message, /sponsored verification allowance/);
    assert.match(error.message, /Try again after/);
    assert.doesNotMatch(error.message, /reissue|refresh/i);
    return true;
  });
  assert.equal(sent, false);
});

test("resets at the next UTC chain day", async () => {
  const { input, advanceDay } = fixture(slots);
  await assert.rejects(() => selectUnusedSponsorSlot(input), SponsorAllowanceExhaustedError);
  advanceDay();
  assert.equal((await selectUnusedSponsorSlot(input)).slot, 0);
});

test("Passport and Instagram have independent allowances", async () => {
  const { input } = fixture(slots);
  const instagram = { ...input, credentialType: 3,
    hintedStatusNote: { note: { revocation_secret: 77n, credential_type: 3n, claims_hash: 123n } } };
  const selected = await selectUnusedSponsorSlot(instagram);
  assert.equal(selected.slot, 0);
  assert.equal(selected.nullifier.toString(), "0x2008bd78e460062f5990d80664502792d1fc207ba2664140b0537ae613135f12");
});

test("rechecks chain state when an exact selected-slot simulation collision occurs", async () => {
  const { input, spent } = fixture();
  const attempted: number[] = [];
  const receipt = await sendWithAvailableSponsorSlot(input, async slot => {
    attempted.push(slot);
    if (slot === 0) { spent.add(slots[0]); throw collision(slots[0]); }
    return "settled";
  });
  assert.equal(receipt, "settled");
  assert.deepEqual(attempted, [0, 1]);
});

test("a race consuming the last slot produces the allowance message", async () => {
  const { input, spent } = fixture(slots.slice(0, 4));
  await assert.rejects(() => sendWithAvailableSponsorSlot(input, async slot => {
    assert.equal(slot, 4);
    spent.add(slots[4]);
    throw collision(slots[4]);
  }), SponsorAllowanceExhaustedError);
});

test("bounds repeated pre-send races", async () => {
  const { input, spent } = fixture();
  let sends = 0;
  await assert.rejects(() => sendWithAvailableSponsorSlot(input, async slot => {
    sends++;
    spent.add(slots[slot]);
    throw collision(slots[slot]);
  }), SponsorAllowanceExhaustedError);
  assert.equal(sends, 5);
});

for (const scenario of ["unrelated", "unconfirmed", "timeout", "rejection"]) {
  test(`does not retry ${scenario} errors`, async () => {
    const { input, spent } = fixture();
    const error = scenario === "unrelated" ? collision("0x1234")
      : scenario === "unconfirmed" ? collision(slots[0])
      : scenario === "timeout" ? new Error("Timed out waiting for transaction receipt")
      : new Error(`Invalid tx: Duplicate nullifier ${slots[0]}`);
    let sends = 0;
    await assert.rejects(() => sendWithAvailableSponsorSlot(input, async () => {
      sends++;
      if (scenario !== "unconfirmed") spent.add(slots[0]);
      throw error;
    }), actual => actual === error);
    assert.equal(sends, 1);
  });
}

test("fails closed when chain queries fail", async () => {
  const { input } = fixture();
  input.node.getNullifierMembershipWitness = async () => { throw new Error("RPC unavailable"); };
  let sent = false;
  await assert.rejects(() => sendWithAvailableSponsorSlot(input, async () => { sent = true; }), /RPC unavailable/);
  assert.equal(sent, false);
});

test("rejects a status hint for a different credential", async () => {
  const { input } = fixture();
  await assert.rejects(() => selectUnusedSponsorSlot({ ...input, claimsHash: "456" }), /does not match/);
  await assert.rejects(() => selectUnusedSponsorSlot({ ...input, credentialType: 3 }), /does not match/);
});

test("preflight accounts for multiple checks using the same credential", async () => {
  const { input } = fixture(slots.slice(0, 4));
  const twoChecks = { ...input, requiredSlots: 2 };
  await assert.rejects(() => selectUnusedSponsorSlot(twoChecks), /not enough sponsored verification allowance/i);
});

test("uses the synced PXE anchor day when the proposed chain tip is ahead", async () => {
  const { input, advanceDay } = fixture([slots[0]]);
  advanceDay();
  const anchored = { ...input, getAnchorTimestamp: async () => 1_728_000_123n };
  const selected = await selectUnusedSponsorSlot(anchored);
  assert.equal(selected.slot, 1);
  assert.equal(selected.nullifier.toString(), slots[1]);
  assert.equal(selected.resetsAt, 1_728_086_400n);
});

for (const hasPxe of [true, false]) {
  test(`recovers from UTC rollover between selection and proving ${hasPxe ? "with" : "without"} a local PXE`, async () => {
    const { input, advanceDay, spent } = fixture();
    let anchor = 1_728_000_123n;
    const anchored = { ...input, ...(hasPxe ? { getAnchorTimestamp: async () => anchor } : {}) };
    const nextDaySlotZero = "0x0586d69f25e026115abb68b0b5ae753fd6a4b772ca347fa2c2dfd7676ec1587b";
    const attempted: number[] = [];
    const result = await sendWithAvailableSponsorSlot(anchored, async slot => {
      attempted.push(slot);
      if (attempted.length === 1) {
        advanceDay();
        anchor += 86_400n;
        spent.add(nextDaySlotZero);
        throw collision(nextDaySlotZero);
      }
      return "settled after rollover";
    });
    assert.equal(result, "settled after rollover");
    assert.deepEqual(attempted, [0, 1]);
  });
}
