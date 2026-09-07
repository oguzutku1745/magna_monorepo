import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("@magna-protocol/core has zero runtime dependencies and no node/aztec imports", () => {
  const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.peerDependencies ?? {}, {});
  assert.deepEqual(pkg.optionalDependencies ?? {}, {});
  assert.deepEqual(pkg.bundleDependencies ?? {}, {});
  assert.deepEqual(pkg.bundledDependencies ?? {}, {});
  const distDir = join(pkgDir, "dist");
  const nodeBuiltinPattern = /(?:from|import\s*\()\s*["'](?:node:|buffer|crypto|fs|path|url)(?:["']|\/)/;
  for (const file of readdirSync(distDir).filter(f => f.endsWith(".js") && !f.endsWith(".spec.js"))) {
    const src = readFileSync(join(distDir, file), "utf8");
    assert.ok(!/from\s+["']@aztec\//.test(src), `${file} imports @aztec/*`);
    assert.ok(!nodeBuiltinPattern.test(src), `${file} imports a Node builtin`);
    assert.ok(!/require\s*\(/.test(src), `${file} uses require()`);
    assert.ok(!/\bBuffer\b/.test(src), `${file} uses Buffer`);
  }
});
