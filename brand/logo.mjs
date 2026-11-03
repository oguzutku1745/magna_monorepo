// The Magna logo as data. Everything else (SVG files, kit sheets, the apps' Logo components) is generated from here
// by brand/render.mjs, so the mark cannot drift between surfaces.
//
// Grid: one cell is 10 units. The mark is a 5x5 arched M. The wordmark is MAGNA in the same square construction
// (5 cells tall, A and G 4 wide, M and N 5 wide, one empty cell between letters) and its M is the mark itself, seal included,
// so the lockup never repeats the M. "S" marks the seal cell.

export const CELL = 10;

export const COLOR = {
  paper: "#F4F3EE",
  ink: "#0C0C0B",
  signal: "#C8F031",
};

// The seal hangs at the foot of the charter: the one lit cell sits at the base of the M's right slot.
// It is the only thing the mark lets out. Everything else is sealed ink.
const MARK = [
  "11111",
  "10101",
  "10101",
  "10101",
  "101S1",
];

const GLYPHS = {
  M: MARK,
  A: ["1111", "1001", "1111", "1001", "1001"],
  G: ["1111", "1000", "1011", "1001", "1111"],
  N: ["10001", "11001", "10101", "10011", "10001"],
};

const WORD = "MAGNA";

function cells(rows, ox = 0, oy = 0) {
  const out = [];
  rows.forEach((row, y) => [...row].forEach((v, x) => {
    if (v !== "0") out.push({ x: ox + x, y: oy + y, seal: v === "S" });
  }));
  return out;
}

function wordCells(ox = 0) {
  const out = [];
  let x = ox;
  for (const ch of WORD) {
    out.push(...cells(GLYPHS[ch], x, 0));
    x += GLYPHS[ch][0].length + 1;
  }
  return { cells: out, width: x - 1 - ox };
}

const rect = (c, fill) =>
  `<rect x="${c.x * CELL}" y="${c.y * CELL}" width="${CELL}" height="${CELL}" fill="${fill}"/>`;

// Merge horizontal runs so the SVG stays small and renders without hairline seams between cells.
function runs(list, fillFor) {
  const rows = new Map();
  for (const c of list) {
    const key = `${c.y}:${fillFor(c)}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(c.x);
  }
  const out = [];
  for (const [key, xs] of rows) {
    const [y, fill] = [Number(key.split(":")[0]), key.slice(key.indexOf(":") + 1)];
    xs.sort((a, b) => a - b);
    let start = xs[0], prev = xs[0];
    for (const x of [...xs.slice(1), Infinity]) {
      if (x === prev + 1) { prev = x; continue; }
      out.push(`<rect x="${start * CELL}" y="${y * CELL}" width="${(prev - start + 1) * CELL}" height="${CELL}" fill="${fill}"/>`);
      start = prev = x;
    }
  }
  return out.join("");
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * CELL} ${h * CELL}" shape-rendering="crispEdges" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

const ink = (mono) => (c) => (c.seal && !mono ? COLOR.signal : mono ? "currentColor" : COLOR.ink);

export const logoSvg = {
  mark: () => svg(5, 5, runs(cells(MARK), ink(false)), "Magna"),
  markMono: () => svg(5, 5, runs(cells(MARK), ink(true)), "Magna"),
  // Paper M on an ink square with the lit seal: favicon, app icon, avatar.
  tile: () => {
    const m = cells(MARK, 1, 1);
    return svg(7, 7, `<rect width="${7 * CELL}" height="${7 * CELL}" fill="${COLOR.ink}"/>` +
      runs(m, (c) => (c.seal ? COLOR.signal : COLOR.paper)), "Magna");
  },
  wordmark: () => { const w = wordCells(); return svg(w.width, 5, runs(w.cells, ink(false)), "Magna"); },
  wordmarkMono: () => { const w = wordCells(); return svg(w.width, 5, runs(w.cells, ink(true)), "Magna"); },
};

// Plain data for the apps' Logo component (written to apps/*/src/brand/logo-data.ts by render.mjs).
export function logoData() {
  const w = wordCells();
  return {
    cell: CELL,
    mark: { w: 5, h: 5, cells: cells(MARK) },
    wordmark: { w: w.width, h: 5, cells: w.cells },
  };
}
