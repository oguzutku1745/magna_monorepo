import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
if (process.env.MAGNA_MANAGED_LOCAL_CLOCK !== '1') throw new Error('Run with npm run test:localnet:clock:docker');
const wall=()=>Math.floor(Date.now()/1000), delay=ms=>new Promise(r=>setTimeout(r,ms));
const child=spawn('/opt/foundry/bin/anvil',['--silent','--port','18599','--timestamp',String(wall()-7200)],{stdio:'ignore'});
setTimeout(()=>{console.error('TIMEOUT');process.exit(2)},300000).unref();
const rpc=async(method,params=[])=>{const r=await fetch('http://127.0.0.1:18599',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const b=await r.json();if(b.error)throw Error(JSON.stringify(b.error));return b.result;};
const sample=async label=>{const b=await rpc('eth_getBlockByNumber',['latest',false]);const p=await rpc('eth_getBlockByNumber',['pending',false]);const v={label,wall:wall(),l1:Number(BigInt(b.timestamp)),pending:Number(BigInt(p.timestamp)),drift:Number(BigInt(b.timestamp))-wall()};console.log(JSON.stringify(v));return v;};
const base='file:///usr/src/yarn-project/aztec/dest/local-network/local-network.js';
const upstream=s=>import(import.meta.resolve(s,base));
const app=s=>import(import.meta.resolve(s,'file:///workspace/package.json'));
try{
 for(let n=0;n<100;n++){try{await rpc('eth_chainId');break;}catch{await delay(100);}}
 const {createLocalNetwork}=await import(base);
 const result=await createLocalNetwork({l1RpcUrls:['http://127.0.0.1:18599'],testAccounts:true},()=>{});
 console.log('NODE_READY');
 const {registerAztecNodeRpcHandlers}=await upstream('@aztec/aztec-node');
 const {createNamespacedSafeJsonRpcServer,startHttpRpcServer}=await upstream('@aztec/foundation/json-rpc/server');
 const services={};registerAztecNodeRpcHandlers(result.node,services,{}, {debug:true});
 const httpServer=await startHttpRpcServer(createNamespacedSafeJsonRpcServer(services),{port:0});
 const {createAztecNodeClient}=await app('@aztec/aztec.js/node');
 const node=createAztecNodeClient('http://127.0.0.1:'+httpServer.port);
 const {getInitialTestAccountsData}=await app('@aztec/accounts/testing');
 const accounts=await getInitialTestAccountsData();
 const {EmbeddedWallet}=await app('@aztec/wallets/embedded');
 const wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxeConfig:{proverEnabled:false}});wallet.setMinFeePadding(30);
 const account=await wallet.createSchnorrInitializerlessAccount(accounts[0].secret,accounts[0].salt,accounts[0].signingKey,'clock-experiment');
 const owner=account.address;
 const {AztecAddress}=await app('@aztec/aztec.js/addresses');
 const {MagnaIssuerContract}=await import('/workspace/packages/contracts-bindings/src/MagnaIssuer.ts');
 const {MagnaConsumerContract}=await import('/workspace/packages/contracts-bindings/src/MagnaConsumer.ts');
 const {TokenContract}=await app('@aztec/noir-contracts.js/Token');
 const {TxStatus}=await app('@aztec/stdlib/tx');
 const send={from:owner,wait:{waitForStatus:TxStatus.CHECKPOINTED,timeout:45}};
 console.log('DEPLOY_ISSUER');
 const issuer=(await MagnaIssuerContract.deploy(wallet,owner,AztecAddress.ZERO).send(send)).contract;
 console.log('DEPLOY_CONSUMER');
 const consumer=(await MagnaConsumerContract.deploy(wallet,issuer.address).send(send)).contract;
 console.log('DEPLOY_TOKEN');
 const token=(await TokenContract.deploy(wallet,owner,'Clock test','CLK',18).send(send)).contract;
 await issuer.methods.add_consumer_gateway(consumer.address).send(send);
 const unwrap=v=>v && typeof v==='object' && 'result' in v?v.result:v;
 const before=unwrap(await issuer.methods.is_consumer_gateway(consumer.address).simulate({from:owner}));
 console.log(JSON.stringify({label:'gateway before delay',allowed:before}));if(before!==false)throw Error('gateway enabled early');
 const scheduled=await sample('gateway scheduled');
 await result.node.warpL2TimeAtLeastBy(3601);await delay(1000);
 const after=unwrap(await issuer.methods.is_consumer_gateway(consumer.address).simulate({from:owner}));
 console.log(JSON.stringify({label:'gateway after delay',allowed:after}));if(after!==true)throw Error('gateway still disabled');
 const activated=await sample('gateway activated');if(activated.l1-scheduled.l1<3600)throw Error('delay shortened');

 const activation=await fetch('http://127.0.0.1:8090/activate',{method:'POST'});
 const status=await activation.json();
 console.log('CLOCK_ACTIVATION',JSON.stringify(status));
 if(!activation.ok||status.phase!=='realtime')throw Error('activation failed');
 await sample('real-time transition');
 await assert.rejects(result.node.warpL2TimeAtLeastTo(wall()+60), /refuses future warp/);
 // A wall-time recovery sync rounds up to an Aztec slot. Its wait must not
 // expose that future timestamp to unrelated L1 transactions.
 await delay(2000);
 let syncDone=false;
 const sync=result.node.warpL2TimeAtLeastTo(wall()).finally(()=>{syncDone=true;});
 let pendingSamples=0;
 while(!syncDone){
   const pending=await rpc('eth_getBlockByNumber',['pending',false]);
   assert.ok(Number(BigInt(pending.timestamp)) <= wall()+1, 'recovery sync exposed a future pending timestamp');
   pendingSamples++;
   await delay(100);
 }
 await sync;
 console.log(JSON.stringify({label:'recovery sync pending-clock checks',pendingSamples}));
 const {fundLocalFeeJuice}=await import('/workspace/packages/magna-wallet/dist/browser/local-fee-juice.js');
 const timedStart=performance.now();
 for(let i=1;i<=2;i++){
   const began=performance.now();
   const funding=await fundLocalFeeJuice({
     wallet,recipient:owner.toString(),nodeUrl:'http://127.0.0.1:'+httpServer.port,l1RpcUrl:'http://127.0.0.1:18599',
     l1PrivateKey:'0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
     onProgress:stage=>console.log(JSON.stringify({cycle:i,stage,elapsedSeconds:(performance.now()-began)/1000}))
   });
   console.log(JSON.stringify({label:'funding complete',cycle:i,seconds:(performance.now()-began)/1000,checkpoints:funding.localCheckpointsAdvanced,claimTxHash:funding.claimTxHash,balanceDelta:String(funding.balanceAfter-funding.balanceBefore)}));
   const reading = await sample('after funding '+i);
   assert.ok(Math.abs(reading.drift) <= 2, 'funding accumulated clock drift');
   assert.ok(funding.balanceAfter > funding.balanceBefore, 'funding did not increase balance');
 }
 await token.methods.mint_to_public(owner,1n).send(send);
 console.log(JSON.stringify({label:'two funding cycles plus Aztec transaction',seconds:(performance.now()-timedStart)/1000}));
 const reading = await sample('final chain clock');
 assert.ok(Math.abs(reading.drift) <= 2, 'final clock drift');
 assert.ok(performance.now() - timedStart < 180000, 'chain steps exceeded three minutes');
 const balance = unwrap(await token.methods.balance_of_public(owner).simulate({from:owner}));
 assert.equal(BigInt(balance), 1n);
 await delay(5000);
 const idle = await sample('idle pending timestamp');
 assert.ok(Math.abs(idle.pending - idle.wall) <= 2, 'idle Anvil retained a timestamp offset');
 console.log('MANAGED_LOCAL_CLOCK_PASS');
 process.exit(0);
}catch(e){console.error(e.stack?.slice(0,6000));process.exit(1);}
