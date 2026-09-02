import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import test from "node:test";

const requireFromThisPackage = createRequire(import.meta.url);

function resolvedPackageVersion(packageName: string): string {
  let directory = dirname(requireFromThisPackage.resolve(packageName));
  const root = parse(directory).root;
  while (directory !== root) {
    const packageJsonPath = join(directory, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === packageName && typeof manifest.version === "string") {
        return manifest.version;
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? Reflect.get(error, "code") : undefined;
      if (code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not resolve the installed version of ${packageName}.`);
}

test("Instagram proof runtime matches the compiler and proving lane exactly", () => {
  assert.equal(resolvedPackageVersion("@noir-lang/noir_js"), "1.0.0-beta.5");
  assert.equal(resolvedPackageVersion("@noir-lang/acvm_js"), "1.0.0-beta.5");
  assert.equal(resolvedPackageVersion("@noir-lang/types"), "1.0.0-beta.5");
  assert.equal(resolvedPackageVersion("@aztec/bb.js"), "0.84.0");
});
