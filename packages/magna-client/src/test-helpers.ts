import type { WindowImpl } from "./connector.js";

export function createSilentWindowImpl(origin: string): WindowImpl {
  return {
    open: () => ({ closed: false, postMessage: () => {}, close: () => {} }),
    addMessageListener: () => () => {},
    origin,
  };
}
