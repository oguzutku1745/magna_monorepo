#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const instagramPackageManifest = resolve(repoRoot, "packages/magna-instagram-proof/package.json");
const requireFromInstagramPackage = createRequire(instagramPackageManifest);

const expectedVersions = new Map([
  ["@noir-lang/noir_js", "1.0.0-beta.5"],
  ["@noir-lang/acvm_js", "1.0.0-beta.5"],
  ["@noir-lang/types", "1.0.0-beta.5"],
  ["@aztec/bb.js", "0.84.0"],
]);

function resolvedPackageVersion(packageName) {
  let directory = dirname(requireFromInstagramPackage.resolve(packageName));
  const root = parse(directory).root;
  while (directory !== root) {
    const packageJsonPath = join(directory, "package.json");
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (manifest.name === packageName && typeof manifest.version === "string") {
        return manifest.version;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not resolve the installed version of ${packageName} from ${instagramPackageManifest}.`);
}

for (const [packageName, expectedVersion] of expectedVersions) {
  const actualVersion = resolvedPackageVersion(packageName);
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Instagram proof runtime mismatch: ${packageName} must resolve to ${expectedVersion}, received ${actualVersion}. ` +
        "Run npm install with the repository lockfile before starting Magna management. " +
        "The zkEmail circuit must not share the zkPassport Noir runtime lane.",
    );
  }
}

console.info("[instagram-runtime] exact Noir beta.5 / Barretenberg 0.84.0 lane confirmed");
