import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {Fr} from "@aztec-labs/aztec.js/fields";
import {waitForCommittedInboxWitness} from "./wait-for-inbox.mjs";
async function localFixture(options={}) {
  let included=false,blocks=0,warps=0,witnesses=0;
  const server=createServer(async(req,res)=>{
    let text="";for await(const chunk of req)text+=chunk;const body=JSON.parse(text);
    const respond=({method,id})=>{
      let result;
      if(method==="eth_chainId")result="0x7a69";
      else if(method==="eth_getBlockByNumber")result={number:"0x1",timestamp:`0x${(BigInt(Math.floor(Date.now()/1000))+(options.drift??-2n)).toString(16)}`};
      else if(method==="aztecDebug_warpL2TimeAtLeastTo"){warps++;blocks++;if(!options.neverInclude)included=true;result=null;}
      else throw Error(`Unexpected RPC ${method}`);
      return {jsonrpc:"2.0",id,result};
    };
    res.setHeader("content-type","application/json");res.end(JSON.stringify(Array.isArray(body)?body.map(respond):respond(body)));
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url=`http://127.0.0.1:${server.address().port}`;
  const node={getNodeInfo:async()=>({l1ChainId:options.chainId??31337}),getBlockNumber:async()=>blocks,getL1ToL2MessageIndex:async()=>7n,getBlockData:async()=>({header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:included?8:0}}}})};
  return {input:{node,nodeUrl:url,l1RpcUrl:url,messageHash:new Fr(1n),expectedIndex:7n,getWitness:async()=>{witnesses++;return [options.wrongIndex?8n:7n,[]];},timeoutMs:200,pollMs:1},counts:()=>({warps,witnesses}),close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test("an idle local Inbox makes progress only through guarded empty checkpoints, then validates the exact index",async()=>{
  const f=await localFixture();try {assert.equal((await waitForCommittedInboxWitness(f.input))[0],7n);assert.deepEqual(f.counts(),{warps:1,witnesses:1});}finally{await f.close();}
});
test("the local progress path refuses remote chains",async()=>{
  const f=await localFixture({chainId:11155111});try {await assert.rejects(waitForCommittedInboxWitness(f.input),/31337/);assert.equal(f.counts().warps,0);}finally{await f.close();}
});
test("the local progress path refuses 180-second clock drift",async()=>{
  const f=await localFixture({drift:180n});try {await assert.rejects(waitForCommittedInboxWitness(f.input),/180s ahead/);assert.equal(f.counts().warps,0);}finally{await f.close();}
});
test("missing inclusion is deadline bounded and never obtains a witness",async()=>{
  const f=await localFixture({neverInclude:true});try {await assert.rejects(waitForCommittedInboxWitness({...f.input,timeoutMs:50}),/timed out/);assert.equal(f.counts().witnesses,0);}finally{await f.close();}
});
test("a different observed index is fatal",async()=>{
  const f=await localFixture({wrongIndex:true});try {await assert.rejects(waitForCommittedInboxWitness(f.input),/index mismatch/);}finally{await f.close();}
});
