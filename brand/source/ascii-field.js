// Magna seal field. Source of truth: brand/source/ (copied into the apps by brand/render.mjs).
//
// A monospace field drawn on <canvas>, in the technique of the Kurage dashboard's ASCII ocean: each cell is
// sampled, mapped to a glyph ramp and, when lit, to a tinted tile. Here the field tells Magna's story:
// rows of private document data (passport MRZ lines) drift as faint ash glyphs, and a proof front resolves
// them into the seal, the Magna mark, built from ink tiles with one signal cell.
//
// Drawing runs in a Web Worker on an OffscreenCanvas (ascii-field.worker.js) so it never competes with
// scrolling; browsers without OffscreenCanvas run the same core (ascii-field-core.js) on the main thread.
//
// createSealField(host, { shape, progress, auto, markBox, cell }) -> { setProgress, redraw, destroy }
//   shape     "mark" draws the seal, "none" keeps only the drifting data (ambient backgrounds)
//   progress  0..1, how far the proof front has resolved the seal, default 1
//   auto      when true the field resolves on its own after mount
//   markBox   { x, y, size } in fractions of the host: where the seal sits
import { createRenderer, drawAtlas, metrics } from "./ascii-field-core.js";

export function createSealField(host, options = {}) {
  const opts = { shape: "mark", progress: 1, auto: false, markBox: { x: 0.72, y: 0.5, size: 0.62 }, cell: 0, ...options };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none";
  host.append(canvas);

  const renderOpts = { shape: opts.shape, markBox: opts.markBox, auto: opts.auto && !reduce, progress: reduce ? 1 : opts.progress };
  const atlasCanvas = document.createElement("canvas");
  let worker = null, local = null, raf = 0, m = null;
  let visible = !document.hidden, inView = true, destroyed = false;

  if ("transferControlToOffscreen" in canvas && typeof Worker === "function") {
    try {
      worker = new Worker(new URL("./ascii-field.worker.js", import.meta.url), { type: "module" });
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: "init", canvas: offscreen, options: renderOpts }, [offscreen]);
    } catch {
      worker?.terminate();
      worker = null;
    }
  }
  if (!worker) local = createRenderer(canvas, renderOpts);

  const send = (msg, transfer) => (worker ? worker.postMessage(msg, transfer ?? []) : null);

  async function pushAtlas() {
    if (!m || destroyed) return;
    drawAtlas(atlasCanvas, m);
    if (worker) {
      const bitmap = await createImageBitmap(atlasCanvas);
      if (destroyed) { bitmap.close(); return; }
      send({ type: "atlas", bitmap }, [bitmap]);
    } else {
      local.setAtlas(atlasCanvas);
    }
  }

  function resize() {
    const r = host.getBoundingClientRect();
    const next = metrics(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), window.devicePixelRatio, opts.cell);
    if (m && next.W === m.W && next.H === m.H && next.dpr === m.dpr) return;
    m = next;
    if (worker) send({ type: "layout", metrics: m }); else local.layout(m);
    void pushAtlas();
  }

  function localLoop(now) {
    raf = requestAnimationFrame(localLoop);
    local.tick(now);
  }

  function sync() {
    const on = !reduce && visible && inView && !destroyed;
    if (worker) { send({ type: "run", on }); return; }
    if (on && !raf) { local.resetClock(); raf = requestAnimationFrame(localLoop); }
    else if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  const onPointer = (e) => {
    if (!inView) return;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
    if (worker) send({ type: "pointer", x: inside ? x : -1e4, y: inside ? y : -1e4, boost: inside });
    else local.setPointer(inside ? x : -1e4, inside ? y : -1e4, inside);
  };
  const onVisibility = () => { visible = !document.hidden; sync(); };
  const ro = new ResizeObserver(resize);
  const io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
  ro.observe(host); io.observe(host);
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  resize();
  sync();
  // The atlas is drawn with the brand mono face; redraw it once the font has arrived.
  document.fonts?.ready.then(() => void pushAtlas());

  const setProgress = (p) => {
    if (reduce) { if (worker) send({ type: "jump", value: 1 }); else local.jump(1); return; }
    if (worker) send({ type: "progress", value: p }); else local.setProgress(p);
  };

  return {
    setProgress,
    redraw() { if (worker) send({ type: "redraw" }); else local.render(); },
    destroy() {
      destroyed = true;
      if (worker) worker.terminate();
      cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.remove();
    },
  };
}
