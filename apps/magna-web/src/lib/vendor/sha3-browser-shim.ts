import * as sha3Module from "sha3/index.js";

const sha3 = sha3Module as {
  Keccak?: unknown;
  SHA3?: unknown;
  SHAKE?: unknown;
  SHA3Hash?: unknown;
  default?: {
    Keccak?: unknown;
    SHA3?: unknown;
    SHAKE?: unknown;
    SHA3Hash?: unknown;
  };
};

export const Keccak = sha3.Keccak ?? sha3.default?.Keccak;
export const SHA3 = sha3.SHA3 ?? sha3.default?.SHA3;
export const SHAKE = sha3.SHAKE ?? sha3.default?.SHAKE;
export const SHA3Hash = sha3.SHA3Hash ?? sha3.default?.SHA3Hash;
export default sha3.default ?? sha3Module;
