// Aztec's browser-only kv-store import maps `#msgpackr` to msgpackr's
// CommonJS no-eval bundle. Vite can pre-bundle that bundle, but because its
// exports are assigned dynamically it exposes only a default ESM export.
// Re-export the small named surface consumed by @aztec/kv-store while keeping
// the CSP-friendly no-eval implementation selected by Aztec.
import msgpackrNoEval from "msgpackr/index-no-eval";

export const Encoder = msgpackrNoEval.Encoder;
export const Decoder = msgpackrNoEval.Decoder;
export const Packr = msgpackrNoEval.Packr;
export const Unpackr = msgpackrNoEval.Unpackr;
export const addExtension = msgpackrNoEval.addExtension;
export const pack = msgpackrNoEval.pack;
export const unpack = msgpackrNoEval.unpack;

export default msgpackrNoEval;
