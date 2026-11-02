import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, decodeEventLog } from 'viem';
import { inboxMessageSentEvent, selectInboxMessage } from './inbox-message.mjs';
const field = n => `0x${n.toString(16).padStart(64,'0')}`;
const sender = `0x${'1'.repeat(40)}`;
const message = {sender:{actor:sender,chainId:31337n},recipient:{actor:field(2),version:1n},content:field(3),secretHash:field(4),index:7n};
const expected = {hash:field(5),index:7n,recipient:field(2),sender,content:field(3),secretHash:field(4)};
test('decodes the canonical V6 MessageSent tuple and selects exact identity among unrelated logs',()=>{
  const data=encodeAbiParameters(inboxMessageSentEvent.inputs.filter(i=>!i.indexed),[field(6),9n,message]);
  const topics=encodeEventTopics({abi:[inboxMessageSentEvent],eventName:'MessageSent',args:{hash:field(5)}});
  const decoded=decodeEventLog({abi:[inboxMessageSentEvent],data,topics});
  assert.equal(selectInboxMessage([{args:{...decoded.args,hash:field(99)}},decoded],expected),7n);
  for(const key of ['hash','index','recipient','sender','content','secretHash']) {
    assert.throws(()=>selectInboxMessage([decoded],{...expected,[key]:key==='index'?8n:field(99)}),/exactly one matching/);
  }
  assert.throws(()=>selectInboxMessage([decoded,decoded],expected),/found 2/);
});
