import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "magna-v6-compose-"));
  mkdirSync(join(dir,"scripts")); mkdirSync(join(dir,"bin"));
  for (const name of ["start-docker-local.mjs","v6-operations.mjs","docker-build-space.mjs"]) {
    copyFileSync(join(root,"scripts",name),join(dir,"scripts",name));
  }
  writeFileSync(join(dir,"compose.yaml"),"name: magna-local-v6\n");
  writeFileSync(join(dir,".env"),"COMPOSE_PROJECT_NAME=magna-local\n");
  writeFileSync(join(dir,"compose.override.yaml"),"name: magna-local\nservices:\n  anvil:\n    image: old-v5-image\n");
  const log = join(dir,"docker.jsonl");
  writeFileSync(join(dir,"bin","docker"),`#!/usr/bin/env node
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);appendFileSync(process.env.MAGNA_DOCKER_TEST_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='compose'&&args.includes('config')) {
  const pinned=args.includes('--project-name')&&args.includes('--file');
  console.log(JSON.stringify({name:process.env.MAGNA_DOCKER_TEST_BAD_CONFIG?'magna-local':pinned?'magna-local-v6':'magna-local',services:{anvil:{image:'azteclabs/aztec:6.0.0@sha256:59b10cc8e89bb9226db1f771a5abbe5d5f8d71483c00c7472187e6ddc7adab8d'},'aztec-localnet':{image:'azteclabs/aztec:6.0.0@sha256:59b10cc8e89bb9226db1f771a5abbe5d5f8d71483c00c7472187e6ddc7adab8d'},bootstrap:{image:'magna-local-app:aztec-6.0.0'}},volumes:{'magna-runtime':{name:'magna-local-v6_magna-runtime'},'magna-deployments':{name:'magna-local-v6_magna-deployments'}}}));
} else if(args[0]==='run') console.log('Filesystem 1024-blocks Used Available Capacity Mounted on\\noverlay 40000000 10000000 30000000 25% /');
else if(args[0]==='image'&&args[1]==='inspect') console.log('sha256:test');
`,{mode:0o755});
  return {dir,log};
}
function runFixture(dir,log,bad=false) {
  const env={...process.env,PATH:`${join(dir,"bin")}:${process.env.PATH}`,MAGNA_DOCKER_TEST_LOG:log};
  delete env.COMPOSE_PROJECT_NAME; delete env.COMPOSE_FILE;
  if(bad)env.MAGNA_DOCKER_TEST_BAD_CONFIG="1";
  return spawnSync(process.execPath,[join(dir,"scripts/start-docker-local.mjs")],{cwd:dir,env,encoding:"utf8"});
}
test("clean launcher pins every Compose read/reset/start despite .env and automatic override files",()=>{
  const {dir,log}=fixture();
  try {
    const run=runFixture(dir,log);assert.equal(run.status,0,run.stderr);
    const calls=readFileSync(log,"utf8").trim().split("\n").map(JSON.parse).filter(args=>args[0]==="compose");
    assert.equal(calls.length,3);
    for(const args of calls) {
      assert.equal(args[args.indexOf("--project-name")+1],"magna-local-v6",JSON.stringify(args));
      assert.equal(args[args.indexOf("--file")+1],realpathSync(join(dir,"compose.yaml")),JSON.stringify(args));
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("unsafe resolved project fails before any chain reset or start",()=>{
  const {dir,log}=fixture();
  try {
    const run=runFixture(dir,log,true);assert.notEqual(run.status,0);assert.match(run.stderr,/V6 Compose/);
    const calls=readFileSync(log,"utf8").trim().split("\n").map(JSON.parse);
    assert.equal(calls.some(args=>args[0]==="compose"&&(args.includes("down")||args.includes("up"))),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
