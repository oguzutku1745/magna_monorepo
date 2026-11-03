// Magna seal field worker: draws on an OffscreenCanvas so the field never shares a thread with scrolling.
import { createRenderer } from "./ascii-field-core.js";

let renderer = null;
let running = false;
let raf = 0;
const frame = typeof requestAnimationFrame === "function"
  ? (fn) => requestAnimationFrame(fn)
  : (fn) => setTimeout(() => fn(performance.now()), 16);
const cancel = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;

function loop(now) {
  if (!running) return;
  raf = frame(loop);
  renderer.tick(now);
}

self.onmessage = ({ data }) => {
  switch (data.type) {
    case "init":
      renderer = createRenderer(data.canvas, data.options);
      break;
    case "layout":
      renderer?.layout(data.metrics);
      break;
    case "atlas":
      renderer?.setAtlas(data.bitmap);
      break;
    case "progress":
      renderer?.setProgress(data.value);
      break;
    case "jump":
      renderer?.jump(data.value);
      break;
    case "pointer":
      renderer?.setPointer(data.x, data.y, data.boost);
      break;
    case "run":
      if (data.on && !running && renderer) { running = true; renderer.resetClock(); raf = frame(loop); }
      if (!data.on && running) { running = false; cancel(raf); }
      break;
    case "redraw":
      renderer?.render();
      break;
  }
};
