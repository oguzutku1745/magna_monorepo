import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { InputMap, InputValue } from "@noir-lang/types";
import { Noir } from "@noir-lang/noir_js";
import { instagramFixtureHandle, loadVerifiedInstagramFixture } from "./fixture-dkim.js";
import { generateInstagramCircuitInputsFromVerifiedDkim } from "./inputs.js";
import { loadInstagramCircuitArtifact } from "./prove.js";

type MutableBoundedVec = { storage: string[]; len: string };
type MutablePubkey = { modulus: string[]; redc: string[] };

function cloneInputs(inputs: InputMap): InputMap {
  return structuredClone(inputs) as InputMap;
}

function incrementField(value: InputValue): string {
  return (BigInt(String(value)) + 1n).toString();
}

describe("Instagram circuit dependency-diagnostic audit", () => {
  it("rejects or publicly binds mutations across every audited unsafe-witness boundary", async () => {
    const verifiedDkim = await loadVerifiedInstagramFixture();
    const { inputs } = generateInstagramCircuitInputsFromVerifiedDkim(verifiedDkim, instagramFixtureHandle, {
      handleBlind: 123456789n,
      expiryTs: 2_000_000_000n,
      activeOwner: 101n,
      issuerAddress: 202n,
      chainId: 31_337n,
    });
    const noir = new Noir(loadInstagramCircuitArtifact());

    const mutations: Array<[string, (candidate: InputMap) => void]> = [
      ["signed header", candidate => {
        const header = candidate.header as MutableBoundedVec;
        header.storage[0] = incrementField(header.storage[0]);
      }],
      ["DKIM signature", candidate => {
        const signature = candidate.signature as string[];
        signature[0] = incrementField(signature[0]);
      }],
      ["partial body hash", candidate => {
        const partialBodyHash = candidate.partial_body_hash as string[];
        partialBodyHash[0] = incrementField(partialBodyHash[0]);
      }],
      ["signed body", candidate => {
        const body = candidate.body as MutableBoundedVec;
        const handleIndex = Number(candidate.prefix_index) + 17;
        body.storage[handleIndex] = incrementField(body.storage[handleIndex]);
      }],
    ];

    for (const [name, mutate] of mutations) {
      const candidate = cloneInputs(inputs);
      mutate(candidate);
      await assert.rejects(noir.execute(candidate), `${name} mutation unexpectedly executed`);
    }

    // REDC is intentionally a prover input in zkemail.nr. Version 2 binds it
    // into the first public output alongside the modulus; Magna's API then
    // requires that combined commitment to be governed. A different REDC may
    // execute, but it must never retain the allowlisted key commitment.
    const baseline = await noir.execute(inputs);
    const redcMutation = cloneInputs(inputs);
    const pubkey = redcMutation.pubkey as MutablePubkey;
    pubkey.redc[0] = incrementField(pubkey.redc[0]);
    const mutated = await noir.execute(redcMutation);
    const baselineOutputs = baseline.returnValue as string[];
    const mutatedOutputs = mutated.returnValue as string[];
    assert.notEqual(mutatedOutputs[0], baselineOutputs[0], "REDC mutation retained the governed DKIM key commitment");
  });
});
