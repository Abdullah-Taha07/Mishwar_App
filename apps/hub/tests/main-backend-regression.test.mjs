import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {handleDriver,handleLiveRider} from '../worker/commerce.js';
import {launchAction} from '../worker/launch-features.js';
import {documentState,documentsValid,runPlatformJobs} from '../worker/launch-operations.js';
import {publicPhoneOtp} from '../worker/public-phone-otp.js';
import {tokenHash} from '../worker/rider-auth.js';

const captain='11111111-1111-4111-8111-111111111111';
const now=()=>new Date().toISOString();
const origin='https://main-audit.local.test';
function request(path,body,headers={}){return new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)})}
function fixture(t){const env=makeEnv(true);t.after(()=>env.db.close());env.db.prepare("UPDATE captain_applications SET status='active'").run();return env}
function trip(env,status='completed',id=crypto.randomUUID()){
 const at=now(),point=JSON.stringify({name:'موقع صناعي لتدقيق main',lat:24.7,lng:46.6});
 env.db.prepare('INSERT OR IGNORE INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').run('rider:audit-owner','مالك رحلة صناعية','+966500000071','main-audit@example.test',at,at);
 env.db.prepare('INSERT INTO trips(id,rider_id,driver_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'rider:audit-owner',captain,status,point,point,2000,1000,'cash_collected',0,at,at);
 return id;
}
const read=(env,action,tripId)=>handleLiveRider(request('/internal/live-rider',{action,tripId,sessionToken:env.verifiedToken('audit-owner')},{'x-mishwar-key':env.RIDER_SERVICE_KEY}),env);

test('MAIN audit: completed and cancelled trip reads never reveal the captain current coordinates',async t=>{
 const env=fixture(t);
 env.db.prepare('INSERT INTO captain_presence(application_id,available,last_seen,latitude,longitude,accuracy,location_at) VALUES(?,?,?,?,?,?,?)').run(captain,1,now(),25.12345,47.54321,7,now());
 for(const status of ['completed','cancelled']){
  const id=trip(env,status);
  for(const action of ['live_history','live_watch','live_session']){
   const response=await read(env,action,id);assert.equal(response.status,200);
   const data=await response.json(),value=action==='live_history'?data.trips.find(row=>row.id===id):data.recentTrip;
   assert.ok(value);assert.equal(value.driverLocation,null,status+': '+action);
   for(const key of ['driver_lat','driver_lng','driver_accuracy','driver_location_at']){assert.equal(value[key],undefined,key+' must be redacted after access ends');assert.equal(Object.hasOwn(value,key),false,key+' must not appear in the response');}
  }
 }
});

test('MAIN audit: authorized active-trip location remains available and unrelated history stays empty',async t=>{
 const env=fixture(t),id=trip(env,'arriving');
 env.db.prepare('INSERT INTO captain_presence(application_id,available,last_seen,latitude,longitude,accuracy,location_at) VALUES(?,?,?,?,?,?,?)').run(captain,1,now(),24.705,46.605,7,now());
 const response=await read(env,'live_watch',id),data=await response.json();
 assert.equal(data.trip.driverLocation.lat,24.705);assert.equal(data.trip.driverLocation.fresh,true);
 const other=await handleLiveRider(request('/internal/live-rider',{action:'live_history',sessionToken:env.verifiedToken('another-owner')},{'x-mishwar-key':env.RIDER_SERVICE_KEY}),env);
 assert.deepEqual((await other.json()).trips,[]);
});

test('MAIN audit: captain topup cannot credit a provider response with a different payment ID',async t=>{
 const env=fixture(t),fetchBefore=globalThis.fetch;t.after(()=>{globalThis.fetch=fetchBefore});
 env.MOYASAR_ENABLED='true';env.MOYASAR_SECRET_KEY='sk_live_main_audit_synthetic_only';env.MOYASAR_PUBLIC_KEY='pk_live_main_audit_synthetic_only';
 const intent='main-audit-intent',payment='main-audit-payment-requested';
 env.db.prepare('INSERT INTO driver_payment_intents(id,captain_id,method,amount_halalas,created_at) VALUES(?,?,?,?,?)').run(intent,captain,'card',2500,now());
 let fetched=0;
 globalThis.fetch=async input=>{assert.equal(new URL(input.url||input).hostname,'api.moyasar.com');fetched++;return new Response(JSON.stringify({id:'different-main-audit-payment',status:'paid',currency:'SAR',amount:2500,source:{type:'creditcard'},metadata:{driver_intent_id:intent,captain_id:captain}}),{headers:{'Content-Type':'application/json'}})};
 const response=await handleDriver(request('/api/driver',{action:'topup_verify',intentId:intent,paymentId:payment},{'oai-authenticated-user-id':'qa-applicant'}),env);
 assert.equal(response.status,400);assert.equal(fetched,1);
 assert.equal(env.db.prepare('SELECT status FROM driver_payment_intents WHERE id=?').get(intent).status,'pending');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM wallet_entries').get().n,0);
});

test('MAIN audit: matching captain payment is credited exactly once and retains a balanced ledger',async t=>{
 const env=fixture(t),fetchBefore=globalThis.fetch;t.after(()=>{globalThis.fetch=fetchBefore});
 env.MOYASAR_ENABLED='true';env.MOYASAR_SECRET_KEY='sk_live_main_audit_synthetic_only';env.MOYASAR_PUBLIC_KEY='pk_live_main_audit_synthetic_only';
 const intent='main-audit-valid-intent',payment='main-audit-valid-payment';
 env.db.prepare('INSERT INTO driver_payment_intents(id,captain_id,method,amount_halalas,created_at) VALUES(?,?,?,?,?)').run(intent,captain,'card',2500,now());
 let fetched=0;globalThis.fetch=async()=>{fetched++;return new Response(JSON.stringify({id:payment,status:'paid',currency:'SAR',amount:2500,source:{type:'creditcard'},metadata:{driver_intent_id:intent,captain_id:captain}}),{headers:{'Content-Type':'application/json'}})};
 for(let n=0;n<2;n++)assert.equal((await handleDriver(request('/api/driver',{action:'topup_verify',intentId:intent,paymentId:payment},{'oai-authenticated-user-id':'qa-applicant'}),env)).status,200);
 assert.equal(fetched,1);assert.equal(env.db.prepare('SELECT balance_halalas FROM wallet_accounts WHERE account_id=?').get('captain:'+captain).balance_halalas,2500);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM wallet_entries').get().n,2);
 assert.equal(env.db.prepare('SELECT SUM(amount_halalas) n FROM wallet_entries').get().n,0);
});

test('MAIN audit: receipts of trips sharing the first identifier prefix each retain a number',async t=>{
 const env=fixture(t);
 const first=trip(env,'completed','aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1');
 const second=trip(env,'completed','aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2');
 const a=(await launchAction(env,'rider','rider:audit-owner',{action:'receipt',tripId:first})).receipt;
 const b=(await launchAction(env,'rider','rider:audit-owner',{action:'receipt',tripId:second})).receipt;
 assert.equal(typeof a.receipt_number,'string');assert.equal(typeof b.receipt_number,'string');assert.notEqual(a.receipt_number,b.receipt_number);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trip_receipts').get().n,2);
});

test('MAIN audit: existing receipt numbers and repeated reads remain stable without financial effects',async t=>{
 const env=fixture(t),id=trip(env),at=now();
 env.db.prepare('INSERT INTO trip_receipts VALUES(?,?,?)').run(id,'MW-EXISTING-NUMBER',at);
 for(let n=0;n<2;n++){
  const data=(await launchAction(env,'rider','rider:audit-owner',{action:'receipt',tripId:id})).receipt;
  assert.equal(data.receipt_number,'MW-EXISTING-NUMBER');assert.equal(data.created_at,at);assert.equal(data.taxInvoice,false);
 }
 await assert.rejects(launchAction(env,'rider','rider:other-owner',{action:'receipt',tripId:id}));
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trip_receipts').get().n,1);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM wallet_entries').get().n,0);
});

test('MAIN audit: impossible document expiry dates are not accepted as valid future documents',()=>{
 const good={identityExpiry:'2032-02-29',licenseExpiry:'2032-03-01',registrationExpiry:'2032-03-01',insuranceExpiry:'2032-03-01'};
 assert.equal(documentsValid(good),true);
 for(const date of ['2030-99-99','2030-02-30','2031-02-29']){
  const invalid={...good,insuranceExpiry:date};
  assert.equal(documentsValid(invalid),false,date);
  assert.equal(documentState(invalid).find(row=>row.key==='insuranceExpiry').state,'missing');
 }
});

test('MAIN audit: scheduled cleanup preserves active hourly OTP quotas and in-flight SMS leases',async t=>{
 const env=fixture(t),at=Date.now(),hour=Math.floor(at/3600000),minute=Math.floor(at/60000),quarter=Math.floor(at/900000);
 const rows=[['otp:synthetic:'+hour,3],['otp:send-lease:rider:synthetic',at+60000],['otp:send-lease:rider:expired',at-1],['otp:synthetic:'+(hour-1),3],['launch:chat:owner:'+minute,20],['email:rider:reset:synthetic:'+quarter,5],['launch:chat:owner:'+(minute-2),20]];
 for(const [bucket,n]of rows)env.db.prepare('INSERT INTO access_rate_limits VALUES(?,?)').run(bucket,n);
 await runPlatformJobs(env,{});
 const counters=new Map(env.db.prepare('SELECT bucket,n FROM access_rate_limits').all().map(row=>[row.bucket,row.n]));
 assert.equal(counters.get('otp:synthetic:'+hour),3);
 assert.equal(counters.get('otp:send-lease:rider:synthetic'),at+60000);
 assert.equal(counters.get('launch:chat:owner:'+minute),20);assert.equal(counters.get('email:rider:reset:synthetic:'+quarter),5);
 assert.equal(counters.has('otp:send-lease:rider:expired'),false);assert.equal(counters.has('otp:synthetic:'+(hour-1)),false);
 assert.equal(counters.has('launch:chat:owner:'+(minute-2)),false);
});

test('MAIN audit: running jobs cannot reset the three-SMS hourly limit before its window expires',async t=>{
 const env=fixture(t),fetchBefore=globalThis.fetch;t.after(()=>{globalThis.fetch=fetchBefore});
 Object.assign(env,{AUTHENTICA_API_KEY:'main-audit-synthetic-sms-key',AUTHENTICA_TEMPLATE_ID:'91'});
 globalThis.fetch=()=>{throw Error('An exhausted SMS quota must never call a provider')};
 const phone='+966500000072',bucket='otp:'+await tokenHash(phone)+':'+Math.floor(Date.now()/3600000);
 env.db.prepare('INSERT INTO access_rate_limits VALUES(?,3)').run(bucket);
 await runPlatformJobs(env,{});
 const response=await publicPhoneOtp(env,'rider',{action:'phone-otp-start'},{actor:'audit-sms-owner',phone,token_hash:'synthetic-session-hash',phone_verified_at:null});
 assert.equal(response.status,429);assert.match((await response.json()).error,/الحد المسموح/);
});
