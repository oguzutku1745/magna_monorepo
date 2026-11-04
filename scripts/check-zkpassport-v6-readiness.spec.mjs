import test from 'node:test';
import assert from 'node:assert/strict';
import { checkZkPassportV6Readiness, ZKPASSPORT_V6_CANDIDATE } from './check-zkpassport-v6-readiness.mjs';

const candidate = ZKPASSPORT_V6_CANDIDATE;
const manifest = () => ({
  version: candidate.version,
  root: candidate.root,
  circuits: { outer_count_7: { hash: candidate.vkeyHash } },
});
const artifact = () => ({ name: 'outer_count_7', noir_version: candidate.noirVersion, bb_version: '6.0.0', vkey_hash: candidate.vkeyHash, vkey: 'public-key-artifact' });
function dependencies({ manifestBody = manifest(), artifactBody = artifact(), rootValid = true, status = 200, rootError } = {}) {
  return {
    fetchImpl: async url => new Response(JSON.stringify(url.includes('/by-version/') ? manifestBody : artifactBody), { status }),
    checkRoot: async () => {
      if (rootError) throw rootError;
      return { valid: rootValid, blockNumber: '123' };
    },
  };
}

test('ready requires artifacts and valid roots on both supported networks', async () => {
  const report = await checkZkPassportV6Readiness(dependencies());
  assert.equal(report.ready, true);
  assert.equal(report.checks.length, 6);
  assert.ok(report.checks.every(check => check.ready));
});

test('an available SDK or manifest cannot substitute for a registered circuit root', async () => {
  const report = await checkZkPassportV6Readiness(dependencies({ rootValid: false }));
  assert.equal(report.ready, false);
  assert.equal(report.checks.filter(check => check.kind === 'root' && !check.ready).length, 2);
});

test('missing official manifests block readiness', async () => {
  const report = await checkZkPassportV6Readiness(dependencies({ status: 404 }));
  assert.equal(report.ready, false);
  assert.ok(report.checks.some(check => check.kind === 'manifest' && check.detail.includes('404')));
});

for (const [field, value] of [['version', '0.21.1'], ['root', '0xwrong']]) {
  test(`a manifest with the wrong ${field} blocks readiness`, async () => {
    const report = await checkZkPassportV6Readiness(dependencies({ manifestBody: { ...manifest(), [field]: value } }));
    assert.equal(report.ready, false);
    assert.ok(report.checks.some(check => check.kind === 'manifest' && !check.ready));
  });
}

test('a different outer verification key blocks readiness', async () => {
  const body = manifest();
  body.circuits.outer_count_7.hash = '0xwrong';
  const report = await checkZkPassportV6Readiness(dependencies({ manifestBody: body }));
  assert.equal(report.ready, false);
});

for (const [field, value] of [['noir_version', '1.0.0-beta.22'], ['noir_version', '1.0.0-rc.30'], ['bb_version', '5.0.0'], ['vkey_hash', '0xwrong'], ['vkey', '']]) {
  test(`a missing or mismatched packaged ${field} blocks readiness`, async () => {
    const report = await checkZkPassportV6Readiness(dependencies({ artifactBody: { ...artifact(), [field]: value } }));
    assert.equal(report.ready, false);
    assert.ok(report.checks.some(check => check.kind === 'artifact' && !check.ready));
  });
}

test('an RPC failure is reported as unavailable rather than ready', async () => {
  const report = await checkZkPassportV6Readiness(dependencies({ rootError: new Error('RPC unavailable') }));
  assert.equal(report.ready, false);
  assert.ok(report.checks.some(check => check.kind === 'root' && check.detail.includes('RPC unavailable')));
});

test('one unpublished network blocks a shared production/developer cutover', async () => {
  const deps = dependencies();
  const report = await checkZkPassportV6Readiness({ ...deps, checkRoot: async network => ({ valid: network.name === 'mainnet', blockNumber: '123' }) });
  assert.equal(report.ready, false);
  assert.equal(report.checks.find(check => check.kind === 'root' && check.network === 'sepolia').ready, false);
});

// The current upstream candidate now packages stable Noir rather than RC3.
test('accepts the upstream stable Noir 1.0.0 artifact', async () => {
  const report = await checkZkPassportV6Readiness(dependencies({ artifactBody: { ...artifact(), noir_version: '1.0.0' } }));
  assert.equal(report.ready, true);
});

test('rejects the superseded RC3 compiler artifact', async () => {
  const report = await checkZkPassportV6Readiness(dependencies({ artifactBody: { ...artifact(), noir_version: '1.0.0-rc.3' } }));
  assert.equal(report.ready, false);
});
