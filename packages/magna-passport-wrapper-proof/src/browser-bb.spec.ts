import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { isSrsPointsBufferError, normalizeSharedBrowserG1Cache } from "./browser-bb.js";

describe("browser Barretenberg CRS recovery", () => {
  it("recognizes the serialized worker error emitted for an oversized shared CRS cache", () => {
    const workerError = {
      message: "SrsInitSrs: invalid points_buf size. Expected 32 or 64 bytes per point, got 128",
    };

    assert.equal(isSrsPointsBufferError(workerError), true);
  });

  it("recognizes the native Error form without classifying unrelated prover failures", () => {
    assert.equal(
      isSrsPointsBufferError(
        new Error("SrsInitGrumpkinSrs: invalid points_buf size. Expected 64 bytes per point, got 128"),
      ),
      true,
    );
    assert.equal(isSrsPointsBufferError(new Error("Recovery wrapper constraint failed")), false);
  });

  it("rejects invalid requested CRS sizes before touching browser storage", async () => {
    await assert.rejects(() => normalizeSharedBrowserG1Cache(0), /positive safe integer/);
    await assert.rejects(() => normalizeSharedBrowserG1Cache(Number.NaN), /positive safe integer/);
  });
});
