import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StoredWebAuthnAccount } from "@magna/wallet";
import { AuthorizeWalletPicker, authorizeWalletsForOrigin } from "./AuthorizeWalletPicker";

function account(overrides: Partial<StoredWebAuthnAccount> = {}): StoredWebAuthnAccount {
  return {
    credentialId: overrides.credentialId ?? "credential-a",
    publicKeyX: "11".repeat(32),
    publicKeyY: "22".repeat(32),
    rpIdHash: "33".repeat(32),
    rpId: overrides.rpId ?? "localhost",
    origin: overrides.origin ?? "http://localhost:5174",
    address: overrides.address ?? "0x1234",
    displayName: overrides.displayName ?? "Magna wallet · primary",
    walletMaterialSource: "webauthn-prf",
  };
}

describe("AuthorizeWalletPicker", () => {
  it("only offers wallets registered for the exact wallet origin", () => {
    const primary = account();
    const wrongOrigin = account({ credentialId: "credential-b", origin: "https://wallet.example" });
    const wrongRp = account({ credentialId: "credential-c", rpId: "wallet.example" });

    expect(
      authorizeWalletsForOrigin(
        [primary, wrongOrigin, wrongRp],
        "localhost",
        "http://localhost:5174",
      ),
    ).toEqual([primary]);
  });

  it("renders distinct names and addresses for explicit selection", () => {
    const html = renderToStaticMarkup(
      <AuthorizeWalletPicker
        accounts={[
          account(),
          account({
            credentialId: "credential-recovery",
            address: "0x5678",
            displayName: "Magna recovery · recovered",
          }),
        ]}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("Magna wallet · primary");
    expect(html).toContain("0x1234");
    expect(html).toContain("Magna recovery · recovered");
    expect(html).toContain("0x5678");
  });
});
