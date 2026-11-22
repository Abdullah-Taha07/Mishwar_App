import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tool=fileURLToPath(new URL('../scripts/maintenance-local.mjs',import.meta.url));
const localRoot=fileURLToPath(new URL('../../../.local-verification/',import.meta.url));
const invoke=(...args)=>spawnSync(process.execPath,[tool,...args],{encoding:'utf8',windowsHide:true,timeout:15000});
function database(t){
  mkdirSync(localRoot,{recursive:true});
  const directory=mkdtempSync(join(localRoot,'maintenance-cli-')),path=join(directory,'local.sqlite'),db=new DatabaseSync(path);
  for(const migration of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));
  db.close();t.after(()=>{unlinkSync(path);rmdirSync(directory)});return path;
}
test('operator tool changes only a supplied local SQLite file with explicit expected state and epoch',t=>{
  const path=database(t),initial=invoke('status',path);assert.equal(initial.status,0);assert.equal(JSON.parse(initial.stdout).mode,'open');
  const draining=invoke('transition',path,'--apply-local','draining','open','1');assert.equal(draining.status,0);assert.equal(JSON.parse(draining.stdout).mode,'draining');
  const frozen=invoke('transition',path,'--apply-local','frozen','draining','1');assert.equal(frozen.status,0);assert.equal(JSON.parse(frozen.stdout).epoch,2);
  const stale=invoke('transition',path,'--apply-local','open','frozen','1');assert.equal(stale.status,1);assert.equal(JSON.parse(invoke('status',path).stdout).mode,'frozen');
});
test('operator tool rejects URLs, SQL, missing local confirmation and extra force flags without echoing arguments',t=>{
  const path=database(t);
  for(const args of [['status','https://private-fixture.invalid/database'],['transition',path,'draining','open','1'],['transition',path,'--apply-local','draining','open','1','--force'],['status',path,'SELECT private-fixture-value']]){
    const result=invoke(...args);assert.equal(result.status,1);assert.doesNotMatch(result.stderr,/private-fixture|\.sqlite|SELECT|https:\/\//);assert.equal(JSON.parse(invoke('status',path).stdout).mode,'open');
  }
});
test('operator tool refuses an existing file outside its explicit private local roots',t=>{
  const directory=mkdtempSync(join(tmpdir(),'mishwar-maintenance-outside-')),path=join(directory,'local.sqlite');writeFileSync(path,'not a database');t.after(()=>{unlinkSync(path);rmdirSync(directory)});
  const result=invoke('status',path);assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).code,'LOCAL_SQLITE_PATH_REQUIRED');
  assert.equal(readFileSync(path,'utf8'),'not a database');
});
