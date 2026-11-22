import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {makeEnv} from './fixtures.mjs';
import {launchAction} from '../worker/launch-features.js';
import {launchAdmin} from '../worker/launch-operations.js';
import {handleOperations} from '../worker/operations.js';
import {handleLiveRider} from '../worker/commerce.js';

const key=n=>'10000000-1000-4000-8000-'+String(n).padStart(12,'0');
const at='2026-11-16T09:00:00.000Z';
function seedTrip(env){
 env.db.prepare('INSERT INTO riders VALUES(?,?,?,?,?,?,?)').run('rider:fixture','Rider fixture','+966500000019','','active',at,at);
 env.db.prepare('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('support-trip','rider:fixture','captain-fixture','riding','{}','{}',1000,1000,'cash_due',0,at,at);
}
const action=(env,owner,name,body={})=>launchAction(env,'rider',owner,{action:'live_'+name,...body});
const adminRequest=(path,body,actor='owner-fixture')=>new Request('https://hub.test/api/admin/'+path,{method:body?'POST':'GET',headers:{origin:'https://hub.test','content-type':'application/json','oai-authenticated-user-id':actor},...(body?{body:JSON.stringify(body)}:{})});
const caseRequest=(id,body)=>adminRequest('launch/cases'+(id?'?id='+encodeURIComponent(id):''),body);

test('0023 preserves populated support history, deleted high-water IDs and foreign-key integrity transactionally',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('PRAGMA foreign_keys=ON');
  const files=readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort();
  for(const file of files.filter(name=>name<'0023'))db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  seedTrip({db});
  db.prepare('INSERT INTO service_cases VALUES(?,?,?,?,?,?,?,?,?,?)').run('existing-case','support-trip','rider','rider:fixture','technical','Existing support description','in_progress','staff-fixture',at,at);
  db.prepare('INSERT INTO case_messages VALUES(?,?,?,?,?,?)').run(10,'existing-case','rider','rider:fixture','Existing private message',at);
  db.prepare('INSERT INTO case_messages VALUES(?,?,?,?,?,?)').run(300,'existing-case','admin','staff-fixture','Removed message',at);
  db.exec('DELETE FROM case_messages WHERE id=300');
  db.prepare('INSERT INTO trip_messages VALUES(?,?,?,?,?,?)').run(500,'support-trip','rider','rider:fixture','Existing trip message',at);
  const beforeCase=db.prepare('SELECT * FROM service_cases').get(),beforeMessage=db.prepare('SELECT * FROM case_messages').get();
  db.exec('BEGIN');db.exec(readFileSync(new URL('../drizzle/0023_account_support_requests.sql',import.meta.url),'utf8'));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.exec('COMMIT');
  assert.deepEqual(db.prepare('SELECT * FROM service_cases WHERE id=?').get('existing-case'),beforeCase);
  assert.deepEqual(db.prepare('SELECT id,case_id,role,sender_id,body,created_at FROM case_messages').get(),beforeMessage);
  assert.equal(db.prepare('SELECT client_request_id FROM case_messages').get().client_request_id,null);
  const next=db.prepare('INSERT INTO case_messages(case_id,role,sender_id,body,created_at) VALUES(?,?,?,?,?)').run('existing-case','admin','staff-fixture','New reply',at).lastInsertRowid;
  assert.ok(next>300,'AUTOINCREMENT must not reuse deleted message IDs');
  assert.equal(db.prepare('SELECT body,client_request_id FROM trip_messages WHERE id=500').get().body,'Existing trip message');
  db.prepare('INSERT INTO service_cases(id,trip_id,role,owner_id,kind,description,created_at,updated_at) VALUES(?,NULL,?,?,?,?,?,?)').run('general-case','rider','rider:fixture','technical','Account-level support',at,at);
  assert.throws(()=>db.prepare('INSERT INTO case_messages(case_id,role,sender_id,body,created_at) VALUES(?,?,?,?,?)').run('missing-case','rider','rider:fixture','orphan',at),/FOREIGN KEY/);
  assert.throws(()=>db.prepare('UPDATE service_cases SET trip_id=? WHERE id=?').run('missing-trip','general-case'),/FOREIGN KEY/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('service_cases_owner_created','case_messages_cursor','case_messages_client_request','trip_messages_client_request')").all().length===4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_next'").get().n,0);
 }finally{db.close()}
});

test('general help uses the existing service desk and exchanges owner-scoped replies and state with administration',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());
 const created=await action(env,'rider:fixture','case_create',{kind:'technical',description:'The account page does not open correctly',clientRequestId:key(1)});
 const row=env.db.prepare('SELECT * FROM service_cases WHERE id=?').get(created.id);assert.equal(row.trip_id,null);assert.equal(row.owner_id,'rider:fixture');
 const listed=await(await launchAdmin(caseRequest(),env)).json();assert.equal(listed.items[0].id,created.id);
 const reply={id:created.id,body:'Please retry the account page after updating.',assignedTo:'support-agent',status:'in_progress',clientRequestId:key(2)};
 assert.equal((await launchAdmin(caseRequest(null,reply),env)).status,200);
 const conversation=await action(env,'rider:fixture','case_messages',{caseId:created.id});assert.equal(conversation.case.status,'in_progress');assert.equal(conversation.messages.at(-1).role,'admin');
 await assert.rejects(action(env,'rider:other','case_messages',{caseId:created.id}));
 assert.equal((await action(env,'rider:other','cases')).items.length,0);
 await action(env,'rider:fixture','case_messages',{caseId:created.id,body:'That resolved the issue. Thank you.',clientRequestId:key(3)});
 const seen=await(await launchAdmin(caseRequest(created.id),env)).json();assert.equal(seen.messages.at(-1).body,'That resolved the issue. Thank you.');
 await launchAdmin(caseRequest(null,{id:created.id,status:'closed'}),env);
 await launchAdmin(caseRequest(null,reply),env);assert.equal(env.db.prepare('SELECT status FROM service_cases WHERE id=?').get(created.id).status,'closed','retrying an old reply must not revert a newer case status');
 await assert.rejects(action(env,'rider:fixture','case_messages',{caseId:created.id,body:'A new message after close',clientRequestId:key(4)}));
});

test('support creation retries are owner-bound, reject changed payloads and never fabricate a trip',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());seedTrip(env);
 const body={kind:'technical',description:'A repeatable account support request',clientRequestId:key(5)};
 const first=await action(env,'rider:fixture','case_create',body),retry=await action(env,'rider:fixture','case_create',body);
 assert.equal(retry.id,first.id);assert.equal(retry.replayed,true);assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM case_messages').get().n,1);
 await assert.rejects(action(env,'rider:fixture','case_create',{...body,description:'Changed request using the same attempt'}),error=>error.status===409);
 const other=await action(env,'rider:other','case_create',body);assert.notEqual(other.id,first.id);
 await assert.rejects(action(env,'rider:other','case_create',{...body,tripId:'support-trip',clientRequestId:key(6)}));
 await assert.rejects(action(env,'rider:fixture','case_create',{...body,kind:'lost_item',clientRequestId:key(7)}));
 assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM trips').get().n,1);
 const events=env.db.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE action='service_case_created'").get().n;assert.equal(events,2,'one creation event per case, not per retry');
});

test('case and trip messages deduplicate simultaneous retries without hiding mismatched content',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());seedTrip(env);
 const created=await action(env,'rider:fixture','case_create',{kind:'technical',description:'Conversation retry test fixture',clientRequestId:key(8)});
 for(const [name,context] of [['case_messages',{caseId:created.id}],['chat',{tripId:'support-trip'}]]){
  const payload={...context,body:'Only one copy of this message',clientRequestId:key(9)};
  await Promise.all([action(env,'rider:fixture',name,payload),action(env,'rider:fixture',name,payload)]);
  const table=name==='chat'?'trip_messages':'case_messages';assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE client_request_id=?').get(key(9)).n,1);
  await assert.rejects(action(env,'rider:fixture',name,{...payload,body:'Changed message with old request ID'}),error=>error.status===409);
 }
});

test('administrative support retries preserve one ticket while changed payloads return conflict',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());
 const body={subject:'Fixture issue',description:'An administrative support ticket',category:'support',reference:'fixture-account',clientRequestId:key(10)};
 const create=()=>handleOperations(adminRequest('operations/support',body),env);
 const first=await create(),a=await first.json(),retry=await create(),b=await retry.json();assert.equal(first.status,201);assert.equal(retry.status,200);assert.equal(a.id,b.id);
 assert.equal((await handleOperations(adminRequest('operations/support',{...body,description:'Another request using the old attempt'}),env)).status,409);
 assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM support_tickets').get().n,1);
});

test('support gateway rejects anonymous users and returns HTTP409 for reused attempts with changed text',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());const token=env.verifiedToken('fixture');
 const send=body=>handleLiveRider(new Request('https://hub.test/internal/live-rider',{method:'POST',headers:{'x-mishwar-key':'test-rider-key'},body:JSON.stringify(body)}),env,{});
 const body={action:'live_case_create',kind:'technical',description:'Gateway support request fixture',clientRequestId:key(11)};
 assert.equal((await send(body)).status,401);
 assert.equal((await send({...body,sessionToken:token})).status,200);
 assert.equal((await send({...body,sessionToken:token,description:'A different body with the same attempt'})).status,409);
});
