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
