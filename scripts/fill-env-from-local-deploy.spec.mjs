import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
for (const template of ["apps/magna-management/.env.example","apps/reference-dapp/.env.example"]) {
  test(`actual ${template} can generate and refresh only its own V6 deployment`,()=>{
    const dir=mkdtempSync(join(tmpdir(),"magna-v6-render-")); const path=join(dir,"manifest.json"),out=join(dir,"app.env");
    const manifest={aztecVersion:"6.0.0",endpoints:{aztecNodeUrl:"http://fresh-node",l1RpcUrl:"http://fresh-l1"},resolvedAztec:{rollupAddress:"rollup",l1ChainId:"31337"},l2:Object.fromEntries(["rightsRegistryAddress","purchaseAdapterAddress","paymentTokenAddress","adminAddress","issuerAddress","companySponsorAddress","referenceDappConsumerAddress"].map(k=>[k,`fresh-${k}`]))};
    const run=()=>spawnSync(process.execPath,["scripts/fill-env-from-local-deploy.mjs","--template",template,"--manifest",path,"--out",out],{encoding:"utf8"});
    try {
      writeFileSync(path,JSON.stringify(manifest));let result=run();assert.equal(result.status,0,result.stderr);
      const generated=readFileSync(out,"utf8");
      result=run();assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(out,"utf8"),generated);assert.match(generated,/^MAGNA_GENERATED_ENV_OWNER=.+$/m);
      manifest.l2.issuerAddress="unrelated-issuer";writeFileSync(path,JSON.stringify(manifest));result=run();assert.notEqual(result.status,0);assert.equal(readFileSync(out,"utf8"),generated);
      writeFileSync(out,"KEEP=unowned-secret\n");result=run();assert.notEqual(result.status,0);assert.equal(readFileSync(out,"utf8"),"KEEP=unowned-secret\n");
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
