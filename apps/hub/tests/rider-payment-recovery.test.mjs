import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {handleLiveRider} from '../worker/commerce.js';
import {handleMoyasarWebhook} from '../worker/payment-webhook.js';
import {refundAction} from '../worker/refunds.js';

const origin='https://offline.mishwar.test';
const at=()=>new Date().toISOString();
const eFactory=()=>{const e=makeEnv(true);Object.assign(e,{MOYASAR_ENABLED:'true',MOYASAR_SECRET_KEY:'sk_live_OFFLINE_TEST_ONLY',MOYASAR_PUBLIC_KEY:'pk_live_OFFLINE_TEST_ONLY',MOYASAR_WEBHOOK_SECRET:'offline-32-character-shared-secret-000001'});return e};
const asRider=(e,actor,action,extra={})=>handleLiveRider(new Request(origin+'/internal/live-rider',{method:'POST',headers:{origin,'content-type':'application/json','x-mishwar-key':'test-rider-key'},body:JSON.stringify({action,sessionToken:e.verifiedToken(actor),...extra})}),e);
const webhook=(e,data,secret=e.MOYASAR_WEBHOOK_SECRET,header=secret)=>handleMoyasarWebhook(new Request(origin+'/api/payments/moyasar-webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Event-Secret':header},body:JSON.stringify({type:'payment_paid',id:'event-offline',live:true,secret_token:secret,data})}),e);
const balance=(e,actor)=>e.db.prepare('SELECT balance_halalas AS balance FROM wallet_accounts WHERE account_id=?').get('rider:'+actor)?.balance||0;
const createdIntent=(e,{id='intent-offline-01',actor='qa',purpose='trip',amount=2400,quoteId=null}={})=>{e.db.prepare("INSERT INTO payment_intents(id,rider_id,quote_id,purpose,method,amount_halalas,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)").run(id,'rider:'+actor,quoteId,purpose,'card',amount,at());return {id,actor,purpose,amount}};
const mockedPayment=(intent,paymentId='provider-paid-00001')=>({id:paymentId,status:'paid',amount:intent.amount,currency:'SAR',metadata:{intent_id:intent.id},source:{type:'creditcard'}});
const fetchMock=async (fn)=>{const old=globalThis.fetch;globalThis.fetch=fn;return()=>{globalThis.fetch=old}};

test('webhook rejects missing/incorrect secret without querying payment provider',async()=>{
 const e=eFactory(),p=createdIntent(e);let calls=0;
 const restore=await fetchMock(async()=>{calls++;throw Error('must not fetch')});
 try{
  assert.equal((await webhook(e,mockedPayment(p),'invalid-secret','invalid-secret')).status,403);
  assert.equal((await webhook(e,mockedPayment(p),e.MOYASAR_WEBHOOK_SECRET,'not-the-secret')).status,403);
  assert.equal(calls,0);assert.equal(balance(e,'qa'),0);
 }finally{restore()}
});

test('webhook verifies provider response, credits wallet once, rejects mismatches and allows paid retry',async()=>{
 const e=eFactory(),p=createdIntent(e);let provider=mockedPayment(p),calls=0;
 const restore=await fetchMock(async(url)=>{calls++;assert.match(url,/api\.moyasar\.com\/v1\/payments\/provider-paid-00001/);return Response.json(provider)});
 try{
  provider={...provider,amount:9999};assert.equal((await webhook(e,mockedPayment(p))).status,409);
  assert.equal(balance(e,'qa'),0);
  provider=mockedPayment(p);
  const good=await webhook(e,mockedPayment(p));assert.equal(good.status,200);assert.equal(balance(e,'qa'),2400);
  assert.equal((await webhook(e,mockedPayment(p))).status,200);assert.equal(balance(e,'qa'),2400);
  assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM wallet_entries').get().n,2);
  assert.equal((await webhook(e,{id:'provider-other-00002',metadata:{intent_id:p.id}})).status,409);
  assert.equal(calls,2);
 }finally{restore()}
});

test('webhook verification event is harmless, and webhook remains disabled without configuration',async()=>{
 const e=eFactory(),secret=e.MOYASAR_WEBHOOK_SECRET;
 const result=await handleMoyasarWebhook(new Request(origin+'/api/payments/moyasar-webhook',{method:'POST',headers:{'content-type':'application/json','x-event-secret':secret},body:JSON.stringify({type:'webhook_verification',secret_token:secret,data:{verification_code:'123456'}})}),e);
 assert.equal(result.status,200);
 delete e.MOYASAR_WEBHOOK_SECRET;assert.equal((await webhook(e,{id:'payment-12345'})).status,503);
});

test('paid unused trip card payment can request a refund and cannot be duplicated',async()=>{
 const e=eFactory(),p=createdIntent(e),provider=mockedPayment(p);
 const restore=await fetchMock(async()=>Response.json(provider));
 try{assert.equal((await webhook(e,provider)).status,200)}finally{restore()}
 const refundList=await refundAction(e,'rider:qa',{action:'live_refunds'});
 assert.equal(refundList.payments.length,1);assert.equal(refundList.payments[0].purpose,'trip');
 const r=await refundAction(e,'rider:qa',{action:'live_refund_request',intentId:p.id,reason:'تم الدفع لكن لم ينشأ مشوار'});
 assert.equal(r.ok,true);assert.equal(balance(e,'qa'),0);
 await assert.rejects(()=>refundAction(e,'rider:qa',{action:'live_refund_request',intentId:p.id,reason:'تكرار طلب الاسترداد'}));
});

test('expired quote is bookable when a matching paid card intent was recently issued',async()=>{
 const e=eFactory(),actor='qa';e.db.prepare("UPDATE captain_applications SET status='active'").run();
 e.db.prepare("INSERT INTO platform_settings VALUES('commission_bps','1000',?,'admin')").run(at());
 e.db.prepare('INSERT INTO road_route_cache VALUES(?,?,?)').run('osrm:https://router.project-osrm.org:46.60000,24.70000,46.61000,24.71000',JSON.stringify({distanceMeters:2400,durationSeconds:480,geometry:{type:'LineString',coordinates:[[46.6,24.7],[46.61,24.71]]},provider:'OSRM',trafficAware:false,demoProvider:true}),'2030-01-01T00:00:00Z');
 const qr=await asRider(e,actor,'live_quote',{pickup:{name:'Test pickup',lat:24.7,lng:46.6},destination:{name:'Test destination',lat:24.71,lng:46.61},category:'economy'});
 assert.equal(qr.status,200);const q=await qr.json();
 const p=createdIntent(e,{actor,quoteId:q.id,amount:q.payable});const provider=mockedPayment(p);
 const restore=await fetchMock(async()=>Response.json(provider));
 try{assert.equal((await webhook(e,provider)).status,200)}finally{restore()}
 e.db.prepare('UPDATE ride_quotes SET expires_at=? WHERE id=?').run(new Date(Date.now()-60000).toISOString(),q.id);
 const r=await asRider(e,actor,'live_book',{quoteId:q.id,intentId:p.id,method:'card'});
 assert.equal(r.status,201,await r.text());
 assert.equal(e.db.prepare('SELECT used_trip_id FROM payment_intents WHERE id=?').get(p.id).used_trip_id!==null,true);
 const status=await asRider(e,actor,'live_payment_status',{intentId:p.id});assert.equal(status.status,200);assert.ok((await status.json()).usedTripId);
 const other=await asRider(e,'other','live_payment_status',{intentId:p.id});assert.equal(other.status,404);
});

test('a paid trip still active is not refundable; cancelled and wallet-released trip becomes eligible',async()=>{
 const e=eFactory(),p=createdIntent(e,{id:'intent-cancelled-02',amount:1800}),provider=mockedPayment(p,'provider-paid-cancel-0002');
 const restore=await fetchMock(async()=>Response.json(provider));
 try{assert.equal((await webhook(e,provider)).status,200)}finally{restore()}
 e.db.prepare("INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES('rider:qa','Offline rider','','',?,?)").run(at(),at());
 e.db.prepare("INSERT INTO trips(id,rider_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,'rider:qa','riding','{}','{}',1800,1000,'held',0,?,?)").run('trip-abc',at(),at());
 e.db.prepare('UPDATE payment_intents SET used_trip_id=? WHERE id=?').run('trip-abc',p.id);
 assert.equal((await refundAction(e,'rider:qa',{action:'live_refunds'})).payments.length,0);
 await assert.rejects(()=>refundAction(e,'rider:qa',{action:'live_refund_request',intentId:p.id,reason:'Trip in progress'}));
 e.db.prepare("UPDATE trips SET status='cancelled',payment_status='wallet_returned' WHERE id='trip-abc'").run();
 assert.equal((await refundAction(e,'rider:qa',{action:'live_refunds'})).payments.length,1);
 assert.equal((await refundAction(e,'rider:qa',{action:'live_refund_request',intentId:p.id,reason:'Full refund after cancellation'})).ok,true);
 assert.equal(balance(e,'qa'),0);
});
