import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Fr } from '@aztec/aztec.js/fields';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/sync';
import { MagnaIssuerContract } from '@magna/contracts-bindings';
import { MagnaBrowserClient } from './client.js';
import * as chain from './credential-chain-state.js';

const owner = `0x${'11'.repeat(32)}`;
const issuer = `0x${'12'.repeat(32)}`;
const root = 101n, claims = 202n;
const status = (secret: bigint) => ({ note: { root_commitment: root, revocation_secret: secret } });
function fixture(secrets = [404n]) {
  const sent: string[] = [], registered: string[] = [];
  const client = Object.create(MagnaBrowserClient.prototype) as any;
  client.env = { requireRealSends: true, issuerAddress: issuer };
  client.userAddress = owner;
  client.ensureContractsRegistered = async () => {};
  client.ensureUserAccountIsDeployed = async () => {};
  client.syncOrchestratorSender = async () => {};
  client.syncWalletPxeIfAvailable = async () => {};
  client.wallet = { registerSender: async (value: unknown) => { registered.push(String(value)); } };
  client.getActiveNotesForStorageSlot = async (_: unknown, slot: Fr) =>
    slot.equals(MagnaIssuerContract.storage.root_status_notes.slot)
      ? secrets.map(secret => ({ note: { items: [new Fr(root), new Fr(secret)] } })) : [];
  client.readRootStatusChainState = async (hint: any) => ({
    status: hint.note.revocation_secret === 404n ? 'active' : 'inactive', reason: 'chain-valid',
  });
  client.issuer = { methods: {
    get_root_status_hinted_by_secret: (_o: unknown, _r: unknown, secret: Fr) => ({ simulate: async () => status(secret.toBigInt()) }),
    get_status_hinted: () => ({ simulate: async () => ({ note: { claims_hash: claims, credential_type: 3n, revocation_secret: 999n } }) }),
    get_linked_credential_hinted: () => ({ simulate: async () => ({ note: { root_commitment: root, claims_hash: claims, credential_type: 3n, expiry_ts: 2000n } }) }),
    get_linked_status_hinted: () => ({ simulate: async () => ({ note: { root_commitment: root, claims_hash: claims, credential_type: 3n,
      revocation_secret: poseidon2HashWithSeparator([404n, 3n, claims], 0x4d414c53) } }) }),
    link_credential_to_root: () => ({ send: async ({ from }: any) => { assert.equal(String(from), owner); sent.push('link'); return { txHash: '0xlink' }; } }),
    revoke_credential: () => ({ send: async () => { sent.push('standalone'); return { txHash: '0xrevoke' }; } }),
    revoke_linked_credential_as_owner: () => ({ send: async () => { sent.push('linked'); return { txHash: '0xrevoke' }; } }),
    revoke_root_as_owner: () => ({ send: async () => { sent.push('root'); return { txHash: '0xroot' }; } }),
  } };
  return { client, sent, registered };
}

describe('credential linking and owner controls', () => {
  it('selects the live Passport root version rather than the oldest PXE note', async () => {
    const { client } = fixture([303n, 404n]);
    const hint = await client.fetchLiveRootStatusHint(root);
    assert.equal(hint.note.revocation_secret, 404n);
  });
  it('keeps revoked Passport roots readable for inactive status display', async () => {
    const { client } = fixture();
    client.readRootStatusChainState = async () => ({ status: 'inactive', reason: 'root-owner-revoked' });
    client.issuer.methods.get_root_authority_hinted = () => ({ simulate: async () => ({ id: 'authority' }) });
    const hints = await client.readRootedPassportHintsOnce(owner, root, claims);
    assert.equal(hints.hintedRootStatusNote.note.revocation_secret, 404n);
    await assert.rejects(() => client.fetchLiveRootStatusHint(root), /No live Passport root/);
  });
  it('discovers linked Instagram with its matching root version and no authority lookup', async () => {
    const { client } = fixture([303n, 404n]);
    const hints = await client.fetchLinkedInstagramHints(root, claims);
    assert.equal(hints.hintedRootStatusNote.note.revocation_secret, 404n);
    assert.equal('hintedRootAuthorityNote' in hints, false);
  });
  it('keeps the old Instagram root version after same-owner recovery so chain validation rejects it', async () => {
    const { client } = fixture([404n, 505n]);
    client.readRootStatusChainState = async (hint: any) => ({ status: hint.note.revocation_secret === 505n ? 'active' : 'inactive' });
    const hints = await client.fetchLinkedInstagramHints(root, claims);
    assert.equal(hints.hintedRootStatusNote.note.revocation_secret, 404n);
  });
  it('links without a local claims witness and registers the holder sender before discovery', async () => {
    const { client, sent, registered } = fixture();
    client.discoverCredentialRefs = async () => [];
    client.fetchPassportHintsByClaimsHash = async () => ({ claimsHash: String(claims), hintedCredentialNote: {}, hintedStatusNote: {} });
    const result = await client.linkCredentialToRoot(claims, root);
    assert.equal(result.txHash, '0xlink');
    assert.deepEqual(sent, ['link']);
    assert.ok(registered.includes(owner));
  });
  it('rediscovers a settled link on retry without submitting conversion again', async () => {
    const { client, sent } = fixture();
    client.discoverCredentialRefs = async () => [{ kind: 'instagram', mode: 'rooted', rootCommitment: String(root), claimsHash: String(claims), issuanceTxHash: '0xsettled' }];
    client.readInstagramChainState = async () => ({ status: 'active' });
    const result = await client.linkCredentialToRoot(claims, root);
    assert.equal(result.txHash, '0xsettled');
    assert.deepEqual(sent, []);
  });
  it('revokes standalone, linked and root notes without claims witnesses', async () => {
    const { client, sent } = fixture();
    client.fetchPassportHintsByClaimsHash = async () => ({ hintedStatusNote: {} });
    await client.revokeCredential({ mode: 'passport', claimsHash: claims });
    await client.revokeCredential({ mode: 'rooted', claimsHash: claims, rootCommitment: root });
    await client.revokeRoot(root);
    assert.deepEqual(sent, ['standalone', 'linked', 'root']);
  });
});

it('Instagram chain state validates version binding, owner root kill switch and standalone independence', async () => {
  const read = (chain as any).readInstagramCredentialChainState;
  const { client } = fixture();
  const linked = await client.fetchLinkedInstagramHints(root, claims);
  const node = {
    getBlockNumber: async () => 77,
    getBlockData: async () => ({ header: { globalVariables: { timestamp: 1000n } } }),
    getNullifierMembershipWitness: async () => undefined,
  };
  assert.equal((await read({ node, issuerAddress: issuer, hints: linked })).status, 'active');
  linked.hintedRootStatusNote = status(505n);
  assert.equal((await read({ node, issuerAddress: issuer, hints: linked })).reason, 'root-version-mismatch');
  let calls = 0;
  node.getNullifierMembershipWitness = async () => (++calls === 3 ? {} as any : undefined);
  linked.hintedRootStatusNote = status(404n);
  assert.equal((await read({ node, issuerAddress: issuer, hints: linked })).reason, 'root-owner-revoked');
  calls = 0;
  const standalone = { claimsHash: String(claims), hintedCredentialNote: { note: { claims_hash: claims, credential_type: 3n, expiry_ts: 2000n } },
    hintedStatusNote: { note: { claims_hash: claims, credential_type: 3n, revocation_secret: 909n } } };
  assert.equal((await read({ node, issuerAddress: issuer, hints: standalone })).status, 'active');
  assert.equal(calls, 1);
});

it('registers holder and orchestrator senders for discovery of both issuance and conversion notes', async () => {
  const { client, registered } = fixture();
  client.env.orchestratorAddress = issuer;
  client.syncOrchestratorSender = MagnaBrowserClient.prototype.syncOrchestratorSender;
  await client.syncOrchestratorSender();
  assert.deepEqual(registered, [owner, issuer]);
});

it('chain status derives the contract owner-root nullifier and identifies revoked or expired independent sources', async () => {
  const { client } = fixture();
  const hints = await client.fetchLinkedInstagramHints(root, claims);
  const queries: any[] = [];
  const node = { getBlockNumber: async () => 77,
    getBlockData: async () => ({ header: { globalVariables: { timestamp: 1000n } } }),
    getNullifierMembershipWitness: async (_block: unknown, nullifier: unknown) => { queries.push(nullifier); return undefined as any; },
  };
  await chain.readInstagramCredentialChainState({ node: node as never, issuerAddress: issuer, hints });
  const { DomainSeparator } = await import('@aztec/constants');
  const { AztecAddress } = await import('@aztec/aztec.js/addresses');
  const expected = poseidon2HashWithSeparator([AztecAddress.fromStringUnsafe(issuer).toField(),
    poseidon2HashWithSeparator([404n, root], 0x4d415257)], DomainSeparator.SILOED_NULLIFIER);
  assert.equal(queries[2].toString(), expected.toString());
  const independent = { claimsHash: String(claims), hintedCredentialNote: { note: { claims_hash: claims, credential_type: 3n, expiry_ts: 1000n } },
    hintedStatusNote: { note: { claims_hash: claims, credential_type: 3n, revocation_secret: 999n } } };
  assert.equal((await chain.readInstagramCredentialChainState({ node: node as never, issuerAddress: issuer, hints: independent })).reason, 'credential-expired');
  node.getNullifierMembershipWitness = async () => ({});
  assert.equal((await chain.readInstagramCredentialChainState({ node: node as never, issuerAddress: issuer, hints: independent })).reason, 'credential-revoked');
});
