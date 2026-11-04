// Shared helpers for kit sheets. Barcodes are deterministic so the PNGs are stable between renders.
export function barcode(el, seed = 7, count = 64) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  el.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const bar = document.createElement("i");
    const dense = i < count * 0.18;
    bar.style.width = `${dense ? 3 : 1 + Math.floor(rnd() * 3)}px`;
    bar.style.marginRight = `${dense ? 1 : 2 + Math.floor(rnd() * 9)}px`;
    if (el.dataset.tone === "signal") bar.style.background = "var(--signal)";
    el.append(bar);
  }
}

export async function ready() {
  document.querySelectorAll(".barcode").forEach((el, i) => barcode(el, Number(el.dataset.seed ?? i + 3), Number(el.dataset.bars ?? 64)));
  await document.fonts.ready;
  document.body.dataset.ready = "1";
}
