import { describe, expect, it, vi } from "vitest";
import {
  loginWithMagnaExample,
  loginWithMagnaSocial,
  magnaSocialRequirements,
  passportAdultUsPolicy,
  unlockAppIfVerified,
} from "./login-with-magna";

describe("reference dApp Login with Magna boundary", () => {
  it("submits only the existing passport policy without an A2 proof payload", async () => {
    const result = { verified: true, receipt: "0xreceipt" } as never;
    const login = vi.fn(async (_policy: unknown) => result);
    await expect(loginWithMagnaExample({ login } as never)).resolves.toBe(result);
    expect(login).toHaveBeenCalledWith(passportAdultUsPolicy());
    const serializedPolicy = JSON.stringify(login.mock.calls[0][0], (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serializedPolicy).not.toContain("passport-a2-v1");
    expect(serializedPolicy).not.toContain("wrapperProof");
  });

  it("preserves the combined passport and Instagram requirements", async () => {
    const result = { verified: true, receipts: [] } as never;
    const loginWithRequirements = vi.fn(async (_requirements: unknown) => result);
    await expect(loginWithMagnaSocial("akinspur", { loginWithRequirements } as never)).resolves.toBe(result);
    expect(loginWithRequirements).toHaveBeenCalledWith(magnaSocialRequirements("akinspur"));
  });

  it("unlocks only verified results", () => {
    const unlock = vi.fn();
    expect(unlockAppIfVerified({ verified: false } as never, unlock)).toBe(false);
    expect(unlock).not.toHaveBeenCalled();
    expect(unlockAppIfVerified({ verified: true } as never, unlock)).toBe(true);
    expect(unlock).toHaveBeenCalledOnce();
  });
});
