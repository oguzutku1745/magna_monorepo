import test from "node:test";
import assert from "node:assert/strict";
import {copyFileSync,mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {dirname,join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
function fixture(mode) {
  const dir=mkdtempSync(join(tmpdir(),"magna-v6-worker-"));mkdirSync(join(dir,"scripts"));
  for(const name of ["bootstrap-local-apps-wrapper.mjs","v6-operations.mjs"])copyFileSync(join(root,"scripts",name),join(dir,"scripts",name));
  const manifestPath=join(dir,"manifest.json"),management=join(dir,"management.env"),reference=join(dir,"reference.env");
  const l2=Object.fromEntries(["adminAddress","rightsRegistryAddress","purchaseAdapterAddress","paymentTokenAddress","issuerAddress","companySponsorAddress","consumerAddress","referenceDappConsumerAddress"].map(k=>[k,"fresh"]));l2.webBootstrap={orchestratorAddress:"fresh"};
  const manifest=JSON.stringify({aztecVersion:"6.0.0",l2});
  const output=["VITE_MAGNA_ISSUER_ADDRESS","VITE_MAGNA_COMPANY_SPONSOR_ADDRESS","VITE_MAGNA_RIGHTS_REGISTRY_ADDRESS","VITE_MAGNA_RIGHTS_PURCHASE_L2_ADDRESS","VITE_MAGNA_L2_PAYMENT_TOKEN_ADDRESS","VITE_REFERENCE_DAPP_GATEWAY"].map(k=>`${k}=fresh`).join("\n")+"\nVITE_MAGNA_WALLET_ORIGIN=http://localhost:5174\n";
  writeFileSync(manifestPath,manifest);
  if(mode==="preexisting"){writeFileSync(management,output);writeFileSync(reference,output);}
  writeFileSync(join(dir,"scripts/bootstrap-local-apps.mjs"),`
import {writeFileSync,existsSync} from 'node:fs';
if(existsSync(${JSON.stringify(management)}))throw Error('Generated environment output already exists');
writeFileSync(${JSON.stringify(management)},${JSON.stringify(output)});
writeFileSync(${JSON.stringify(reference)},${JSON.stringify(output)});
${mode==="complete"?"if(process.send) await new Promise(resolve=>process.send({type:'magna-bootstrap-complete',runId:process.env.MAGNA_BOOTSTRAP_RUN_ID},resolve)); process.exit(134);":"throw Error('genuine failure after checkpoint outputs');"}
`);
  const run=()=>spawnSync(process.execPath,[join(dir,"scripts/bootstrap-local-apps-wrapper.mjs"),"--manifest",manifestPath,"--management-env-out",management,"--reference-dapp-env-out",reference],{encoding:"utf8"});
  return {dir,management,reference,run};
}
test("complete pre-existing V6 outputs cannot hide a fresh-output refusal",()=>{
  const f=fixture("preexisting");try {const before=readFileSync(f.management,"utf8"),run=f.run();assert.notEqual(run.status,0,run.stdout);assert.match(run.stderr,/already exists/);assert.equal(readFileSync(f.management,"utf8"),before);}finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("a genuine worker failure after complete checkpoint output remains a failure",()=>{
  const f=fixture("late-failure");try {const run=f.run();assert.notEqual(run.status,0,run.stdout);assert.match(run.stderr,/genuine failure after checkpoint/);assert.match(readFileSync(f.management,"utf8"),/VITE_MAGNA_ISSUER_ADDRESS=fresh/);}finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("this run's explicit completion permits the known nonzero native teardown outcome",()=>{
  const f=fixture("complete");try {const run=f.run();assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/complete local outputs after Aztec worker teardown/);}finally{rmSync(f.dir,{recursive:true,force:true});}
});
