import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {restorePrivateSql,exposureManifest,assessLocalAccounts,summarizeAssessment,rehearseAccountContainment} from './account-containment.mjs';

const account=(role,actor,phone)=>({role,actor,phone,email:actor+'@example.test',password_hash:'a'.repeat(64),salt:'b'.repeat(64)});
const accounts=[account('rider','rider-local-target','+966500000001'),account('captain','captain-local-other','+966500000001'),account('rider','rider-local-other','+966500000002')];
const schema=`CREATE TABLE public_accounts(role TEXT,actor TEXT UNIQUE,phone TEXT,email TEXT,password_hash TEXT,salt TEXT,PRIMARY KEY(role,phone));
CREATE TABLE public_sessions(token_hash TEXT PRIMARY KEY,role TEXT,actor TEXT,expires_at TEXT);
CREATE TABLE rider_sessions(token_hash TEXT PRIMARY KEY,actor TEXT,phone TEXT,expires_at TEXT);
CREATE TABLE account_recovery(id TEXT PRIMARY KEY,role TEXT,actor TEXT,expires_at TEXT,consumed_at TEXT);
CREATE TABLE email_auth_tokens(id TEXT PRIMARY KEY,role TEXT,actor TEXT,expires_at TEXT);
CREATE TABLE public_phone_otp(id TEXT PRIMARY KEY,role TEXT,actor TEXT,phone TEXT,expires_at TEXT);
CREATE TABLE account_changes(id TEXT PRIMARY KEY,role TEXT,actor TEXT,expires_at TEXT);
CREATE TABLE phone_challenges(id TEXT PRIMARY KEY,phone TEXT,expires_at TEXT);
CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY,role TEXT,actor_id TEXT,session_hash TEXT);
CREATE TABLE native_device_tokens(id TEXT PRIMARY KEY,role TEXT,actor_id TEXT,session_hash TEXT);
CREATE TABLE wallets(id TEXT PRIMARY KEY,balance INTEGER);`;
function fixture({changed=false,secondTarget=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'mishwar-account-containment-'));
 const db=new DatabaseSync(':memory:');db.exec(schema);
 for(const a of accounts)db.prepare('INSERT INTO public_accounts VALUES(?,?,?,?,?,?)').run(a.role,a.actor,a.phone,a.email,changed&&a.actor===accounts[0].actor?'c'.repeat(64):a.password_hash,a.salt);
 for(const [i,a]of accounts.entries()){
  db.prepare('INSERT INTO public_sessions VALUES(?,?,?,?)').run('session-'+i,a.role,a.actor,'2030-01-01T00:00:00Z');
  if(a.role==='rider')db.prepare('INSERT INTO rider_sessions VALUES(?,?,?,?)').run('legacy-'+i,a.actor,a.phone,'2030-01-01T00:00:00Z');
  for(const table of ['account_recovery','email_auth_tokens','public_phone_otp','account_changes']){
   const values=table==='public_phone_otp'?[table+i,a.role,a.actor,a.phone,'2030-01-01T00:00:00Z']:table==='account_recovery'?[table+i,a.role,a.actor,'2030-01-01T00:00:00Z',null]:[table+i,a.role,a.actor,'2030-01-01T00:00:00Z'];
   db.prepare(`INSERT INTO ${table} VALUES(${values.map(()=>'?').join(',')})`).run(...values);
  }
  for(const table of ['push_subscriptions','native_device_tokens'])db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?)`).run(table+i,a.role,a.actor,'session-'+i);
  if(a.role==='rider')db.prepare('INSERT INTO phone_challenges VALUES(?,?,?)').run('legacy-proof-'+i,a.phone,'2030-01-01T00:00:00Z');
 }
 db.exec("INSERT INTO wallets VALUES('unrelated-financial-ledger',12345)");
 const statements=[schema];
 for(const {name}of db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()){
  const cols=db.prepare(`PRAGMA table_info("${name}")`).all().map(x=>x.name);
  for(const row of db.prepare(`SELECT ${cols.map(c=>`quote("${c}") AS "${c}"`).join(',')} FROM "${name}"`).all())statements.push(`INSERT INTO "${name}" VALUES(${cols.map(c=>row[c]).join(',')});`);
 }
 const path=join(dir,'fixture.sql');writeFileSync(path,statements.join('\n'));
 const exposed={format:'mishwar-account-exposure-v1',accounts:secondTarget?[accounts[0],accounts[1]]:[accounts[0]],exposedRecordCounts:{public_accounts:secondTarget?2:1,public_sessions:1,account_recovery:1}};
 db.close();return {dir,path,exposed};
}

test('assessment never classifies identities as real from their names and distinguishes changed or missing credentials',()=>{
 const f=fixture({changed:true}),db=restorePrivateSql(readFileSync(f.path));
 try{
  const assessment=assessLocalAccounts({...f.exposed,accounts:[...f.exposed.accounts,account('rider','missing-local-fixture','+966500000009')]},db,'2026-11-16T00:00:00Z');
  assert.deepEqual(assessment.assessments.map(x=>x.state),['password-already-changed','not-present']);
  const summary=summarizeAssessment(f.exposed,assessment);assert.equal(summary.passwordAlreadyChanged,1);assert.match(summary.realOwnerClassification,/requires-owner-confirmation/);
  assert.equal(JSON.stringify(summary).includes(accounts[0].actor),false);assert.equal(JSON.stringify(summary).includes(accounts[0].phone),false);
 }finally{db.close()}
});

test('local containment expires only selected proofs, revokes all selected sessions, and preserves other roles and financial data',()=>{
 const f=fixture(),at='2026-11-16T00:00:00Z';
 const result=rehearseAccountContainment({sqlPath:f.path,exposure:f.exposed,selectedAccounts:[accounts[0]],outputDirectory:join(f.dir,'result'),at});
 assert.equal(result.report.passed,true);assert.equal(result.report.productionChanges,false);assert.equal(result.report.checks.accountCredentialsUnchanged,true);
 const db=new DatabaseSync(result.databasePath,{readOnly:true});
 try{
  assert.equal(db.prepare('SELECT count(*) AS n FROM public_sessions WHERE actor=?').get(accounts[0].actor).n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM public_sessions WHERE role=?').get('captain').n,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM rider_sessions').get().n,1);
  assert.equal(db.prepare('SELECT expires_at FROM account_recovery WHERE actor=?').get(accounts[0].actor).expires_at,at);
  assert.equal(db.prepare('SELECT expires_at FROM account_recovery WHERE actor=?').get(accounts[1].actor).expires_at,'2030-01-01T00:00:00Z');
  assert.equal(db.prepare('SELECT count(*) AS n FROM push_subscriptions').get().n,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM native_device_tokens').get().n,2);
  assert.equal(db.prepare('SELECT balance FROM wallets').get().balance,12345);
  assert.equal(db.prepare('SELECT password_hash FROM public_accounts WHERE actor=?').get(accounts[0].actor).password_hash,accounts[0].password_hash);
 }finally{db.close()}
 const report=readFileSync(result.reportPath,'utf8');for(const a of accounts)assert.equal(report.includes(a.phone)||report.includes(a.actor)||report.includes(a.password_hash),false);
});

test('a password changed after exposure aborts all selected targets without revoking even the first target',()=>{
 const f=fixture({changed:true,secondTarget:true});
 // Put the valid target first: the stale second target must prevent all effects.
 assert.throws(()=>rehearseAccountContainment({sqlPath:f.path,exposure:f.exposed,selectedAccounts:[...f.exposed.accounts].reverse(),outputDirectory:join(f.dir,'result')}),e=>e.code==='STALE_OR_CHANGED_ACCOUNT_ABORT_ALL');
 const db=new DatabaseSync(join(f.dir,'result','account-containment-rehearsal.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare('SELECT count(*) AS n FROM public_sessions').get().n,3);assert.equal(db.prepare('SELECT count(*) AS n FROM account_recovery WHERE expires_at=?').get('2030-01-01T00:00:00Z').n,3)}finally{db.close()}
});

test('an identity outside the exposed manifest and a duplicated target are rejected before mutation',()=>{
 const f=fixture();
 assert.throws(()=>rehearseAccountContainment({sqlPath:f.path,exposure:f.exposed,selectedAccounts:[accounts[1]],outputDirectory:join(f.dir,'outside')}),e=>e.code==='TARGET_NOT_IN_EXPOSED_MANIFEST');
 assert.throws(()=>rehearseAccountContainment({sqlPath:f.path,exposure:f.exposed,selectedAccounts:[accounts[0],accounts[0]],outputDirectory:join(f.dir,'duplicate')}),e=>e.code==='DUPLICATE_TARGET');
 assert.throws(()=>rehearseAccountContainment({sqlPath:f.path,exposure:f.exposed,selectedAccounts:[],outputDirectory:join(f.dir,'empty')}),e=>e.code==='EXPLICIT_SELECTION_REQUIRED');
});

test('restoration rejects placeholder SQL and cannot attach an external database',()=>{
 assert.throws(()=>restorePrivateSql(Buffer.from('-- TEST FILE ONLY')),/REAL_SQL_REQUIRED/);
 assert.throws(()=>restorePrivateSql(Buffer.from("CREATE TABLE x(id); ATTACH DATABASE 'forbidden.sqlite' AS other;")),/PRIVATE_SQL_RESTORE_FAILED/);
});

test('a recreated identity using the same phone and credential tuple cannot be targeted by phone',()=>{
 const f=fixture(),bytes=readFileSync(f.path,'utf8').replaceAll('rider-local-target','rider-local-recreated');writeFileSync(f.path,bytes);
 const db=restorePrivateSql(readFileSync(f.path));
 try{
  const assessment=assessLocalAccounts(f.exposed,db);
  assert.equal(assessment.assessments[0].state,'not-present');assert.equal(assessment.assessments[0].contactReusedByDifferentIdentity,true);
 }finally{db.close()}
 assert.throws(()=>rehearseAccountContainment({sqlPath:f.path,exposure:f.exposed,selectedAccounts:[accounts[0]],outputDirectory:join(f.dir,'result')}),e=>e.code==='STALE_OR_CHANGED_ACCOUNT_ABORT_ALL');
 const after=new DatabaseSync(join(f.dir,'result','account-containment-rehearsal.sqlite'),{readOnly:true});
 try{assert.equal(after.prepare('SELECT count(*) AS n FROM public_sessions').get().n,3);assert.equal(after.prepare('SELECT password_hash FROM public_accounts WHERE actor=?').get('rider-local-recreated').password_hash,accounts[0].password_hash)}finally{after.close()}
});

test('an existing local output directory cannot be overwritten during a repeated rehearsal',()=>{
 const f=fixture(),options={sqlPath:f.path,exposure:f.exposed,selectedAccounts:[accounts[0]],outputDirectory:join(f.dir,'result')};
 const initial=rehearseAccountContainment(options);const bytes=readFileSync(initial.databasePath);
 assert.throws(()=>rehearseAccountContainment(options),e=>e.code==='EEXIST');assert.deepEqual(readFileSync(initial.databasePath),bytes);
});
