import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateInstagramCircuitInputsFromVerifiedDkim,
  normalizeInstagramHandle,
  packInstagramHandle,
} from "./inputs.js";
import { instagramFixtureHandle, loadVerifiedInstagramFixture } from "./fixture-dkim.js";

const issuance = {
  handleBlind: 123456789n,
  expiryTs: 2_000_000_000n,
  activeOwner: 101n,
  issuerAddress: 202n,
  chainId: 31_337n,
};

describe("Instagram input generation", () => {
  it("normalizes handles", () => {
    assert.equal(normalizeInstagramHandle("@Akinspur"), "akinspur");
    assert.throws(() => normalizeInstagramHandle("bad handle"));
  });

  it("packs handles like Magna handle hashing expects", () => {
    assert.equal(packInstagramHandle("ab"), 0x6162n);
  });

  it("generates constrained inputs for the signed English Instagram ownership footer", async () => {
    const verifiedDkim = await loadVerifiedInstagramFixture();
    const result = generateInstagramCircuitInputsFromVerifiedDkim(verifiedDkim, instagramFixtureHandle, issuance);
    assert.equal(result.metadata.normalizedHandle, instagramFixtureHandle);
    assert.equal(result.metadata.template, "english");
    assert.equal(result.metadata.handleLen, instagramFixtureHandle.length);
    assert.equal(result.metadata.handlePacked, packInstagramHandle(instagramFixtureHandle));
    assert.equal(result.inputs.claimed_handle_len, String(instagramFixtureHandle.length));
    assert.ok(Number(result.inputs.prefix_index) >= 0);
    assert.ok(result.inputs.body);
    assert.equal("decoded_body" in result.inputs, false);
    assert.ok(result.inputs.partial_body_hash);
    assert.equal(result.inputs.handle_blind, issuance.handleBlind.toString());
    assert.equal(result.inputs.expiry_ts, issuance.expiryTs.toString());
    assert.equal(result.inputs.active_owner, issuance.activeOwner.toString());
    assert.equal(result.inputs.issuer_address, issuance.issuerAddress.toString());
    assert.equal(result.inputs.chain_id, issuance.chainId.toString());
  });

  it("rejects a claimed handle that is not in the signed body", async () => {
    const verifiedDkim = await loadVerifiedInstagramFixture();
    assert.throws(
      () => generateInstagramCircuitInputsFromVerifiedDkim(verifiedDkim, "differenthandle", issuance),
      /Could not find|does not contain/,
    );
  });

  it("fails closed on an unsupported DKIM preprocessing profile", async () => {
    const verifiedDkim = await loadVerifiedInstagramFixture();
    const unsupported = { ...verifiedDkim, format: "relaxed/relaxed" };
    assert.throws(
      () => generateInstagramCircuitInputsFromVerifiedDkim(unsupported, instagramFixtureHandle, issuance),
      /Unsupported Instagram DKIM canonicalization/,
    );
  });
});
