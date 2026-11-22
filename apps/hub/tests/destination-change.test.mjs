import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeEnv} from './fixtures.mjs';
import hub from '../worker/index.js';
import riderGateway from '../../rider/worker/index.js';

// Real Worker gateways, HttpOnly-cookie identities, D1-style transactions and
// migration-backed SQLite. Only synthetic TomTom replies cross the fetch trap.
// No local acceptance case can reach a live database, payment, SMS or route API.
const HUB='https://hub.offline.test',SITE='https://rider.offline.test';
const CAPTAIN='11111111-1111-4111-8111-111111111111',OWNER='destination-owner';
const pickup={name:'Synthetic pickup',area:'Fixture',lat:24.7,lng:46.6};
const original={name:'Original destination',area:'Fixture',lat:24.72,lng:46.62};
const replacement={name:'Requested destination',area:'Fixture',lat:24.75,lng:46.65};
const alternative={name:'Other requested destination',area:'Fixture',lat:24.76,lng:46.66};
const nativeFetch=globalThis.fetch;
const nativeNow=Date.now;
const hash=value=>createHash('sha256').update(value).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}};

function fixture(t,{status='arriving',method='cash',discount=0,isDemo=0,stops=[],negotiated=false}={}){
  const env=makeEnv(true);t.after(()=>env.db.close());
  env.db.prepare("UPDATE captain_applications SET status='active'").run();
  Object.assign(env,{TOMTOM_ENABLED:'true',TOMTOM_API_KEY:'destination-offline-fixture-only',REQUIRE_COMMERCIAL_ROUTES:'true'});
  const at=new Date().toISOString(),id=crypto.randomUUID(),quoteId='original-'+id;
  env.db.prepare('INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)')
    .run('rider:'+OWNER,'Synthetic rider','+966500000096','destination@example.test',at,at);
  env.db.prepare('INSERT INTO captain_presence VALUES(?,?,?,?,?,?,?)').run(CAPTAIN,1,at,pickup.lat,pickup.lng,7,at);
  const originalRoute={distanceMeters:20000,durationSeconds:2400,provider:'TomTom',trafficAware:true,calculatedAt:at,geometry:{type:'LineString',coordinates:[[pickup.lng,pickup.lat],[original.lng,original.lat]]}};
  env.db.prepare('INSERT INTO ride_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(quoteId,'rider:'+OWNER,JSON.stringify(pickup),JSON.stringify(original),'economy',2500,discount,null,1000,'2030-01-01T00:00:00Z',JSON.stringify(originalRoute));
  env.db.prepare('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,'rider:'+OWNER,status==='matching'?null:CAPTAIN,status,JSON.stringify(pickup),JSON.stringify(original),2500,1000,method==='cash'?'cash_due':'held',isDemo,at,at);
  env.db.prepare('INSERT INTO trip_commerce VALUES(?,?,?,?,?,?)').run(id,quoteId,method,discount,method==='cash'?2500-discount:0,null);
  env.db.prepare('INSERT INTO trip_options VALUES(?,?,?,?)').run(id,JSON.stringify(stops),'','');
  if(negotiated)env.db.prepare('INSERT INTO trip_negotiations VALUES(?,?)').run(id,1000);
  const captainToken=hash('destination-captain-cookie');
  env.db.prepare('INSERT INTO public_accounts VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('captain','+966500000001','qa-applicant','Synthetic captain','captain@example.test','fixture','fixture',at,'fixture',at);
  env.db.prepare('INSERT INTO public_sessions VALUES(?,?,?,?)').run(hash(captainToken),'qa-applicant','captain','2030-01-01T00:00:00Z');
  const providerCalls=[],upstream=[];let provider=null;
  function facts(url,{distance=30000,duration=2400}={}){
    const points=url.pathname.slice('/routing/1/calculateRoute/'.length).replace(/\/json$/,'').split(':')
      .map(value=>{const[latitude,longitude]=value.split(',').map(Number);return{latitude,longitude}});
    return Response.json({routes:[{summary:{lengthInMeters:distance,travelTimeInSeconds:duration,trafficDelayInSeconds:60},legs:points.slice(1).map((p,n)=>({points:[points[n],p]}))}]});
  }
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input);
    if(url.origin===HUB){
      assert.equal(url.pathname,'/internal/live-rider','Only the local live-rider bridge is permitted');
      assert.equal(options.redirect,'error');assert.equal(options.headers['x-mishwar-key'],env.RIDER_SERVICE_KEY);
      upstream.push(JSON.parse(options.body));
      return hub.fetch(new Request(url,{method:options.method,headers:options.headers,body:options.body}),env);
    }
    assert.equal(url.hostname,'api.tomtom.com','No real or unrelated network traffic');
    assert.equal(url.searchParams.get('key'),'destination-offline-fixture-only');
    providerCalls.push(url);
    return provider?provider(url):facts(url);
  };
  t.after(()=>{globalThis.fetch=nativeFetch});
  async function rider(action,body={},actor=OWNER,{cookie=true,headers={}}={}){
    const token=env.verifiedToken(actor);
    return riderGateway.fetch(new Request(SITE+'/api/live',{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json',...(cookie?{Cookie:'__Host-mishwar_sid='+token}:{}),...headers},body:JSON.stringify({action,...body})}),{HUB_URL:HUB,HUB_SERVICE_KEY:env.RIDER_SERVICE_KEY},{trustedClientIp:'198.51.100.44'});
  }
  function captain(action,body={},options={}){
    return hub.fetch(new Request(HUB+'/api/driver',{method:'POST',headers:{Origin:HUB,'Content-Type':'application/json',...(options.cookie===false?{}:{Cookie:'__Host-mishwar_captain='+captainToken}),...options.headers},body:JSON.stringify({action,...body})}),env);
  }
  function admin(path='operations/trips?id='+id,options={}){
    return hub.fetch(new Request(HUB+'/internal/administration/'+path,{headers:{'x-mishwar-key':env.ADMIN_SERVICE_KEY,...options.headers}}),env);
  }
  return{env,id,quoteId,rider,captain,admin,upstream,providerCalls,facts,setProvider(fn){provider=fn},row:()=>env.db.prepare('SELECT t.*,c.method,c.cash_due_halalas FROM trips t JOIN trip_commerce c ON c.trip_id=t.id WHERE t.id=?').get(id)};
}
async function ok(response){const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data}
const quote=async(f,destination=replacement)=>(await ok(await f.rider('live_destination_quote',{tripId:f.id,destination}))).change;
const submit=async(f,change,extra={})=>ok(await f.rider('live_destination_request',{tripId:f.id,changeId:change.id,consent:true,...extra}));
const decide=(f,change,accept=true)=>f.captain('destination_decide',{tripId:f.id,changeId:change.id,accept});
const money=f=>f.env.db.prepare('SELECT * FROM wallet_entries ORDER BY id').all();
const changes=f=>f.env.db.prepare('SELECT * FROM trip_destination_changes WHERE trip_id=?').all(f.id);

// Pause at the actual D1 commit boundary, after the handler has read its
// snapshot. This makes the TOCTOU interleaving deterministic without changing
// the Worker, SQL statements, triggers or transaction behavior under test.
function beforeBatch(f,matches,interleave){
  const prepare=f.env.DB.prepare,batch=f.env.DB.batch,marked=new WeakSet();let used=false;
  f.env.DB.prepare=sql=>{
    const statement=prepare(sql);
    return{...statement,bind(...values){const bound=statement.bind(...values);if(matches(sql,values))marked.add(bound);return bound}};
  };
  f.env.DB.batch=async items=>{
    if(!used&&items.some(item=>marked.has(item))){used=true;await interleave()}
    return batch(items);
  };
  return()=>used;
}

test('RDEV-004 gateways preserve original destination and cash until informed request and explicit captain acceptance',async t=>{
  const f=fixture(t),before=f.row(),change=await quote(f);
  assert.equal(change.status,'quoted');assert.deepEqual(change.destination,replacement);
  assert.equal(change.oldFare,2500);assert.equal(change.oldCashDue,2500);
  assert.ok(Number.isSafeInteger(change.newFare)&&change.newFare>2500);
  assert.equal(change.fareDifference,change.newFare-2500);assert.equal(change.newCashDue,change.newFare);
  assert.equal(change.route.provider,'TomTom');assert.equal(change.route.distanceMeters,30000);
  assert.deepEqual(f.row(),before);assert.deepEqual(money(f),[]);
  await submit(f,change);assert.equal(f.row().destination_json,before.destination_json);
  const captain=(await ok(await f.captain('watch'))).current;
  assert.equal(captain.destinationChange.status,'pending');assert.equal(captain.destinationChange.id,change.id);
  await ok(await decide(f,change));
  const after=f.row();assert.deepEqual(JSON.parse(after.destination_json),replacement);
  assert.equal(after.fare_halalas,change.newFare);assert.equal(after.cash_due_halalas,change.newCashDue);
  assert.equal(after.method,'cash');assert.equal(after.payment_status,'cash_due');assert.deepEqual(money(f),[]);
  const rider=(await ok(await f.rider('live_watch',{tripId:f.id}))).trip;
  const driver=(await ok(await f.captain('watch'))).current;
  const admin=await ok(await f.admin());
  const extras=await ok(await f.admin('trip-extras?id='+f.id));
  for(const view of [rider,driver,admin]){
    assert.deepEqual(view.destination,replacement);assert.equal(view.fare_halalas,change.newFare);
  }
  for(const view of [rider,driver,extras]){assert.equal(view.destinationChange.status,'accepted');assert.equal(view.destinationChange.id,change.id)}
  assert.equal(rider.route.distanceMeters,30000);assert.equal(driver.route.distanceMeters,30000);
  const actions=admin.events.map(event=>event.action);
  assert.ok(actions.some(action=>/destination.*quot/.test(action)));
  assert.ok(actions.some(action=>/destination.*pending/.test(action)));
  assert.ok(actions.some(action=>/destination.*accept/.test(action)));
  assert.ok(f.upstream.every(body=>body.actor===''&&body.sessionToken===f.env.verifiedToken(OWNER)));
});

test('RDEV-004 acceptance during a riding trip refreshes destination ETA from provider facts',async t=>{
  const f=fixture(t,{status:'riding'});
  let view=(await ok(await f.rider('live_watch'))).trip;
  assert.equal(view.eta.status,'available');assert.equal(view.eta.target,'destination');
  const change=await quote(f);await submit(f,change);await ok(await decide(f,change));
  view=(await ok(await f.rider('live_watch'))).trip;
  assert.deepEqual(view.destination,replacement);
  if(view.eta.status==='available'){
    assert.ok(f.providerCalls.some(url=>url.pathname.includes(replacement.lat+','+replacement.lng)));
    assert.equal(view.eta.durationSeconds,2400);
  }else assert.equal(view.eta.status,'unavailable','Refresh throttle must truthfully withhold an old destination ETA');
  assert.equal(view.route.durationSeconds,2400);
});

test('RDEV-004 strict rider consent and captain boolean decisions cannot be forged or coerced',async t=>{
  const f=fixture(t),change=await quote(f);
  for(const consent of [undefined,false,'true',1,{},[]]){
    const response=await f.rider('live_destination_request',{tripId:f.id,changeId:change.id,consent});
    assert.equal(response.status,400);assert.equal(changes(f)[0].status,'quoted');
  }
  await submit(f,change);
  for(const accept of [undefined,'true',1,null])assert.equal((await f.captain('destination_decide',{tripId:f.id,changeId:change.id,accept})).status,400);
  assert.equal(changes(f)[0].status,'pending');assert.deepEqual(JSON.parse(f.row().destination_json),original);
});

test('RDEV-004 rider and captain authentication use cookies, not body identities or public headers',async t=>{
  const f=fixture(t);
  assert.equal((await f.rider('live_destination_quote',{tripId:f.id,destination:replacement,actor:OWNER,sessionToken:f.env.verifiedToken(OWNER)},OWNER,{cookie:false})).status,401);
  const change=await quote(f);await submit(f,change);
  assert.equal((await f.captain('destination_decide',{tripId:f.id,changeId:change.id,accept:true},{cookie:false,headers:{'oai-authenticated-user-id':'qa-applicant'}})).status,401);
  assert.equal(changes(f)[0].status,'pending');assert.deepEqual(money(f),[]);
});

test('RDEV-004 trip and change ownership prevent cross-account request, withdrawal and captain decisions',async t=>{
  const f=fixture(t),change=await quote(f);
  for(const action of ['live_destination_quote','live_destination_request','live_destination_withdraw']){
    const response=await f.rider(action,{tripId:f.id,changeId:change.id,destination:replacement,consent:true,actor:OWNER},'another-rider');
    assert.ok([403,404,409].includes(response.status));
    assert.equal((await response.json()).change,undefined);
  }
  await submit(f,change);
  // A signed-in active captain still cannot decide an assignment owned by somebody else.
  f.env.db.prepare("INSERT INTO captain_applications SELECT 'other-captain','other-user','+966500000002','other@example.test',personal_json,vehicle_json,documents_json,status,submitted_at,reviewed_at FROM captain_applications WHERE id=?").run(CAPTAIN);
  f.env.db.prepare("UPDATE public_accounts SET actor='other-user' WHERE role='captain'").run();
  f.env.db.prepare("UPDATE public_sessions SET actor='other-user' WHERE role='captain'").run();
  assert.ok([403,404,409].includes((await decide(f,change)).status));
  assert.equal(changes(f)[0].status,'pending');assert.deepEqual(JSON.parse(f.row().destination_json),original);
});

test('RDEV-004 requests and quotes require an assigned active trip and valid distinct destination',async t=>{
  for(const status of ['matching','completed','cancelled']){
    const f=fixture(t,{status});
    assert.equal((await f.rider('live_destination_quote',{tripId:f.id,destination:replacement})).status,409);
    assert.equal(f.providerCalls.length,0);
  }
  const f=fixture(t);
  for(const destination of [null,{name:'Bad',lat:91,lng:46},{name:'Bad',lat:24,lng:181},{name:'',lat:24,lng:46},original]){
    const response=await f.rider('live_destination_quote',{tripId:f.id,destination});
    assert.ok([400,409].includes(response.status));
  }
  assert.equal(f.providerCalls.length,0);assert.deepEqual(money(f),[]);
});

test('RDEV-004 paid methods, discounts, negotiated fares, demo and multistop bookings retain their original money policy',async t=>{
  for(const options of [{method:'wallet'},{method:'card'},{method:'applepay'},{discount:500},{negotiated:true},{isDemo:1},{stops:[{name:'Stop',lat:24.71,lng:46.61}]}]){
    const f=fixture(t,options),before=f.row();
    assert.equal((await f.rider('live_destination_quote',{tripId:f.id,destination:replacement})).status,409,JSON.stringify(options));
    assert.deepEqual(f.row(),before);assert.deepEqual(money(f),[]);assert.equal(f.providerCalls.length,0);
  }
});

test('RDEV-004 provider outage and malformed route facts never fabricate a fare or requestable change',async t=>{
  for(const provider of [()=>{throw Error('Offline synthetic route failure')},()=>Response.json({routes:[{summary:{lengthInMeters:-1,travelTimeInSeconds:100},legs:[]}]}),()=>Response.json({routes:[]})]){
    const f=fixture(t),before=f.row();f.setProvider(provider);
    const value=await ok(await f.rider('live_destination_quote',{tripId:f.id,destination:replacement}));
    assert.equal(value.change.status,'unavailable');assert.equal(value.change.id,null);
    assert.equal(value.change.newFare,null);assert.equal(value.change.fareDifference,null);assert.equal(value.change.route,null);
    assert.notEqual((await f.rider('live_destination_request',{tripId:f.id,changeId:null,consent:true})).status,200);
    assert.deepEqual(f.row(),before);assert.deepEqual(money(f),[]);assert.equal(changes(f).length,0);
  }
});

test('RDEV-004 unconfigured provider fallback never contacts a public route or manufactures ETA/fare',async t=>{
  const f=fixture(t);f.env.TOMTOM_ENABLED='false';f.env.REQUIRE_COMMERCIAL_ROUTES='false';delete f.env.OSRM_BASE_URL;
  const value=await ok(await f.rider('live_destination_quote',{tripId:f.id,destination:replacement}));
  assert.equal(value.change.status,'unavailable');assert.equal(value.change.newFare,null);assert.equal(value.change.route,null);
  assert.equal(f.providerCalls.length,0);assert.deepEqual(JSON.parse(f.row().destination_json),original);
});

test('RDEV-004 captain rejection and rider withdrawal keep cash, route and destination unchanged',async t=>{
  const f=fixture(t),before=f.row();let change=await quote(f);await submit(f,change);
  await ok(await decide(f,change,false));assert.equal(changes(f)[0].status,'rejected');assert.deepEqual(f.row(),before);
  assert.notEqual((await decide(f,change)).status,200);
  change=await quote(f,alternative);await submit(f,change);
  await ok(await f.rider('live_destination_withdraw',{tripId:f.id,changeId:change.id}));
  assert.equal(changes(f).find(item=>item.id===change.id).status,'withdrawn');assert.deepEqual(f.row(),before);
  assert.notEqual((await decide(f,change)).status,200);assert.deepEqual(money(f),[]);
});

test('RDEV-004 concurrent request replay produces one pending transition and one audit event',async t=>{
  const f=fixture(t),change=await quote(f);
  const responses=await Promise.all([1,2].map(()=>f.rider('live_destination_request',{tripId:f.id,changeId:change.id,consent:true})));
  assert.equal(responses.filter(response=>response.ok).length,1);
  assert.equal(changes(f).filter(item=>item.status==='pending').length,1);
  const events=f.env.db.prepare("SELECT * FROM operation_events WHERE entity_id=? AND action='destination_change_pending'").all(f.id);
  assert.equal(events.length,1);assert.deepEqual(money(f),[]);
});

test('RDEV-004 concurrent accept/reject decisions apply at most once and cannot switch destination by replay',async t=>{
  const f=fixture(t),change=await quote(f);await submit(f,change);
  const decisions=await Promise.all([decide(f,change,true),decide(f,change,false)]);
  assert.equal(decisions.filter(response=>response.ok).length,1);
  const state=changes(f)[0].status;assert.ok(['accepted','rejected'].includes(state));
  const before=f.row();assert.equal(before.destination_json,JSON.stringify(state==='accepted'?replacement:original));
  assert.notEqual((await decide(f,change,true)).status,200);
  assert.deepEqual(f.row(),before);assert.deepEqual(money(f),[]);
});

test('RDEV-004 pending change blocks destination switching and body fare/route overrides cannot change the consented quote',async t=>{
  const f=fixture(t),change=await quote(f);
  assert.equal((await f.rider('live_destination_request',{tripId:f.id,changeId:change.id,consent:true,destination:alternative,newFare:1,newCashDue:1,route:{provider:'forged',durationSeconds:1}})).status,409);
  assert.equal(changes(f)[0].status,'quoted');await submit(f,change);
  assert.equal((await f.rider('live_destination_quote',{tripId:f.id,destination:alternative})).status,409);
  await ok(await decide(f,change));
  assert.deepEqual(JSON.parse(f.row().destination_json),replacement);assert.equal(f.row().fare_halalas,change.newFare);
  assert.equal(f.row().cash_due_halalas,change.newCashDue);
});

test('RDEV-004 expired quotes and pending requests cannot consent, apply or preserve a stale actionable state',async t=>{
  for(const pending of [false,true]){
    const f=fixture(t),change=await quote(f);if(pending)await submit(f,change);
    Date.now=()=>Date.parse(change.expiresAt)+1000;
    try{
      const response=pending?await decide(f,change):await f.rider('live_destination_request',{tripId:f.id,changeId:change.id,consent:true});
      assert.equal(response.status,409);assert.equal(changes(f)[0].status,'expired');
      assert.deepEqual(JSON.parse(f.row().destination_json),original);assert.equal(f.row().fare_halalas,2500);assert.deepEqual(money(f),[]);
      const view=(await ok(await f.rider('live_watch'))).trip;
      assert.equal(view.destinationChange.status,'expired');
    }finally{Date.now=nativeNow}
  }
});

test('RDEV-004 a consented quote is bound to its trip and cannot apply after the original fare or destination changes',async t=>{
  for(const field of ['fare_halalas','destination_json']){
    const f=fixture(t),change=await quote(f);await submit(f,change);
    if(field==='fare_halalas')f.env.db.prepare('UPDATE trips SET fare_halalas=? WHERE id=?').run(2600,f.id);
    else f.env.db.prepare('UPDATE trips SET destination_json=? WHERE id=?').run(JSON.stringify(alternative),f.id);
    const changed=f.row();assert.equal((await decide(f,change)).status,409);
    assert.deepEqual(f.row(),changed);assert.deepEqual(money(f),[]);
  }
  const f=fixture(t),change=await quote(f);
  assert.ok([403,404,409].includes((await f.rider('live_destination_request',{tripId:'another-trip',changeId:change.id,consent:true})).status));
  assert.equal(changes(f)[0].status,'quoted');
});

test('RDEV-004 second accepted request uses the latest destination/fare and old request replay cannot switch it back',async t=>{
  const f=fixture(t),first=await quote(f);await submit(f,first);await ok(await decide(f,first));
  const second=await quote(f,alternative);assert.equal(second.oldFare,first.newFare);
  await submit(f,second);await ok(await decide(f,second));
  const before=f.row();assert.deepEqual(JSON.parse(before.destination_json),alternative);
  assert.notEqual((await decide(f,first)).status,200);
  assert.notEqual((await f.rider('live_destination_request',{tripId:f.id,changeId:first.id,consent:true})).status,200);
  assert.deepEqual(f.row(),before);assert.deepEqual(money(f),[]);
});

test('RDEV-004 simultaneous quote creation leaves one actionable snapshot and cannot consent a superseded destination',async t=>{
  const f=fixture(t);
  const values=await Promise.all([replacement,alternative].map(destination=>f.rider('live_destination_quote',{tripId:f.id,destination})));
  const actionable=changes(f).filter(change=>['quoted','pending'].includes(change.status));assert.equal(actionable.length,1);
  assert.ok(values.some(response=>response.ok));
  const current=actionable[0];
  await submit(f,{id:current.id});await ok(await decide(f,{id:current.id}));
  assert.deepEqual(JSON.parse(f.row().destination_json),JSON.parse(current.destination_json));assert.deepEqual(money(f),[]);
});

test('RDEV-004 suspension after quote creation prevents submission or captain approval while preserving withdrawal',async t=>{
  const f=fixture(t),change=await quote(f),at=new Date().toISOString();
  f.env.db.prepare('INSERT INTO account_controls VALUES(?,?,?,?,?,?)').run('rider','rider:'+OWNER,1,'Synthetic hold','fixture',at);
  assert.equal((await f.rider('live_destination_request',{tripId:f.id,changeId:change.id,consent:true})).status,403);
  await ok(await f.rider('live_destination_withdraw',{tripId:f.id,changeId:change.id}));
  assert.equal(changes(f)[0].status,'withdrawn');assert.deepEqual(JSON.parse(f.row().destination_json),original);
  const f2=fixture(t),second=await quote(f2);await submit(f2,second);
  f2.env.db.prepare('INSERT INTO account_controls VALUES(?,?,?,?,?,?)').run('captain',CAPTAIN,1,'Synthetic hold','fixture',at);
  assert.equal((await decide(f2,second)).status,403);assert.deepEqual(JSON.parse(f2.row().destination_json),original);
});

test('RDEV-004 cancelling a trip invalidates a pending request atomically and cannot resurrect it',async t=>{
  const f=fixture(t),change=await quote(f);await submit(f,change);
  await ok(await f.rider('live_cancel',{tripId:f.id,reason:'changed_plans'}));
  assert.equal(f.row().status,'cancelled');assert.equal(changes(f)[0].status,'invalidated');
  assert.notEqual((await decide(f,change)).status,200);
  assert.deepEqual(JSON.parse(f.row().destination_json),original);assert.equal(f.row().fare_halalas,2500);
  assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM trip_settlements WHERE trip_id=?').get(f.id).n,1);
});

test('RDEV-004 completion racing captain acceptance settles exactly the destination and fare that won',async t=>{
  const f=fixture(t,{status:'riding'}),change=await quote(f);await submit(f,change);
  const results=await Promise.all([decide(f,change),f.captain('trip_status',{tripId:f.id,status:'completed',cashReceived:true})]);
  assert.ok(results.some(response=>response.ok));
  if(f.row().status!=='completed')await ok(await f.captain('trip_status',{tripId:f.id,status:'completed',cashReceived:true,cashAmount:f.row().cash_due_halalas,destinationRevision:change.id}));
  const row=f.row(),state=changes(f)[0].status;
  assert.equal(row.status,'completed');assert.ok(['accepted','invalidated'].includes(state));
  const fare=state==='accepted'?change.newFare:2500;
  assert.equal(row.fare_halalas,fare);assert.equal(row.cash_due_halalas,fare);
  assert.deepEqual(JSON.parse(row.destination_json),state==='accepted'?replacement:original);
  assert.equal(f.env.db.prepare('SELECT balance_halalas balance FROM wallet_accounts WHERE account_id=?').get('captain:'+CAPTAIN).balance,-Math.round(fare*.1));
  assert.equal(f.env.db.prepare('SELECT SUM(amount_halalas) n FROM wallet_entries').get().n,0);
  assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM trip_settlements WHERE trip_id=?').get(f.id).n,1);
  assert.notEqual((await decide(f,change)).status,200);
});

test('RDEV-004 acceptance committed after completion read rolls back the entire stale settlement',async t=>{
  const f=fixture(t,{status:'riding'}),change=await quote(f);await submit(f,change);
  const interleaved=beforeBatch(f,(_sql,values)=>values[2]==='trip_completion_snapshot',async()=>{await ok(await decide(f,change))});
  const response=await f.captain('trip_status',{tripId:f.id,status:'completed',cashReceived:true});
  assert.equal(interleaved(),true,'The accepted change must land after the completion handler read');
  assert.equal(response.status,409);assert.equal(f.row().status,'riding');assert.equal(f.row().fare_halalas,change.newFare);
  assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM trip_settlements WHERE trip_id=?').get(f.id).n,0);
  assert.equal(f.env.db.prepare("SELECT COUNT(*) n FROM operation_events WHERE entity_id=? AND action='trip_completion_snapshot'").get(f.id).n,0);
  assert.deepEqual(money(f),[]);
  await ok(await f.captain('trip_status',{tripId:f.id,status:'completed',cashReceived:true,cashAmount:change.newCashDue,destinationRevision:change.id}));
  assert.equal(f.row().status,'completed');
});

test('RDEV-004 cancellation committed after captain read blocks stale destination application at the database boundary',async t=>{
  const f=fixture(t),change=await quote(f);await submit(f,change);
  const interleaved=beforeBatch(f,(sql,values)=>sql.startsWith('UPDATE trip_destination_changes SET status=')&&values[0]==='accepted',async()=>{await ok(await f.rider('live_cancel',{tripId:f.id,reason:'changed_plans'}))});
  const response=await decide(f,change);
  assert.equal(interleaved(),true,'Cancellation must land after the decision handler read');
  assert.equal(response.status,409);assert.equal(f.row().status,'cancelled');assert.equal(changes(f)[0].status,'invalidated');
  assert.deepEqual(JSON.parse(f.row().destination_json),original);assert.equal(f.row().fare_halalas,2500);assert.deepEqual(money(f),[]);
});

test('RDEV-004 cash completion requires the accepted destination revision and explicit current cash amount',async t=>{
  const f=fixture(t,{status:'riding'}),change=await quote(f);await submit(f,change);await ok(await decide(f,change));
  const before=f.row();
  for(const extra of [{},{cashAmount:2500,destinationRevision:change.id},{cashAmount:change.newCashDue,destinationRevision:null},{cashAmount:change.newCashDue,destinationRevision:'stale-change'}]){
    const response=await f.captain('trip_status',{tripId:f.id,status:'completed',cashReceived:true,...extra});
    assert.ok([400,409].includes(response.status));assert.deepEqual(f.row(),before);assert.deepEqual(money(f),[]);
  }
  const current=(await ok(await f.captain('watch'))).current;assert.equal(current.destinationRevision,change.id);
  await ok(await f.captain('trip_status',{tripId:f.id,status:'completed',cashReceived:true,cashAmount:change.newCashDue,destinationRevision:change.id}));
  const receipt=(await ok(await f.rider('live_receipt',{tripId:f.id}))).receipt;
  assert.equal(receipt.fare,change.newFare);assert.equal(receipt.total,change.newCashDue);
  assert.deepEqual(receipt.destination,replacement);
});

test('RDEV-004 quote finishing after cancellation cannot save a stale change',async t=>{
  const f=fixture(t),gate=deferred(),started=deferred();
  f.setProvider(url=>{started.resolve(url);return gate.promise});
  const pending=f.rider('live_destination_quote',{tripId:f.id,destination:replacement});
  const url=await started.promise;await ok(await f.rider('live_cancel',{tripId:f.id,reason:'changed_plans'}));
  gate.resolve(f.facts(url));const response=await pending;
  assert.equal(response.status,409);assert.equal(changes(f).filter(change=>['quoted','pending'].includes(change.status)).length,0);
  assert.equal(f.row().status,'cancelled');assert.deepEqual(JSON.parse(f.row().destination_json),original);
});

test('RDEV-004 simultaneous withdrawal and acceptance cannot leave an accepted request on an unchanged trip',async t=>{
  const f=fixture(t),change=await quote(f);await submit(f,change);
  const results=await Promise.all([f.rider('live_destination_withdraw',{tripId:f.id,changeId:change.id}),decide(f,change)]);
  assert.equal(results.filter(response=>response.ok).length,1);
  const accepted=changes(f)[0].status==='accepted';
  assert.deepEqual(JSON.parse(f.row().destination_json),accepted?replacement:original);
  assert.equal(f.row().fare_halalas,accepted?change.newFare:2500);assert.deepEqual(money(f),[]);
});

test('RDEV-004 gateway rejects cross-site mutation and administration cannot bypass service authentication',async t=>{
  const f=fixture(t);
  const response=await f.rider('live_destination_quote',{tripId:f.id,destination:replacement},OWNER,{headers:{Origin:'https://attacker.test','Sec-Fetch-Site':'cross-site'}});
  assert.equal(response.status,403);assert.equal(f.upstream.length,0);
  assert.equal((await f.admin(undefined,{headers:{'x-mishwar-key':'forged-service-key'}})).status,403);
  assert.deepEqual(money(f),[]);assert.equal(f.providerCalls.length,0);
});
