import { generateEmailVerifierInputs } from "@zk-email/zkemail-nr";
import type { InputValue } from "@noir-lang/types";
import {
  INSTAGRAM_TEMPLATE,
  MAX_INSTAGRAM_HANDLE_LENGTH,
  type GenerateInstagramInputsResult,
  type InstagramTemplateName,
} from "./types.js";

const textEncoder = new TextEncoder();

const CIRCUIT_PARAMS = {
  maxHeadersLength: 1024,
  maxBodyLength: 8192,
  extractFrom: true,
  removeSoftLineBreaks: true,
} as const;

const TEMPLATE_PREFIX: Record<InstagramTemplateName, string> = {
  english: "Hi ",
  turkish: "Merhaba ",
};

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
    const greeting = `${TEMPLATE_PREFIX[template]}${handle},`;
    if (raw.includes(greeting)) {
      return { template, selector: greeting };
    }
  }
  for (const template of Object.keys(TEMPLATE_PREFIX) as InstagramTemplateName[]) {
    const selector = TEMPLATE_PREFIX[template];
    if (raw.includes(selector)) {
      return { template, selector };
    }
  }
  throw new Error("Could not find a supported Instagram greeting in the email body.");
}

function findPrefixIndex(decodedBody: string, template: InstagramTemplateName, handle: string): number {
  const expectedGreeting = `${TEMPLATE_PREFIX[template]}${handle},`;
  const index = decodedBody.indexOf(expectedGreeting);
  if (index < 0) {
    throw new Error(`Decoded email body does not contain expected Instagram greeting: ${expectedGreeting}`);
  }
  return index;
}

export async function generateInstagramCircuitInputs(
  rawEmail: Buffer | string,
  claimedHandle: string,
): Promise<GenerateInstagramInputsResult> {
  const normalizedHandle = normalizeInstagramHandle(claimedHandle);
  const { template, selector } = chooseTemplate(rawEmail, normalizedHandle);
  const inputs = await generateEmailVerifierInputs(rawEmail, {
    ...CIRCUIT_PARAMS,
    shaPrecomputeSelector: selector,
  });

  const decodedBody = boundedVecToUtf8(inputs.decoded_body, "decoded_body");
  const prefixIndex = findPrefixIndex(decodedBody, template, normalizedHandle);
  const handlePacked = packInstagramHandle(normalizedHandle);

  return {
    inputs: {
      ...inputs,
      body: padBoundedVecStorage(inputs.body, CIRCUIT_PARAMS.maxBodyLength, "body"),
      decoded_body: padBoundedVecStorage(
        inputs.decoded_body,
        CIRCUIT_PARAMS.maxBodyLength,
        "decoded_body",
      ),
      prefix_index: String(prefixIndex),
      template_kind: String(INSTAGRAM_TEMPLATE[template]),
      claimed_handle: handleBytesForCircuit(normalizedHandle).map(String),
      claimed_handle_len: String(textEncoder.encode(normalizedHandle).length),
    },
    metadata: {
      normalizedHandle,
      template,
      prefixIndex,
      handleLen: textEncoder.encode(normalizedHandle).length,
      handlePacked,
    },
  };
}
