// Magna seal field. Source of truth: brand/source/ascii-field.js (copied into the apps by brand/render.mjs).
//
// A monospace field drawn on <canvas>, in the technique of the Kurage dashboard's ASCII ocean: each cell is
// sampled, mapped to a glyph ramp and, when lit, to a tinted tile. Here the field tells Magna's story:
// rows of private document data (passport MRZ lines) drift as faint ash glyphs, and a proof front resolves
// them into the seal, the Magna mark, built from ink tiles with one signal cell.
//
// createSealField(host, { shape, progress, auto, markBox, cell }) -> { setProgress, redraw, destroy }
//   shape     "mark" draws the seal, "none" keeps only the drifting data (ambient backgrounds)
//   progress  0..1, how far the proof front has resolved the seal (drive it from scroll), default 1
//   auto      when true the field resolves on its own after mount
//   markBox   { x, y, size } in fractions of the host: where the seal sits

const MARK = ["11111", "10101", "10101", "10101", "101S1"];
const MRZ = "P<MAGNA<<CHARTER<<<<<<<<<<0123456789<<<SEAL<<<PROOF<<<<<<NULLIFIER<<<";
const RAMP = [".", ":", "-", "+", "x", "X", "#"];
const FONT = '"Geist Mono", ui-monospace, Menlo, Consolas, monospace';

const C = {
  ink: [12, 12, 11],
  graphite: [79, 78, 73],
  ash: [143, 141, 134],
  rule: [217, 215, 207],
  paper: [244, 243, 238],
  signal: [200, 240, 49],
};
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function hash(x, y, t) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(t, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t) => t * t * (3 - 2 * t);

export function createSealField(host, options = {}) {
  const opts = { shape: "mark", progress: 1, auto: false, markBox: { x: 0.72, y: 0.5, size: 0.62 }, cell: 0, ...options };
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none";
  host.append(canvas);
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1, cw = 10, ch = 15, cols = 0, rows = 0, fs = 11;
  let time = 0, last = 0, raf = 0, visible = !document.hidden, inView = true;
  let progress = opts.auto ? 0 : opts.progress;
  let target = opts.progress;
  const pointer = { x: -1e4, y: -1e4, energy: 0 };
  // Per-row drift speed and phase for the data lines.
  let lanes = [];
  // Per-cell static data, computed on resize: mark kind (0 none, 1 ink, 2 seal), halo strength, sweep position, jitter.
  let kind = new Uint8Array(0), halo = new Float32Array(0), front0 = new Float32Array(0), jitter = new Float32Array(0);

  // Glyph atlas: every glyph pre-drawn once per colour, then copied with drawImage. Much cheaper than fillText per cell.
  const GLYPHS = [...new Set(MRZ + RAMP.join(""))];
  const GI = new Map(GLYPHS.map((g, i) => [g, i]));
  const INKS = [C.ink, C.ash, C.graphite, C.paper];
  const atlas = document.createElement("canvas");
  const actx = atlas.getContext("2d");

  function buildAtlas() {
    const pw = Math.ceil(cw * dpr), ph = Math.ceil(ch * dpr);
    atlas.width = pw * GLYPHS.length; atlas.height = ph * INKS.length;
    actx.setTransform(1, 0, 0, 1, 0, 0);
    actx.clearRect(0, 0, atlas.width, atlas.height);
    actx.font = `500 ${fs * dpr}px ${FONT}`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    INKS.forEach((c, row) => {
      actx.fillStyle = rgba(c, 1);
      GLYPHS.forEach((g, i) => actx.fillText(g, i * pw + pw / 2, row * ph + ph / 2 + 0.5 * dpr));
    });
  }

  function glyph(g, inkRow, alpha, x, y) {
    if (alpha <= 0.01) return;
    const pw = Math.ceil(cw * dpr), ph = Math.ceil(ch * dpr);
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(atlas, GI.get(g) * pw, inkRow * ph, pw, ph, x, y, cw, ch);
  }

  function computeCells() {
    const n = cols * rows;
    kind = new Uint8Array(n); halo = new Float32Array(n); front0 = new Float32Array(n); jitter = new Float32Array(n);
    const size = Math.min(W, H) * opts.markBox.size, unit = size / 5;
    const left = W * opts.markBox.x - size / 2, top = H * opts.markBox.y - size / 2;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        jitter[i] = hash(cx, cy, 11) * 0.18;
        if (opts.shape !== "mark") continue;
        const px = cx * cw + cw / 2, py = cy * ch + ch / 2;
        front0[i] = (px - left) / size;
        const gx = Math.floor((px - left) / unit), gy = Math.floor((py - top) / unit);
        if (gx < 0 || gy < 0 || gx > 4 || gy > 4) {
          const dx = Math.max(left - px, 0, px - (left + size)), dy = Math.max(top - py, 0, py - (top + size));
          halo[i] = Math.max(0, 1 - Math.hypot(dx, dy) / (unit * 0.9));
        } else {
          const v = MARK[gy][gx];
          kind[i] = v === "0" ? 0 : v === "S" ? 2 : 1;
          halo[i] = v === "0" ? 0.55 : 0;
        }
      }
    }
  }

  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    // Capped: the field is texture, not text, and canvas raster cost grows with the square of the ratio.
    dpr = Math.min(1.25, window.devicePixelRatio || 1);
    cw = opts.cell || (W < 600 ? 8 : W < 1100 ? 9 : 10);
    ch = Math.round(cw * 1.5);
    fs = Math.round(ch * 0.72);
    cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    lanes = Array.from({ length: rows }, (_, y) => ({
      on: hash(y, 7, 1) > 0.42,
      speed: (hash(y, 3, 2) - 0.5) * 4,
      offset: Math.floor(hash(y, 5, 3) * MRZ.length),
      alpha: 0.18 + hash(y, 9, 4) * 0.28,
    }));
    buildAtlas();
    computeCells();
    render();
  }

  function render() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    const tick = Math.floor(time * 1.6);
    const fast = Math.floor(time * 8);
    // The proof front sweeps left to right across the seal as progress grows.
    const front = progress * 1.6 - 0.2;
    const live = pointer.energy > 0.01 && pointer.x > -1e3;

    // Pass 1: tiles, grouped by colour so the fill style changes twice per frame.
    for (const k of [1, 2]) {
      ctx.fillStyle = rgba(k === 2 ? C.signal : C.ink, 1);
      for (let i = 0; i < kind.length; i++) {
        if (kind[i] !== k) continue;
        const resolved = clamp((front - front0[i] - jitter[i]) * 5, 0, 1);
        if (resolved <= 0) continue;
        ctx.globalAlpha = smooth(resolved);
        const cx = i % cols, cy = (i / cols) | 0;
        ctx.fillRect(cx * cw + 0.5, cy * ch + 0.5, cw - 1, ch - 1);
      }
    }

    // Pass 2: glyphs from the atlas.
    for (let cy = 0; cy < rows; cy++) {
      const lane = lanes[cy];
      const shift = Math.floor(time * lane.speed);
      const y = cy * ch;
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        const x = cx * cw;
        const k = kind[i];
        const resolved = k || halo[i] > 0 ? clamp((front - front0[i] - jitter[i]) * 5, 0, 1) : 0;
        let near = 0;
        if (live) {
          const pd = Math.hypot(x + cw / 2 - pointer.x, y + ch / 2 - pointer.y);
          if (pd < 120) near = pointer.energy * (1 - pd / 120);
        }

        if (k && resolved > 0) {
          const t = smooth(resolved);
          const h = hash(cx, cy, tick + (near > 0.2 ? fast : 0));
          glyph(RAMP[5 + (h > 0.5 ? 1 : 0)], k === 2 ? 0 : 3, (k === 2 ? 0.55 : 0.38) * t, x, y);
          if (t >= 1) continue;
        }

        // Halo around a resolved seal: density ramp in graphite, so the mark reads as condensed data.
        const hl = halo[i];
        if (hl > 0 && resolved > 0) {
          const h = hash(cx, cy, tick);
          if (h < hl * 0.9) {
            const lv = Math.min(RAMP.length - 3, Math.floor(hl * resolved * (RAMP.length - 2)));
            glyph(RAMP[lv], 2, 0.25 + hl * 0.45 * resolved, x, y);
            continue;
          }
        }

        // Drifting document data. Unresolved seal cells keep showing it, denser.
        if (!lane.on && !k) continue;
        const idx = ((cx + lane.offset + shift) % MRZ.length + MRZ.length) % MRZ.length;
        let g = MRZ[idx];
        const h = hash(cx, cy, tick);
        if (near > 0.15 && h < near) g = RAMP[Math.floor(h * RAMP.length)];
        if (g === "<" && h > 0.55 && !k) continue;
        const a = (k ? 0.55 : lane.alpha) * (1 - resolved) + near * 0.5;
        glyph(g, near > 0.3 ? 0 : 1, Math.min(0.85, a), x, y);
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!last) { last = now; return; }
    const dt = Math.min(0.3, (now - last) / 1000);
    // The field steps like a terminal: 4 frames a second at rest, 24 while the pointer or the proof front moves.
    const active = pointer.energy > 0.01 || Math.abs(target - progress) > 0.002 || (opts.auto && progress < 0.998);
    if (dt < (active ? 1 / 24 : 1 / 4)) return;
    last = now;
    time += dt;
    if (opts.auto) target = 1;
    progress += (target - progress) * Math.min(1, dt * 2.2);
    pointer.energy = Math.max(0, pointer.energy - dt * 0.9);
    render();
  }

  function sync() {
    const should = !reduce && visible && inView && W > 0;
    if (should && !raf) { last = 0; raf = requestAnimationFrame(loop); }
    else if (!should && raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  const onPointer = (e) => {
    if (!inView) return;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || y < 0 || x > r.width || y > r.height) { pointer.x = pointer.y = -1e4; return; }
    pointer.x = x; pointer.y = y;
    pointer.energy = Math.min(1, pointer.energy + 0.25);
  };
  const onVisibility = () => { visible = !document.hidden; sync(); };
  const ro = new ResizeObserver(resize);
  const io = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); });
  ro.observe(host); io.observe(host);
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  if (reduce) { progress = target = 1; }
  resize();
  sync();
  // The atlas is drawn with the brand mono face; redraw it once the font has arrived.
  document.fonts?.ready.then(() => { buildAtlas(); render(); });

  return {
    setProgress(p) { target = clamp(p, 0, 1); if (reduce) { progress = target; render(); } },
    redraw: render,
    destroy() {
      cancelAnimationFrame(raf); raf = 0;
      ro.disconnect(); io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.remove();
    },
  };
}
