import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MAGNA_ROOT_DS } from "./encoding.js";
import { deriveRootCommitment } from "./root.js";

describe("deriveRootCommitment", () => {
  it("derives a stable app-scoped root commitment", () => {
    const first = deriveRootCommitment({
      uniqueIdentifier: 0x0123456789abcdefn,
      domainSeparator: MAGNA_ROOT_DS,
    });
    const second = deriveRootCommitment({
      uniqueIdentifier: "0x0123456789abcdef",
      domainSeparator: MAGNA_ROOT_DS,
    });

    assert.equal(first, second);
  });

  it("changes when the unique identifier changes", () => {
    const first = deriveRootCommitment({
      uniqueIdentifier: 0x0123456789abcdefn,
      domainSeparator: MAGNA_ROOT_DS,
    });
    const second = deriveRootCommitment({
      uniqueIdentifier: 0x0123456789abcdf0n,
      domainSeparator: MAGNA_ROOT_DS,
    });

    assert.notEqual(first, second);
  });
});
