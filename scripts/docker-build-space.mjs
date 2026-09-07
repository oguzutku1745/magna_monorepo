const GiB = 1024 ** 3;

// Reserve room for the isolated builder's base image, dependency install and
// compiled artifacts while the previous application image remains available.
export const minimumDockerBuildBytes = 12 * GiB;
export const minimumHostExportBytes = 8 * GiB;

export function availableBytesFromDf(output) {
  const fields = output.trim().split(/\r?\n/).at(-1).trim().split(/\s+/);
  const availableKiB = Number(fields[3]);
  if (fields.length < 6 || !Number.isFinite(availableKiB) || availableKiB < 0) {
    throw new Error('Could not determine Docker filesystem free space.');
  }
  return availableKiB * 1024;
}

export function requireBuildSpace(dockerBytes, hostBytes) {
  const gib = bytes => (bytes / GiB).toFixed(1);
  if (dockerBytes < minimumDockerBuildBytes) {
    throw new Error(`Docker has ${gib(dockerBytes)} GiB free; the clean Magna build requires at least ${gib(minimumDockerBuildBytes)} GiB before starting. Free identified unused build cache or increase Docker Desktop's disk allocation. Host free space does not increase Docker's disk limit. No chain reset has occurred.`);
  }
  if (hostBytes < minimumHostExportBytes) {
    throw new Error(`The host temporary filesystem has ${gib(hostBytes)} GiB free; image export requires at least ${gib(minimumHostExportBytes)} GiB. Free host space before retrying. No chain reset has occurred.`);
  }
  return `Docker ${gib(dockerBytes)} GiB free; host export filesystem ${gib(hostBytes)} GiB free`;
}
