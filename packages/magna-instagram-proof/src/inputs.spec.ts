import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateInstagramCircuitInputs,
  normalizeInstagramHandle,
  packInstagramHandle,
} from "./inputs.js";

const fixturePath = resolve(import.meta.dirname, "../fixtures/instagram-valid.eml");

describe("Instagram input generation", () => {
  it("normalizes handles", () => {
    assert.equal(normalizeInstagramHandle("@Akinspur"), "akinspur");
    assert.throws(() => normalizeInstagramHandle("bad handle"));
  });

  it("packs handles like Magna handle hashing expects", () => {
    assert.equal(packInstagramHandle("ab"), 0x6162n);
  });

  it("generates constrained inputs for an English Instagram email", async () => {
    const eml = readFileSync(fixturePath);
    const result = await generateInstagramCircuitInputs(eml, "akinspur");
    assert.equal(result.metadata.normalizedHandle, "akinspur");
    assert.equal(result.metadata.template, "english");
    assert.equal(result.metadata.handleLen, 8);
    assert.equal(result.metadata.handlePacked, 0x616b696e73707572n);
    assert.equal(result.inputs.claimed_handle_len, "8");
    assert.ok(Number(result.inputs.prefix_index) >= 0);
    assert.ok(result.inputs.body);
    assert.equal("decoded_body" in result.inputs, false);
    assert.ok(result.inputs.partial_body_hash);
  });

  it("rejects a claimed handle that is not in the signed body", async () => {
    const eml = readFileSync(fixturePath);
    await assert.rejects(
      () => generateInstagramCircuitInputs(eml, "differenthandle"),
      /Could not find|does not contain/,
    );
  });
});
