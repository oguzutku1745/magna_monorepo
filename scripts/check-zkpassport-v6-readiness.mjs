#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';

// Reviewed upstream candidate, not an active application configuration. Source:
// https://github.com/zkpassport/circuits/pull/170
export const ZKPASSPORT_V6_CANDIDATE = Object.freeze({
  sourceCommit: 'b04153038a7ee9f80f4ae93fd1b9ea32eaf833e3',
  version: '0.22.0',
  noirVersion: '1.0.0-rc.3',
  bbVersion: '6.0.0',
  root: '0x0efa41b10bd6472a36da098fe5cef870bd583a94375ae4875f1e3719f7f6a73b',
  vkeyHash: '0x173b45e348102428fe1a90201c381f7f34df6cd56236fb5649cd21460212451e',
});

// Network constants from published @zkpassport/registry 0.15.3. Never use the
// local Magna registry to decide whether an upstream release is available.
const networks = [
  { name: 'mainnet', rpc: 'https://ethereum-rpc.publicnode.com', circuits: 'https://circuits2.zkpassport.id/mainnet' },
  { name: 'sepolia', rpc: 'https://ethereum-sepolia-rpc.publicnode.com', circuits: 'https://circuits2.zkpassport.id/testnet' },
];
const rootRegistry = '0x1D0000020038d6E40E1d98e09fA1bb3A7DAA8B70';
const registryId = `0x${'2'.padStart(64, '0')}`;
const rootAbi = parseAbi(['function isRootValid(bytes32 registryId, bytes32 root, uint256 timestamp) view returns (bool)']);

async function readRoot(network) {
  const client = createPublicClient({ transport: http(network.rpc, { timeout: 15_000, retryCount: 0 }) });
  const block = await client.getBlock();
  const valid = await client.readContract({
    address: rootRegistry,
    abi: rootAbi,
    functionName: 'isRootValid',
    args: [registryId, ZKPASSPORT_V6_CANDIDATE.root, block.timestamp],
    blockNumber: block.number,
  });
  return { valid, blockNumber: block.number.toString() };
}

/** Public availability preflight only; does not replace cryptographic/E2E acceptance. */
export async function checkZkPassportV6Readiness({ fetchImpl = fetch, checkRoot = readRoot } = {}) {
  const candidate = ZKPASSPORT_V6_CANDIDATE;
  const check = async (network, kind, run) => {
    try {
      return { network: network.name, kind, ready: true, detail: await run() };
    } catch (error) {
      return { network: network.name, kind, ready: false, detail: error.shortMessage ?? error.message ?? String(error) };
    }
  };
  const getJson = async url => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response.json();
  };
  const results = await Promise.all(networks.map(async network => {
    const artifacts = async () => {
      const manifest = await check(network, 'manifest', async () => {
        const data = await getJson(`${network.circuits}/by-version/${candidate.version}/manifest.json`);
        if (data.version !== candidate.version || data.root !== candidate.root || data.circuits?.outer_count_7?.hash !== candidate.vkeyHash) {
          throw new Error('Manifest version, circuit root or outer_count_7 key differs from the reviewed candidate.');
        }
        return `${candidate.version}: root and outer_count_7 key match`;
      });
      if (!manifest.ready) return [manifest];
      const artifact = await check(network, 'artifact', async () => {
        const data = await getJson(`${network.circuits}/by-hash/${candidate.vkeyHash}.json`);
        const noirVersion = String(data.noir_version);
        const compilerMatches = noirVersion === candidate.noirVersion || noirVersion.startsWith(`${candidate.noirVersion}+`);
        if (data.name !== 'outer_count_7' || !compilerMatches || data.bb_version !== candidate.bbVersion || data.vkey_hash !== candidate.vkeyHash || !data.vkey) {
          throw new Error('Packaged outer_count_7 artifact is missing its key or differs from the reviewed compiler/backend/key.');
        }
        return 'Public packaged circuit is available; cryptographic proof acceptance still required';
      });
      return [manifest, artifact];
    };
    const [artifactChecks, root] = await Promise.all([
      artifacts(),
      check(network, 'root', async () => {
        const result = await checkRoot(network);
        if (result.valid !== true) throw new Error(`Candidate circuit root is not valid at block ${result.blockNumber}.`);
        return `Candidate root valid at block ${result.blockNumber}`;
      }),
    ]);
    return [...artifactChecks, root];
  }));
  const checks = results.flat();
  return { ready: checks.every(result => result.ready), checks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkZkPassportV6Readiness();
  console.log(JSON.stringify({ candidate: ZKPASSPORT_V6_CANDIDATE, ...report }, null, 2));
  console.log('Read-only availability preflight. Keep the active tuple until official proof, browser and EVM validation also pass.');
  process.exitCode = report.ready ? 0 : 1;
}
