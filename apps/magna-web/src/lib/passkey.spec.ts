import { describe, expect, it } from "vitest";
import { passkeyTestUtils } from "./passkey";

describe("passkey helpers", () => {
  it("encodes bytes as base64url strings", () => {
    const encoded = passkeyTestUtils.base64UrlEncode(new Uint8Array([251, 239, 255]));
    expect(encoded).toBe("--__");
  });
});
