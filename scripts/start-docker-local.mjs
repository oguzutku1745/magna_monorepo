#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const composeProjectImage = "magna-local-app:aztec-5.1.0";
const cleanBuilderName = "magna-local-clean-builder";
const magnaImageLabel = "io.magna.local-app";
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

function capture(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    if (allowFailure) return "";
    throw new Error(`${command} ${args.join(" ")} could not start: ${result.error.message}`);
  }
  if (!allowFailure && (result.status ?? 1) !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 1}`}: ${result.stderr?.trim() ?? ""}`,
    );
  }
  return result.stdout?.trim() ?? "";
}

function lines(value) {
  return value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
}

function isMagnaLocalImage(image) {
  const config = image.Config ?? {};
  const labels = config.Labels ?? {};
  if (labels[magnaImageLabel] === "true") return true;

  // Images exported before the explicit label was introduced have this exact
  // Magna-only runtime signature. Keep this compatibility branch until those
  // old local images have naturally been removed from developer machines.
  return (
    config.WorkingDir === "/workspace" &&
    JSON.stringify(config.Cmd ?? []) ===
      JSON.stringify(["node", "./scripts/start-docker-service.mjs", "management"])
  );
}

function removeUnusedMagnaImages({ except = [] } = {}) {
  const imageIds = [...new Set(lines(capture("docker", ["image", "ls", "--all", "--quiet", "--no-trunc"])))];
  if (imageIds.length === 0) return;

  const containerIds = lines(capture("docker", ["container", "ls", "--all", "--quiet", "--no-trunc"]));
  const usedImageIds = new Set(
    containerIds.length === 0
      ? []
      : lines(capture("docker", ["container", "inspect", "--format", "{{.Image}}", ...containerIds])),
  );
  const exceptIds = new Set(except);
  const inspected = JSON.parse(capture("docker", ["image", "inspect", ...imageIds]));
  const removable = inspected
    .filter(image => isMagnaLocalImage(image))
    .map(image => image.Id)
    .filter(imageId => !usedImageIds.has(imageId) && !exceptIds.has(imageId));

  if (removable.length === 0) return;
  run(`remove ${removable.length} unused prior Magna application image(s)`, "docker", [
    "image",
    "rm",
    ...removable,
  ]);
}

// Reclaim only old Magna-owned images which are not backing a container. Do not
// prune the global Docker image or builder stores: they can belong to other projects.
removeUnusedMagnaImages();

// Build through a dedicated ephemeral BuildKit instance so Magna can clear its
// own intermediate layers without touching the default builder or another project.
// Crucially, the current Compose stack remains intact until the new image has
// built and loaded successfully.
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

const loadedImageId = capture("docker", ["image", "inspect", "--format", "{{.Id}}", composeProjectImage]);

// The replacement image is now available. Only at this commit point may the
// default clean run destroy the old disposable chain and runtime state.
run("remove the previous Magna containers, chain volumes, and runtime volumes", "docker", [
  "compose",
  "down",
  "--volumes",
  "--remove-orphans",
]);
removeUnusedMagnaImages({ except: [loadedImageId] });

run("start the freshly built stack and perform a new deployment", "docker", [
  "compose",
  "up",
  "--no-build",
  "--force-recreate",
]);
