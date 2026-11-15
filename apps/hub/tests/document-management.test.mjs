import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {captainDocuments,documentManagement,renewalAdmin} from '../worker/document-renewal.js';
import {handleAdmin} from '../worker/admin.js';
const id='11111111-1111-4111-8111-111111111111';
const request=(body,origin='https://test.local')=>new Request('https://test.local/api/admin/launch/renewals',{method:'POST',headers:{origin,'oai-authenticated-user-id':'reviewer','content-type':'application/json'},body:JSON.stringify(body)});
function seed(e,rid='renew',kind='insurance',expiry='2031-01-01'){e.db.prepare('INSERT INTO document_renewals(id,captain_id,kind,expires_at,object_key,mime_type,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)').run(rid,id,kind,expiry,'replacement/'+rid,'application/pdf',123,new Date().toISOString());e.objects.set('replacement/'+rid,'%PDF-test')}
test('classification includes exact day boundaries, missing files, invalid dates and pending without hiding expiry',()=>{
 const row={id,name:'Captain',vehicle_json:JSON.stringify({identityExpiry:'2026-11-14',licenseExpiry:'2026-12-15',registrationExpiry:'2026-12-16',insuranceExpiry:'2026-02-30'}),documents_json:JSON.stringify(Object.fromEntries(['identity','license','registration','insurance'].map(k=>[k,{key:k}])))};
 const x=captainDocuments(row,[{kind:'identity',status:'pending'}],'2026-11-15');assert.deepEqual(x.documents.slice(0,4).map(d=>d.state),['expired','expiring','valid','missing']);assert.ok(x.states.includes('pending'));assert.equal(x.priority,0);
 row.documents_json='{}';assert.ok(captainDocuments(row,[],'2026-11-15').documents.every(d=>d.state==='missing'));
});
test('all captains including healthy ones, counters, search, filter and renewal priority',async()=>{
 const e=makeEnv(true);let d=await(await documentManagement(new Request('https://test.local'),e)).json();assert.equal(d.counters.valid,1);assert.equal(d.items.length,1);seed(e);d=await(await documentManagement(new Request('https://test.local?state=pending&q=KM-11111111'),e)).json();assert.equal(d.items[0].renewals.length,1);assert.equal(d.counters.pending,1);assert.equal((await(await documentManagement(new Request('https://test.local?q=absent'),e)).json()).total,0);
});
test('independent decisions preserve other documents and append durable audit with actor and previous values',async()=>{
 const e=makeEnv(true);seed(e);seed(e,'second','license');const before=e.db.prepare('SELECT documents_json FROM captain_applications').get().documents_json;
 assert.equal((await renewalAdmin(request({id:'renew',decision:'approved',confirmReviewed:true}),e)).status,200);
 let row=e.db.prepare('SELECT * FROM captain_applications').get();assert.equal(JSON.parse(row.vehicle_json).insuranceExpiry,'2031-01-01');assert.equal(JSON.parse(row.documents_json).insurance.key,'replacement/renew');assert.deepEqual(JSON.parse(row.documents_json).license,JSON.parse(before).license);
 assert.equal((await renewalAdmin(request({id:'second',decision:'rejected',reason:'Wrong document'}),e)).status,200);assert.equal(e.db.prepare('SELECT count(*) n FROM document_review_history').get().n,2);assert.equal(e.db.prepare('SELECT reviewer_id FROM document_review_history LIMIT 1').get().reviewer_id,'reviewer');
 assert.equal((await renewalAdmin(request({id:'renew',decision:'rejected',reason:'late review'}),e)).status,409);assert.equal(e.db.prepare('SELECT count(*) n FROM document_review_history').get().n,2);
});
test('reject unsafe or stale approvals, require reason, enforce origin and admin access',async()=>{
 const e=makeEnv(true);seed(e);seed(e,'expired','license','2000-01-01');
 for(const b of [{id:'renew',decision:'approved'},{id:'renew',decision:'rejected',reason:'x'},{id:'expired',decision:'approved',confirmReviewed:true}])assert.equal((await renewalAdmin(request(b),e)).status,400);
 assert.equal((await renewalAdmin(request({id:'renew',decision:'approved',confirmReviewed:true},'https://evil.local'),e)).status,403);
 assert.equal((await handleAdmin(new Request('https://test.local/api/admin/launch/documents'),e)).status,403);
 assert.equal(e.db.prepare('SELECT count(*) n FROM document_review_history').get().n,0);
});
test('transaction rollback preserves pending request and original files when audit insert fails',async()=>{
 const e=makeEnv(true);seed(e);e.db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON document_review_history BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.equal((await renewalAdmin(request({id:'renew',decision:'approved',confirmReviewed:true}),e)).status,400);assert.equal(e.db.prepare('SELECT status FROM document_renewals').get().status,'pending');assert.equal(JSON.parse(e.db.prepare('SELECT vehicle_json FROM captain_applications').get().vehicle_json).insuranceExpiry,'2030-01-01');
});
test('pagination includes captains beyond 500 and old renewals beyond 100',async()=>{
 const e=makeEnv(true),row=e.db.prepare('SELECT * FROM captain_applications').get();
 const insert=e.db.prepare('INSERT INTO captain_applications VALUES(?,?,?,?,?,?,?,?,?,?)');
 for(let n=0;n<505;n++)insert.run('captain-'+n,'user-'+n,'phone-'+n,'captain'+n+'@example.com',row.personal_json,row.vehicle_json,row.documents_json,'active',row.submitted_at,null);
 for(let n=0;n<105;n++){seed(e,'old-'+n);e.db.prepare("UPDATE document_renewals SET status='rejected' WHERE id=?").run('old-'+n)}
 const data=await(await documentManagement(new Request('https://test.local'),e)).json();assert.equal(data.items.length,506);assert.equal(data.counters.total,506);assert.equal(data.items.find(x=>x.id===id).renewals.length,105);
});
test('protected files keep safe headers and missing files return 404',async()=>{
 const e=makeEnv(true);seed(e);
 for(const path of ['?file=renew','?captain='+id+'&kind=identity']){const r=await renewalAdmin(new Request('https://test.local/api/admin/launch/renewals'+path),e);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.ok(r.headers.get('content-security-policy').includes('sandbox'))}
 assert.equal((await renewalAdmin(new Request('https://test.local?captain='+id+'&kind=unknown'),e)).status,404);
});
test('a review that loses its pending claim cannot change documents or emit audit events',async()=>{
 const e=makeEnv(true);seed(e);const batch=e.DB.batch;
 e.DB.batch=async items=>{e.db.prepare("UPDATE document_renewals SET status='rejected' WHERE id='renew'").run();return batch(items)};
 assert.equal((await renewalAdmin(request({id:'renew',decision:'approved',confirmReviewed:true}),e)).status,409);assert.equal(e.db.prepare('SELECT count(*) n FROM document_review_history').get().n,0);assert.equal(e.db.prepare("SELECT count(*) n FROM operation_events WHERE action LIKE 'document_renewal_%'").get().n,0);assert.equal(JSON.parse(e.db.prepare('SELECT vehicle_json FROM captain_applications').get().vehicle_json).insuranceExpiry,'2030-01-01');
});
