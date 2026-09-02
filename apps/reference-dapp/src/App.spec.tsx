import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppGate, Result } from "./App";

describe("Magna Social Instagram login surface", () => {
  it("requests an Instagram handle through Login with Magna without exposing issuance controls", () => {
    const html = renderToStaticMarkup(
      <AppGate login={{ status: "idle" }} handle="akinspur" setHandle={() => undefined} onLogin={() => undefined} />,
    );

    expect(html).toContain("Instagram handle ownership");
    expect(html).toContain('value="akinspur"');
    expect(html).toContain("Login with Magna");
    expect(html).not.toContain(".eml");
    expect(html).not.toContain("Issue Instagram credential");
  });

  it("renders the verified Instagram result returned by the wallet login flow", () => {
    const html = renderToStaticMarkup(
      <Result
        login={{
          status: "verified",
          instagramHandle: "akinspur",
          result: {
            verified: true,
            receipt: "0xpassport",
            receipts: [
              { id: "passport", kind: "policy", receipt: "0xpassport" },
              { id: "instagram", kind: "instagram-handle", receipt: "0xinstagram" },
            ],
          } as never,
        }}
      />,
    );

    expect(html).toContain("Verified @akinspur");
    expect(html).toContain("passport receipt: 0xpassport");
    expect(html).toContain("instagram receipt: 0xinstagram");
  });
});
