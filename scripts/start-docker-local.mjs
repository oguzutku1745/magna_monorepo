#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const composeProjectImage = "magna-local-app:aztec-5.1.0";
const cleanBuilderName = "magna-local-clean-builder";
const imageExportDir = mkdtempSync(join(tmpdir(), "magna-local-image-"));
const imageExportPath = join(imageExportDir, "magna-local-app.tar");

function run(label, command, args, { allowFailure = false } = {}) {
  console.info(`[docker-local] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    if (allowFailure) return;
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (!allowFailure && (result.status ?? 1) !== 0) {
    throw new Error(
      `${label} failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 1}`}`,
    );
  }
}

// The default local acceptance run must never inherit an old L1/L2 chain,
// generated deployment manifest, runtime frontend bundle, or service container.
run("remove the previous Magna containers, chain volumes, and runtime volumes", "docker", [
  "compose",
  "down",
  "--volumes",
  "--remove-orphans",
]);

// Remove the prior tagged application image. Build through a dedicated ephemeral
// BuildKit instance so Magna can clear all of its own cached layers without touching
// the default builder or any unrelated Docker project.
run("remove the previous Magna application image", "docker", ["image", "rm", "--force", composeProjectImage], {
  allowFailure: true,
});
try {
  run("remove any abandoned Magna clean builder", "docker", [
    "buildx",
    "rm",
    "--force",
    cleanBuilderName,
  ], { allowFailure: true });
  run("create an isolated empty builder for Magna", "docker", [
    "buildx",
    "create",
    "--name",
    cleanBuilderName,
    "--driver",
    "docker-container",
    "--bootstrap",
  ]);

  try {
    // Export to the host before loading. Loading directly from the isolated
    // builder makes Docker Desktop hold both the builder cache and the final
    // image at once, which can exhaust its VM disk even when macOS has space.
    run("build and export a fresh Magna application image without cached layers", "docker", [
      "buildx",
      "build",
      "--builder",
      cleanBuilderName,
      "--no-cache",
      "--tag",
      composeProjectImage,
      "--output",
      `type=docker,dest=${imageExportPath}`,
      "--file",
      "Dockerfile.local",
      ".",
    ]);
  } finally {
    run("delete Magna's isolated builder and all of its build cache", "docker", [
      "buildx",
      "rm",
      "--force",
      cleanBuilderName,
    ], { allowFailure: true });
  }

  run("load the freshly built Magna application image", "docker", [
    "image",
    "load",
    "--input",
    imageExportPath,
  ]);
} finally {
  rmSync(imageExportDir, { recursive: true, force: true });
}

run("start the freshly built stack and perform a new deployment", "docker", [
  "compose",
  "up",
  "--no-build",
  "--force-recreate",
]);
