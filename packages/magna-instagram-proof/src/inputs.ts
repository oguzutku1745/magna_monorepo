import {
  generateEmailVerifierInputsFromDKIMResult,
  verifyDKIMSignature,
} from "@zk-email/zkemail-nr";
import type { InputValue } from "@noir-lang/types";
import {
  INSTAGRAM_TEMPLATE,
  MAX_INSTAGRAM_HANDLE_LENGTH,
  type GenerateInstagramInputsResult,
  type InstagramIssuanceContext,
  type InstagramTemplateName,
} from "./types.js";

const textEncoder = new TextEncoder();

const CIRCUIT_PARAMS = {
  maxHeadersLength: 1024,
  maxBodyLength: 1024,
  extractFrom: true,
} as const;

const TEMPLATE_PREFIX: Record<InstagramTemplateName, string> = {
  english: "and intended for ",
};

const ZKEMAIL_DKIM_RESOLVER_MISMATCH =
  "DKIM record mismatch between Google and Cloudflare! Using Google result.";

const SUPPORTED_DKIM_SIGNING_DOMAIN = "mail.instagram.com";
const SUPPORTED_DKIM_ALGORITHM = "rsa-sha256";
const SUPPORTED_DKIM_CANONICALIZATION = "relaxed/simple";
const SUPPORTED_DKIM_MODULUS_BITS = 1024;

export type InstagramVerifiedDkim = Parameters<
  typeof generateEmailVerifierInputsFromDKIMResult
>[0];

function assertSupportedInstagramDkimProfile(verifiedDkim: InstagramVerifiedDkim): void {
  if (verifiedDkim.signingDomain !== SUPPORTED_DKIM_SIGNING_DOMAIN) {
    throw new Error(`Unsupported Instagram DKIM signing domain: ${verifiedDkim.signingDomain}.`);
  }
  if (verifiedDkim.algo !== SUPPORTED_DKIM_ALGORITHM) {
    throw new Error(`Unsupported Instagram DKIM algorithm: ${verifiedDkim.algo}.`);
  }
  if (verifiedDkim.format !== SUPPORTED_DKIM_CANONICALIZATION) {
    throw new Error(`Unsupported Instagram DKIM canonicalization: ${verifiedDkim.format}.`);
  }
  if (verifiedDkim.modulusLength !== SUPPORTED_DKIM_MODULUS_BITS) {
    throw new Error(`Unsupported Instagram DKIM modulus length: ${verifiedDkim.modulusLength}.`);
  }
}

export function normalizeInstagramHandle(value: string): string {
  const normalized = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(normalized)) {
    throw new Error("Instagram handle must be 1-30 characters and use only a-z, 0-9, dots, or underscores.");
  }
  return normalized;
}

export function packInstagramHandle(handle: string): bigint {
  const bytes = textEncoder.encode(handle);
  if (bytes.length > MAX_INSTAGRAM_HANDLE_LENGTH) {
    throw new Error("Instagram handle is too long.");
  }
  let packed = 0n;
  for (const byte of bytes) {
    packed = (packed << 8n) | BigInt(byte);
  }
  return packed;
}

function handleBytesForCircuit(handle: string): number[] {
  const bytes = Array.from(textEncoder.encode(handle));
  if (bytes.length > MAX_INSTAGRAM_HANDLE_LENGTH) {
    throw new Error("Instagram handle is too long.");
  }
  return bytes.concat(Array.from({ length: MAX_INSTAGRAM_HANDLE_LENGTH - bytes.length }, () => 0));
}

function boundedVecToUtf8(value: unknown, fieldName: string): string {
  if (!value || typeof value !== "object") {
    throw new Error(`${fieldName} is missing from zkEmail inputs.`);
  }
  const storage = (value as { storage?: unknown }).storage;
  const len = (value as { len?: unknown }).len;
  if (!Array.isArray(storage)) {
    throw new Error(`${fieldName}.storage must be an array.`);
  }
  const length = typeof len === "string" ? Number.parseInt(len, 10) : Number(len);
  if (!Number.isInteger(length) || length < 0 || length > storage.length) {
    throw new Error(`${fieldName}.len is invalid.`);
  }
  return Buffer.from(storage.slice(0, length).map((byte) => Number(byte))).toString("utf8");
}

function padBoundedVecStorage(
  value: unknown,
  expectedLength: number,
  fieldName: string,
): InputValue {
  if (!value || typeof value !== "object") {
    throw new Error(`${fieldName} is missing from zkEmail inputs.`);
  }
  const boundedVec = value as { storage?: unknown; len?: unknown };
  if (!Array.isArray(boundedVec.storage)) {
    throw new Error(`${fieldName}.storage must be an array.`);
  }
  if (boundedVec.storage.length > expectedLength) {
    throw new Error(`${fieldName}.storage exceeds circuit maximum length.`);
  }
  return {
    ...boundedVec,
    storage: boundedVec.storage.concat(
      Array.from({ length: expectedLength - boundedVec.storage.length }, () => "0"),
    ),
  } as InputValue;
}

function chooseTemplate(rawEmail: Buffer | string, handle: string): {
  template: InstagramTemplateName;
  selector: string;
} {
  const raw = Buffer.isBuffer(rawEmail) ? rawEmail.toString("utf8") : rawEmail;
  for (const template of Object.keys(TEMPLATE_PREFIX) as InstagramTemplateName[]) {
    const ownershipFooter = `${TEMPLATE_PREFIX[template]}${handle}.`;
    if (raw.includes(ownershipFooter)) {
      return { template, selector: TEMPLATE_PREFIX[template] };
    }
  }
  throw new Error("Could not find a supported Instagram ownership footer in the signed email body.");
}

function findPrefixIndex(signedBody: string, template: InstagramTemplateName, handle: string): number {
  const expectedFooter = `${TEMPLATE_PREFIX[template]}${handle}.`;
  const index = signedBody.indexOf(expectedFooter);
  if (index < 0) {
    throw new Error(`Signed email body does not contain expected Instagram ownership footer: ${expectedFooter}`);
  }
  return index;
}

async function withoutKnownZkEmailResolverNoise<T>(callback: () => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (args.length === 1 && args[0] === ZKEMAIL_DKIM_RESOLVER_MISMATCH) {
      return;
    }
    originalConsoleError(...args);
  };
  try {
    return await callback();
  } finally {
    console.error = originalConsoleError;
  }
}

export async function generateInstagramCircuitInputs(
  rawEmail: Buffer | string,
  claimedHandle: string,
  issuance: InstagramIssuanceContext,
): Promise<GenerateInstagramInputsResult> {
  const verifiedDkim = await withoutKnownZkEmailResolverNoise(() =>
    verifyDKIMSignature(rawEmail, undefined, undefined, true),
  );
  return generateInstagramCircuitInputsFromVerifiedDkim(verifiedDkim, claimedHandle, issuance);
}

export function generateInstagramCircuitInputsFromVerifiedDkim(
  verifiedDkim: InstagramVerifiedDkim,
  claimedHandle: string,
  issuance: InstagramIssuanceContext,
): GenerateInstagramInputsResult {
  // This protects the supported client lane from silently changing how the
  // signed message is canonicalized. The circuit/API security boundary is the
  // proof-bound, governed modulus+REDC hash; this profile check is an additional
  // fail-closed integration invariant, not a substitute for that allowlist.
  assertSupportedInstagramDkimProfile(verifiedDkim);
  const normalizedHandle = normalizeInstagramHandle(claimedHandle);
  const { template, selector } = chooseTemplate(verifiedDkim.body, normalizedHandle);
  const inputs = generateEmailVerifierInputsFromDKIMResult(verifiedDkim, {
    ...CIRCUIT_PARAMS,
    shaPrecomputeSelector: selector,
  });

  const signedBody = boundedVecToUtf8(inputs.body, "body");
  const prefixIndex = findPrefixIndex(signedBody, template, normalizedHandle);
  const handlePacked = packInstagramHandle(normalizedHandle);

  return {
    inputs: {
      ...inputs,
      body: padBoundedVecStorage(inputs.body, CIRCUIT_PARAMS.maxBodyLength, "body"),
      prefix_index: String(prefixIndex),
      template_kind: String(INSTAGRAM_TEMPLATE[template]),
      claimed_handle: handleBytesForCircuit(normalizedHandle).map(String),
      claimed_handle_len: String(textEncoder.encode(normalizedHandle).length),
      handle_blind: issuance.handleBlind.toString(),
      expiry_ts: issuance.expiryTs.toString(),
      active_owner: issuance.activeOwner.toString(),
      issuer_address: issuance.issuerAddress.toString(),
      chain_id: issuance.chainId.toString(),
    },
    metadata: {
      normalizedHandle,
      template,
      prefixIndex,
      handleLen: textEncoder.encode(normalizedHandle).length,
      handlePacked,
      ...issuance,
    },
  };
}
