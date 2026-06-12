import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("@magna/client ships no @aztec or binding imports and leaks no wallet internals", () => {
  const distDir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(distDir, "..", "package.json"), "utf8"));
  const allDeps = { ...pkg.dependencies, ...pkg.peerDependencies };
  for (const dep of Object.keys(allDeps)) {
    assert.ok(!dep.startsWith("@aztec/"), `dependency ${dep} is not allowed`);
    assert.notEqual(dep, "@magna/contracts-bindings");
    assert.notEqual(dep, "@magna/wallet");
  }
  for (const file of readdirSync(distDir).filter(f => f.endsWith(".js") && !f.includes(".spec."))) {
    const src = readFileSync(join(distDir, file), "utf8");
    assert.ok(!/from\s*["']@aztec\//.test(src), `${file} imports @aztec/*`);
    assert.ok(!/contracts-bindings/.test(src), `${file} references bindings`);
    assert.ok(!/HintedNote|registerSender|get_credential_hinted|pxe\./.test(src), `${file} leaks wallet internals`);
  }
});
