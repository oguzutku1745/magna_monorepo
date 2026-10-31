import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertV6Manifest, assertFreshOutput, isCurrentLocalImage } from './v6-operations.mjs';
test('rejects V5 and unversioned manifests before reuse or write',()=>{
  assert.throws(()=>assertV6Manifest({aztecVersion:'5.1.0'}),/fresh Aztec 6.0.0/);
  assert.throws(()=>assertV6Manifest({l2:{issuerAddress:'old'}}),/fresh Aztec 6.0.0/);
  assert.doesNotThrow(()=>assertV6Manifest({aztecVersion:'6.0.0'}));
});
test('preserves existing generated env output when deploying fresh state',()=>{
  const dir=mkdtempSync(join(tmpdir(),'magna-v6-output-'));const path=join(dir,'app.env');
  try { assert.doesNotThrow(()=>assertFreshOutput(path));writeFileSync(path,'secret=old');assert.throws(()=>assertFreshOutput(path),/already exists/);assert.equal(readFileSync(path,'utf8'),'secret=old'); } finally {rmSync(dir,{recursive:true});}
});
test('image cleanup matches only explicitly labelled V6 app images',()=>{
  assert.equal(isCurrentLocalImage({Config:{Labels:{'io.magna.local-app':'true','io.magna.aztec-version':'6.0.0'}}}),true);
  assert.equal(isCurrentLocalImage({Config:{Labels:{'io.magna.local-app':'true'}}}),false);
  assert.equal(isCurrentLocalImage({Config:{Labels:{'io.magna.local-app':'true','io.magna.aztec-version':'5.1.0'}}}),false);
  assert.equal(isCurrentLocalImage({Config:{WorkingDir:'/workspace',Cmd:['node','./scripts/start-docker-service.mjs','management']}}),false);
});

test('bootstrap rejects an explicit V5 manifest before changing env files or contacting RPC', async()=>{
  const { spawnSync } = await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'magna-v6-old-'));const manifest=join(dir,'old.json');const env=join(dir,'old.env');
  try {
    writeFileSync(manifest,JSON.stringify({aztecVersion:'5.1.0',endpoints:{aztecNodeUrl:'http://never-contact.invalid'}}));writeFileSync(env,'KEEP=secret');
    const run=spawnSync(process.execPath,['scripts/bootstrap-local-apps.mjs','--manifest',manifest,'--management-env-out',env,'--reference-dapp-env-out',join(dir,'new.env')],{encoding:'utf8'});
    assert.notEqual(run.status,0);assert.match(run.stderr,/fresh Aztec 6.0.0 deployment manifest/);assert.equal(readFileSync(env,'utf8'),'KEEP=secret');
  } finally {rmSync(dir,{recursive:true});}
});

test('wrapper cannot treat a complete V5 deployment as successful V6 bootstrap',async()=>{
  const { spawnSync } = await import('node:child_process');
  const dir=mkdtempSync(join(tmpdir(),'magna-v6-wrapper-'));const manifest=join(dir,'old.json');const env=join(dir,'old.env');
  const l2=Object.fromEntries(['adminAddress','rightsRegistryAddress','purchaseAdapterAddress','paymentTokenAddress','issuerAddress','companySponsorAddress','consumerAddress','referenceDappConsumerAddress'].map(k=>[k,'old']));l2.webBootstrap={orchestratorAddress:'old'};
  const text=['VITE_MAGNA_ISSUER_ADDRESS','VITE_MAGNA_COMPANY_SPONSOR_ADDRESS','VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS','VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS','VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS','VITE_REFERENCE_DAPP_GATEWAY'].map(k=>`${k}=old`).join('\n')+'\nVITE_MAGNA_WALLET_ORIGIN=http://localhost:5174\n';
  try {writeFileSync(manifest,JSON.stringify({aztecVersion:'5.1.0',l2}));writeFileSync(env,text);
    const run=spawnSync(process.execPath,['scripts/bootstrap-local-apps-wrapper.mjs','--manifest',manifest,'--management-env-out',env,'--reference-dapp-env-out',env],{encoding:'utf8'});
    assert.notEqual(run.status,0,run.stdout);assert.match(run.stderr,/fresh Aztec 6.0.0/);assert.equal(readFileSync(env,'utf8'),text);
  }finally{rmSync(dir,{recursive:true});}
});

test('rejects inherited Compose overrides that could select old resources',async()=>{
  const {assertV6ComposeEnvironment}=await import('./v6-operations.mjs');
  assert.throws(()=>assertV6ComposeEnvironment({COMPOSE_PROJECT_NAME:'magna-local'}),/V6 Compose project/);
  assert.throws(()=>assertV6ComposeEnvironment({COMPOSE_FILE:'old-compose.yaml'}),/COMPOSE_FILE/);
  assert.doesNotThrow(()=>assertV6ComposeEnvironment({}));
  assert.doesNotThrow(()=>assertV6ComposeEnvironment({COMPOSE_PROJECT_NAME:'magna-local-v6'}));
});

test('V6 node handshake selects real proving for public targets and rejects mismatched versions',async()=>{
  const {v6NodeProverEnabled}=await import('./v6-operations.mjs');
  assert.equal(v6NodeProverEnabled({nodeVersion:'6.0.0',realProofs:true,l1ChainId:11155111}),true);
  assert.equal(v6NodeProverEnabled({nodeVersion:'6.0.0',realProofs:false,l1ChainId:31337},{localOnly:true}),false);
  assert.throws(()=>v6NodeProverEnabled({nodeVersion:'5.1.0',realProofs:false,l1ChainId:31337}),/Aztec 6.0.0/);
  assert.throws(()=>v6NodeProverEnabled({nodeVersion:'6.0.0',realProofs:true,l1ChainId:11155111},{localOnly:true}),/31337/);
});
