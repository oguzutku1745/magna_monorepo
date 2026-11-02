import { existsSync } from 'node:fs';
export const AZTEC_VERSION = '6.0.0';
export const LOCAL_NETWORK = 'local-v6';
export function assertV6Manifest(manifest) {
  if (manifest?.aztecVersion !== AZTEC_VERSION) {
    throw new Error('This operation requires a fresh Aztec 6.0.0 deployment manifest. Preserve the old manifest, chain and wallet data; use deployments/local-v6.json and deploy new contracts/accounts.');
  }
}
export function assertFreshOutput(path) {
  if (existsSync(path)) throw new Error(`Generated environment output already exists: ${path}. Preserve it and choose a fresh --management-env-out / --reference-dapp-env-out path.`);
}
export function isCurrentLocalImage(image) {
  const labels = image.Config?.Labels ?? {};
  return labels['io.magna.local-app'] === 'true' && labels['io.magna.aztec-version'] === AZTEC_VERSION;
}
export function assertV6ComposeEnvironment(env) {
  if (env.COMPOSE_PROJECT_NAME && env.COMPOSE_PROJECT_NAME !== "magna-local-v6") {
    throw new Error("Refusing a non-V6 Compose project. Unset COMPOSE_PROJECT_NAME or use magna-local-v6; old projects must be preserved.");
  }
  if (env.COMPOSE_FILE) throw new Error("Unset COMPOSE_FILE before managing the pinned V6 local stack.");
}

export function assertV6ComposeConfig(config) {
  const project = "magna-local-v6";
  const image = "azteclabs/aztec:6.0.0@sha256:59b10cc8e89bb9226db1f771a5abbe5d5f8d71483c00c7472187e6ddc7adab8d";
  if (config.name !== project) throw new Error("Unsafe V6 Compose project identity.");
  for (const service of ["anvil", "aztec-localnet"]) {
    if (config.services?.[service]?.image !== image) throw new Error(`Unsafe V6 Compose image for ${service}.`);
  }
  if (config.services?.bootstrap?.image !== "magna-local-app:aztec-6.0.0") throw new Error("Unsafe V6 Compose application image.");
  for (const name of ["magna-runtime", "magna-deployments"]) {
    const volume = config.volumes?.[name];
    if (volume?.external || volume?.name !== `${project}_${name}`) throw new Error(`Unsafe V6 Compose volume ${name}.`);
  }
}
export function v6NodeProverEnabled(info, options = {}) {
  if (info.nodeVersion !== "6.0.0") throw new Error(`Expected Aztec 6.0.0 node; received ${info.nodeVersion ?? "unknown"}.`);
  if (typeof info.realProofs !== "boolean") throw new Error("V6 node must report realProofs.");
  if (options.localOnly && BigInt(info.l1ChainId) !== 31337n) throw new Error("Local bootstrap requires chain 31337.");
  return info.realProofs;
}
