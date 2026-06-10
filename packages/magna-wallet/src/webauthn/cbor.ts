/** Minimal CBOR decoding: unsigned/negative ints, byte/text strings, arrays, maps. */
export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | CborValue[]
  | Map<number | string, CborValue>
  | boolean
  | null;

export function decodeCbor(bytes: Uint8Array): { value: CborValue; bytesRead: number } {
  if (bytes.length > 4096) throw new Error("CBOR input too large");
  return decodeAt(bytes, 0, 0);
}

function decodeAt(bytes: Uint8Array, offset: number, depth: number): { value: CborValue; bytesRead: number } {
  if (depth > 32) throw new Error("CBOR nesting too deep");
  const start = offset;
  const initial = bytes[offset++];
  if (initial === undefined) throw new Error("truncated CBOR value");
  const major = initial >> 5;
  const info = initial & 0x1f;

  let length: number;
  if (info < 24) length = info;
  else if (info === 24) length = requireBytes(bytes, offset++, 1)[0];
  else if (info === 25) {
    const b = requireBytes(bytes, offset, 2);
    length = (b[0] << 8) | b[1];
    offset += 2;
  } else if (info === 26) {
    const b = requireBytes(bytes, offset, 4);
    length = (b[0] * 2 ** 24) + (b[1] << 16) + (b[2] << 8) + b[3];
    offset += 4;
  } else throw new Error(`unsupported CBOR additional info ${info}`);
  if (length > 1024) throw new Error("CBOR item too large");

  switch (major) {
    case 0: return { value: length, bytesRead: offset - start };
    case 1: return { value: -1 - length, bytesRead: offset - start };
    case 2: {
      const value = requireBytes(bytes, offset, length);
      return { value, bytesRead: offset - start + length };
    }
    case 3: {
      const value = new TextDecoder().decode(requireBytes(bytes, offset, length));
      return { value, bytesRead: offset - start + length };
    }
    case 4: {
      const arr: CborValue[] = [];
      for (let i = 0; i < length; i++) {
        const item = decodeAt(bytes, offset, depth + 1);
        arr.push(item.value);
        offset += item.bytesRead;
      }
      return { value: arr, bytesRead: offset - start };
    }
    case 5: {
      const map = new Map<number | string, CborValue>();
      for (let i = 0; i < length; i++) {
        const k = decodeAt(bytes, offset, depth + 1);
        offset += k.bytesRead;
        if (typeof k.value !== "number" && typeof k.value !== "string") {
          throw new Error("unsupported CBOR map key type");
        }
        if (map.has(k.value)) throw new Error("duplicate CBOR map key");
        const v = decodeAt(bytes, offset, depth + 1);
        offset += v.bytesRead;
        map.set(k.value, v.value);
      }
      return { value: map, bytesRead: offset - start };
    }
    case 7:
      if (info === 20) return { value: false, bytesRead: offset - start };
      if (info === 21) return { value: true, bytesRead: offset - start };
      if (info === 22) return { value: null, bytesRead: offset - start };
      throw new Error(`unsupported CBOR simple value ${info}`);
    default:
      throw new Error(`unsupported CBOR major type ${major}`);
  }
}

function requireBytes(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (offset + length > bytes.length) throw new Error("truncated CBOR value");
  return bytes.slice(offset, offset + length);
}
