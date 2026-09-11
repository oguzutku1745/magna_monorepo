import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DkimVerifier } from "@zk-email/helpers/dist/lib/mailauth/dkim-verifier.js";
import { writeToStream } from "@zk-email/helpers/dist/lib/mailauth/tools.js";
import type { InstagramVerifiedDkim } from "./inputs.js";
import { normalizeInstagramHandle } from "./inputs.js";

const INSTAGRAM_DKIM_NAME = "s1024-2013-q3._domainkey.mail.instagram.com";

// Public DNS TXT record captured independently from Cloudflare DNS on 2026-08-30.
// Keeping it in the test makes the privately supplied real email fixture deterministic and
// prevents CI from silently switching to a rotated key or an external archive.
const INSTAGRAM_DKIM_RECORD =
  "k=rsa; t=s; h=sha256; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7twdVo+BW8Pv2poU5129KYmE6npHdxUU8fktUKTE9TNovCvLy5LVjYc3TQcUFjOH" +
  "VaZ89ZCjmpAcrA2QnTEKZ/2QWV56gn6bWdFW4SFxnQdHjguBZQykfKe5KTxy2a/OxuA0x2dHfdnYfw7RVzr4uednpKcWJy4Rl3gM6XB1zDwIDAQAB";

let verifiedFixturePromise: Promise<InstagramVerifiedDkim> | undefined;

export const instagramFixtureHandle = normalizeInstagramHandle(process.env.MAGNA_INSTAGRAM_TEST_HANDLE ?? "akinspur");

export function readInstagramFixture(): Buffer {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const fixturePath = process.env.MAGNA_INSTAGRAM_TEST_EMAIL_PATH
    ? resolve(process.env.MAGNA_INSTAGRAM_TEST_EMAIL_PATH)
    : resolve(sourceDirectory, "../../../.private-test-fixtures/instagram-valid.eml");
  if (!existsSync(fixturePath)) {
    throw new Error(
      "Real Instagram proof tests require a private email fixture. Set MAGNA_INSTAGRAM_TEST_EMAIL_PATH " +
      "to an absolute .eml path and MAGNA_INSTAGRAM_TEST_HANDLE to its handle, or use " +
      ".private-test-fixtures/instagram-valid.eml. See packages/magna-instagram-proof/fixtures/README.md. " +
      "No proof test is skipped or replaced with a mock.",
    );
  }
  return readFileSync(fixturePath);
}

export function loadVerifiedInstagramFixture(): Promise<InstagramVerifiedDkim> {
  verifiedFixturePromise ??= verifyPrivateFixture();
  return verifiedFixturePromise;
}

async function verifyPrivateFixture(): Promise<InstagramVerifiedDkim> {
  const rawEmail = readInstagramFixture();
  const verifier = new DkimVerifier({
    resolver: async (name: string, type: string) => {
      assert.equal(name, INSTAGRAM_DKIM_NAME);
      assert.equal(type, "TXT");
      return [INSTAGRAM_DKIM_RECORD];
    },
  });
  // helpers 6.4.2 accepts Buffer at runtime but its declaration incorrectly
  // intersects Buffer with the Node stream shape.
  await writeToStream(
    verifier,
    rawEmail as unknown as Parameters<typeof writeToStream>[1],
  );

  const result = verifier.results.find(
    (candidate) => candidate.signingDomain === "mail.instagram.com",
  );
  assert.ok(result, "Private Instagram fixture has no matching DKIM signature.");
  assert.equal(result.status?.result, "pass", result.status?.comment ?? "DKIM verification failed");
  assert.ok(Buffer.isBuffer(result.status.signedHeaders));
  assert.ok(Buffer.isBuffer(result.body));
  assert.equal(result.selector, "s1024-2013-q3");
  assert.equal(result.modulusLength, 1024);

  const jwk = createPublicKey(result.publicKey).export({ format: "jwk" });
  assert.equal(jwk.kty, "RSA");
  assert.ok(jwk.n);

  return {
    publicKey: BigInt(`0x${Buffer.from(jwk.n, "base64url").toString("hex")}`),
    signature: BigInt(`0x${Buffer.from(result.signature, "base64").toString("hex")}`),
    headers: result.status.signedHeaders,
    body: result.body,
    bodyHash: result.bodyHash,
    signingDomain: result.signingDomain,
    selector: result.selector,
    algo: result.algo,
    format: result.format,
    modulusLength: result.modulusLength,
  };
}
