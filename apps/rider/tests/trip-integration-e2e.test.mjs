import test from 'node:test';
import assert from 'node:assert/strict';
import rider from '../dist/server/index.js';
import hub from '../../hub/dist/server/index.js';
import admin from '../../admin/dist/server/index.js';
import {makeEnv} from '../../hub/tests/fixtures.mjs';

// Offline end-to-end API integration through the three compiled application
// gateways. SQLite applies the real D1 migrations. Phone verification, document
// approval, road geometry and merchant responses are explicit synthetic fixtures;
// this proves neither actual SMS/road accuracy nor a remote Cloudflare deployment.
const ORIGINS={rider:'https://rider.integration.test',hub:'https://hub.integration.test',admin:'https://admin.integration.test'};
const CAPTAIN='11111111-1111-4111-8111-111111111111',SECOND='22222222-2222-4222-8222-222222222222';
const pickup={name:'Synthetic pickup',area:'Offline integration',lat:24.7,lng:46.6};
const destination={name:'Synthetic destination',area:'Offline integration',lat:24.709,lng:46.609};
const stops=[{name:'Synthetic stop A',lat:24.703,lng:46.603},{name:'Synthetic stop B',lat:24.706,lng:46.606}];
const nativeFetch=globalThis.fetch;
const wait=()=>new Promise(setImmediate);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};

async function setup(t){
 const env=makeEnv(true),traffic={roads:[],merchant:[],forbidden:0,payment:null,refundPosts:0,reconcileGate:null,reconcileStarted:0,loseBookResponse:false};
 t.after(()=>{globalThis.fetch=nativeFetch;env.db.close()});
 Object.assign(env,{TOMTOM_ENABLED:'true',TOMTOM_API_KEY:'offline-route-fixture',REQUIRE_COMMERCIAL_ROUTES:'true'});
 globalThis.fetch=async(input,options)=>{
  const request=new Request(input,options),url=new URL(request.url);
  if(url.origin===ORIGINS.hub){
   const body=traffic.loseBookResponse&&url.pathname==='/internal/live-rider'?await request.clone().json().catch(()=>null):null;
   const response=await hub.fetch(request,env,{});
   if(traffic.loseBookResponse&&url.pathname==='/internal/live-rider'){
    if(body?.action==='live_book'&&response.status===201){traffic.loseBookResponse=false;return Response.json({error:'Synthetic lost booking acknowledgement'}, {status:503})}
   }
   return response;
  }
  if(url.origin==='https://api.tomtom.com'&&url.pathname.startsWith('/routing/1/calculateRoute/')){
   assert.equal(request.method,'GET');
   if(traffic.roadUnavailable)return Response.json({error:'Synthetic route provider unavailable'},{status:503});
   const positions=decodeURIComponent(url.pathname.split('/calculateRoute/')[1].replace(/\/json$/,'')).split(':').map(pair=>{const [latitude,longitude]=pair.split(',').map(Number);return {latitude,longitude}});
   traffic.roads.push({points:positions,traffic:url.searchParams.get('traffic')});
   return Response.json({routes:[{summary:{lengthInMeters:900*(positions.length-1),travelTimeInSeconds:240*(positions.length-1),trafficDelayInSeconds:30},legs:positions.slice(1).map((point,index)=>({points:[positions[index],point]}))}]});
  }
  if(url.origin==='https://api.moyasar.com'&&traffic.payment&&url.pathname.startsWith('/v1/payments/')){
   traffic.merchant.push({method:request.method,path:url.pathname});
   if(request.method==='POST'){
    assert.equal(url.pathname,'/v1/payments/'+traffic.payment.id+'/refund');traffic.refundPosts++;
    throw Error('Synthetic merchant accepted request but its response was lost');
   }
   if(traffic.reconcileGate){traffic.reconcileStarted++;await traffic.reconcileGate.promise;return Response.json({...traffic.payment,status:'refunded',refunded:traffic.payment.amount})}
   return Response.json(traffic.payment);
  }
  traffic.forbidden++;throw Error('External network forbidden in trip integration');
 };
 const request=(origin,path,body,cookie='',headers={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const riderEnv={HUB_URL:ORIGINS.hub,HUB_SERVICE_KEY:env.RIDER_SERVICE_KEY};
 const adminEnv={HUB_URL:ORIGINS.hub,HUB_SERVICE_KEY:env.ADMIN_SERVICE_KEY,HUB_ACCESS_TOKEN:'offline-platform-adapter',ADMIN_EMAIL:env.CAPTAIN_ADMIN_EMAIL};
 const ownerHeaders={'oai-authenticated-user-id':'offline-owner','oai-authenticated-user-email':env.CAPTAIN_ADMIN_EMAIL};
 const r=(action,body={},cookie=state.riderCookie,headers={})=>rider.fetch(request(ORIGINS.rider,'/api/live',{action,...body},cookie,headers),riderEnv,{trustedClientIp:'192.0.2.91'});
 const auth=(path,body,cookie='')=>rider.fetch(request(ORIGINS.rider,'/api/auth/'+path,body,cookie),riderEnv,{trustedClientIp:'192.0.2.91'});
 const c=(action,body={},cookie=state.captainCookie,headers={})=>hub.fetch(request(ORIGINS.hub,'/api/driver',{action,...body},cookie,headers),env,{});
 const trustedAdminCtx={access:{getIdentity:async()=>({id:'offline-access-owner',email:env.CAPTAIN_ADMIN_EMAIL})}};
 const a=(path,body,headers=ownerHeaders)=>admin.fetch(request(ORIGINS.admin,'/api/admin/'+path,body,'',headers),adminEnv,headers===ownerHeaders?trustedAdminCtx:undefined);
 const read=async(response,status=200,step='integration response')=>{const body=await response.json();assert.equal(response.status,status,step+': '+(body.error||''));return body};
 const cookie=(response,name)=>{const value=response.headers.get('set-cookie')||'';assert.ok(value.includes('HttpOnly')&&value.includes('Secure'));assert.ok(value.includes('SameSite='+(name==='__Host-mishwar_sid'?'Lax':'None')),'Role cookie retains its configured SameSite policy');assert.ok(value.startsWith(name+'='));return value.split(';',1)[0]};
 const state={riderCookie:'',otherCookie:'',captainCookie:'',secondCookie:'',riderId:'',captainActor:'',secondActor:''};
 const password='integration-fixture-password';
 for(const [role,phone,email,name]of [['rider','0500000091','rider@integration.test','Synthetic rider'],['rider','0500000092','other@integration.test','Other rider'],['captain','0500000093','captain@integration.test','Synthetic captain'],['captain','0500000094','second@integration.test','Other captain']]){
  const response=role==='rider'?await auth('register',{name,phone,email,password}):await hub.fetch(request(ORIGINS.hub,'/api/auth/register',{name,phone,email,password}),env,{});
  const result=await read(response,201,'register '+role);assert.equal(result.phoneVerified,false);assert.equal(Object.hasOwn(result,'sessionToken'),false);
 }
 // The fixture records verification explicitly instead of claiming SMS delivery.
 env.db.prepare("UPDATE public_accounts SET phone_verified_at=?,verification_method='offline_integration_fixture'").run(new Date().toISOString());
 const accounts=env.db.prepare('SELECT actor,role,email FROM public_accounts').all();
 const byEmail=email=>accounts.find(row=>row.email===email).actor;
 state.riderId='rider:'+byEmail('rider@integration.test');state.captainActor=byEmail('captain@integration.test');state.secondActor=byEmail('second@integration.test');
 env.db.prepare("UPDATE captain_applications SET user_id=?,phone='+966500000093',status='active'").run(state.captainActor);
 env.db.prepare("INSERT INTO captain_applications SELECT ?,?,'+966500000094','second@integration.test',personal_json,vehicle_json,documents_json,'active',submitted_at,reviewed_at FROM captain_applications WHERE id=?").run(SECOND,state.secondActor,CAPTAIN);
 env.db.prepare("INSERT INTO platform_settings VALUES('commission_bps','1000',?,'offline-fixture')").run(new Date().toISOString());
 for(const [phone,key,name]of [['0500000091','riderCookie','__Host-mishwar_sid'],['0500000092','otherCookie','__Host-mishwar_sid']]){const response=await auth('password-login',{phone,password});state[key]=cookie(response,name);assert.equal((await read(response)).phoneVerified,true)}
 for(const [phone,key]of [['0500000093','captainCookie'],['0500000094','secondCookie']]){const response=await hub.fetch(request(ORIGINS.hub,'/api/auth/password-login',{phone,password}),env,{});state[key]=cookie(response,'__Host-mishwar_captain');assert.equal((await read(response)).phoneVerified,true)}
 const online=async()=>{for(const token of [state.captainCookie,state.secondCookie])await read(await c('available',{available:true,...pickup,accuracy:5,observedAt:new Date().toISOString()},token))};
 const quote=extra=>r('live_quote',{pickup,destination,category:'economy',...extra}).then(response=>read(response));
 const book=async({method='cash',extra={},quote:given}={})=>{const q=given||await quote(extra),result=await read(await r('live_book',{quoteId:q.id,method}),201);return {q,trip:result.trip}};
 const watch=id=>r('live_watch',{tripId:id}).then(response=>read(response));
 const adminTrip=id=>a('operations/trips?id='+id).then(response=>read(response));
 const ledger=()=>env.db.prepare('SELECT COUNT(*) n,COALESCE(SUM(amount_halalas),0) total FROM wallet_entries').get();
 const balance=account=>env.db.prepare('SELECT balance_halalas n FROM wallet_accounts WHERE account_id=?').get(account)?.n||0;
 const credit=(account,amount)=>{const tx='offline-credit:'+crypto.randomUUID();for(const [target,value]of [[account,amount],['offline_external',-amount]])env.db.prepare('INSERT INTO wallet_entries VALUES(?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),tx,target,value,0,'offline_fixture',tx,new Date().toISOString())};
 const accept=async id=>{await online();await read(await c('accept',{tripId:id}))};
 const riding=async id=>{await accept(id);for(const status of ['arrived','riding'])await read(await c('trip_status',{tripId:id,status}))};
 t.after(()=>assert.equal(traffic.forbidden,0,'No unintended external provider request'));
 return {env,state,traffic,r,c,a,auth,read,online,quote,book,watch,adminTrip,ledger,balance,credit,accept,riding};
}

test('integration registrations, role sessions and trip privacy cross the real gateways',async t=>{
 const f=await setup(t),{read,r,c,a,auth,state,env}=f;
 assert.equal((await read(await auth('session',undefined,state.riderCookie))).authenticated,true);
 assert.equal((await read(await auth('session',undefined,'__Host-mishwar_sid='+'0'.repeat(64)))).authenticated,false);
 assert.equal((await r('live_book',{quoteId:'forged',actor:state.riderId},'',{'oai-authenticated-user-id':state.riderId})).status,401);
 assert.equal((await c('accept',{tripId:'forged'},'',{'oai-authenticated-user-id':state.captainActor})).status,401);
 assert.equal((await a('operations/trips',undefined,{})).status,403);
 assert.equal((await a('operations/trips',undefined,{'oai-authenticated-user-id':'offline-owner','oai-authenticated-user-email':env.CAPTAIN_ADMIN_EMAIL})).status,403,'forged owner headers alone must not authenticate');
 const {trip}=await f.book();
 const foreign=await read(await r('live_watch',{tripId:trip.id},state.otherCookie));assert.equal(foreign.trip,null);assert.equal(foreign.recentTrip,null);
 assert.equal((await r('live_cancel',{tripId:trip.id,reason:'changed_plans'},state.otherCookie)).status,409);
 assert.equal((await c('trip_stop',{tripId:trip.id,stopIndex:0,phase:'arrived'},state.secondCookie)).status,403);
 assert.equal((await f.adminTrip(trip.id)).rider_id,state.riderId);
 await read(await auth('logout',{},state.riderCookie));
 assert.equal((await read(await auth('session',undefined,state.riderCookie))).authenticated,false);
 assert.equal((await r('live_watch',{tripId:trip.id})).status,401);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trips').get().n,1);
});

test('integration cash trip synchronizes all roles, GPS, ordered stops and exactly one completion',async t=>{
 const f=await setup(t),{read,r,c,state,env,traffic}=f;
 await f.online();const {q,trip}=await f.book({extra:{stops}}),id=trip.id;
 assert.equal(q.route.provider,'TomTom');assert.equal(q.route.distanceMeters,2700);assert.equal(q.route.durationSeconds,720);
 assert.deepEqual(traffic.roads[0].points,[pickup,...stops,destination].map(p=>({latitude:p.lat,longitude:p.lng})));
 const adminList=await read(await f.a('operations/trips'));assert.equal(adminList.total,1);assert.equal(adminList.items[0].status,'matching');
 const offered=await read(await c('session'));assert.equal(offered.requests[0].id,id);assert.equal(offered.requests[0].rider_phone,undefined);
 const competing=await Promise.all([c('accept',{tripId:id}),c('accept',{tripId:id},state.secondCookie)]);
 assert.equal(competing.filter(response=>response.status===200).length,1,'Only the assigned eligible captain accepts');
 assert.equal(env.db.prepare('SELECT driver_id FROM trips WHERE id=?').get(id).driver_id,CAPTAIN);
 const gps={tripId:id,lat:pickup.lat+.0001,lng:pickup.lng+.0001,accuracy:4,observedAt:new Date(Date.now()+100).toISOString()};
 await read(await c('location',gps));
 let watched=await f.watch(id);assert.equal(watched.trip.status,'arriving');assert.equal(watched.trip.driverLocation.fresh,true);
 assert.equal(watched.trip.eta.status,'available');assert.equal(watched.trip.eta.durationSeconds,240);assert.equal(watched.trip.eta.distanceMeters,900);assert.equal(watched.trip.eta.trafficAware,true);
 assert.equal(traffic.roads.at(-1).traffic,'true');
 assert.equal((await f.adminTrip(id)).status,'arriving');
 const shared=await read(await r('live_share_create',{tripId:id}));
 for(const status of ['arrived','riding']){await read(await c('trip_status',{tripId:id,status}));assert.equal((await f.watch(id)).trip.status,status);assert.equal((await read(await c('watch'))).current.status,status);assert.equal((await f.adminTrip(id)).status,status)}
 assert.equal((await c('trip_stop',{tripId:id,stopIndex:1,phase:'arrived'})).status,409);
 assert.equal((await c('trip_stop',{tripId:id,stopIndex:0,phase:'departed'})).status,409);
 const before=f.ledger();
 for(const stopIndex of [0,1])for(const phase of ['arrived','departed']){
  const reply=await read(await c('trip_stop',{tripId:id,stopIndex,phase}));assert.equal(reply.stopProgress.stops[stopIndex].status,phase);
  const replay=await read(await c('trip_stop',{tripId:id,stopIndex,phase}));assert.equal(replay.idempotent,true);
  const riderTrip=(await f.watch(id)).trip,captainTrip=(await read(await c('watch'))).current,adminTrip=await f.adminTrip(id);
  for(const [role,view]of [['rider',riderTrip],['captain',captainTrip],['admin',adminTrip]]){assert.ok(view.stopProgress,role+' must receive the persisted stop progress');assert.equal(view.stopProgress.stops[stopIndex].status,phase,'Stop progress must synchronize to all applications')}
  if(stopIndex===1&&phase==='departed'){
   for(const view of [riderTrip,adminTrip]){assert.equal(view.eta.status,'available');assert.equal(view.eta.target,'destination');assert.equal(view.eta.durationSeconds,240)}
   assert.deepEqual(traffic.roads.at(-1).points.at(-1),{latitude:destination.lat,longitude:destination.lng},'After the last departure ETA is a new road to the final destination');
  }else for(const view of [riderTrip,adminTrip]){assert.equal(view.eta.status,'unavailable');assert.equal(view.eta.reason,'stops_progress_unavailable','No final-destination ETA is invented while booked stops are pending')}
  assert.equal(env.db.prepare('SELECT fare_halalas FROM trips WHERE id=?').get(id).fare_halalas,q.payable);
 }
 assert.deepEqual(f.ledger(),before,'Stop actions never post a financial entry');
 await read(await c('trip_status',{tripId:id,status:'completed',cashReceived:true}));
 const finished=await f.watch(id),captain=await read(await c('history')),adminTrip=await f.adminTrip(id);
 assert.equal(finished.trip,null);for(const view of [finished.recentTrip,captain.trips[0],adminTrip]){assert.equal(view.status,'completed');assert.equal(view.payment_status,'cash_collected');assert.equal(view.stopProgress.allDeparted,true)}
 assert.equal(finished.recentTrip.driverLocation,null);assert.equal(finished.recentTrip.eta,null);
 assert.equal(env.db.prepare("SELECT COUNT(*) n FROM road_route_cache WHERE cache_key=?").get('live-eta:'+id).n,0);
 const done=await rider.fetch(new Request(ORIGINS.rider+'/api/shared-trip?token='+shared.token),{HUB_URL:ORIGINS.hub,HUB_SERVICE_KEY:env.RIDER_SERVICE_KEY},{trustedClientIp:'192.0.2.91'});
 assert.equal((await read(done)).ended,true);
 const ledger=f.ledger();assert.equal((await c('trip_status',{tripId:id,status:'completed',cashReceived:true})).status,409);assert.deepEqual(f.ledger(),ledger);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trip_settlements WHERE trip_id=?').get(id).n,1);assert.equal(ledger.total,0);
 assert.equal((await c('location',{...gps,observedAt:new Date().toISOString()})).status,403,'Completed trip no longer authorizes GPS');
});

test('integration cannot complete a ride before every booked stop has departed',async t=>{
 const f=await setup(t),{read,c,env}=f,{trip}=await f.book({extra:{stops}});await f.riding(trip.id);
 const before=f.ledger();
 assert.equal((await c('trip_status',{tripId:trip.id,status:'completed',cashReceived:true})).status,409,'RDEV-005 stop progression is a completion precondition');
 assert.equal(env.db.prepare('SELECT status FROM trips WHERE id=?').get(trip.id).status,'riding');assert.deepEqual(f.ledger(),before);
 await read(await c('trip_stop',{tripId:trip.id,stopIndex:0,phase:'arrived'}));await read(await c('trip_stop',{tripId:trip.id,stopIndex:0,phase:'departed'}));
 assert.equal((await c('trip_status',{tripId:trip.id,status:'completed',cashReceived:true})).status,409);
});

test('integration GPS staleness never produces live location or a fabricated ETA',async t=>{
 const f=await setup(t),{trip}=await f.book();await f.accept(trip.id);
 const fresh=await f.watch(trip.id);assert.equal(fresh.trip.eta.status,'available');
 const roadCalls=f.traffic.roads.length;
 f.env.db.prepare('UPDATE captain_presence SET location_at=? WHERE application_id=?').run(new Date(Date.now()-31000).toISOString(),CAPTAIN);
 const stale=await f.watch(trip.id);assert.equal(stale.trip.driverLocation.fresh,false);assert.equal(stale.trip.eta.status,'unavailable');assert.equal(stale.trip.eta.reason,'location_stale');assert.equal(f.traffic.roads.length,roadCalls);
 await f.read(await f.c('location',{tripId:trip.id,...pickup,accuracy:5,observedAt:new Date().toISOString()}));
 assert.equal((await f.watch(trip.id)).trip.driverLocation.fresh,true);
});

test('integration expired unpaid quote cannot create a trip or move wallet funds',async t=>{
 const f=await setup(t),{env,state,r,read}=f;await read(await r('live_session'));f.credit(state.riderId,10000);
 const q=await f.quote(),before=f.ledger();env.db.prepare('UPDATE ride_quotes SET expires_at=? WHERE id=?').run(new Date(Date.now()-60000).toISOString(),q.id);
 assert.equal((await r('live_book',{quoteId:q.id,method:'wallet'})).status,400);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trips').get().n,0);assert.equal(f.balance(state.riderId),10000);assert.deepEqual(f.ledger(),before);
 assert.equal((await read(await f.a('operations/trips'))).total,0);
});

test('integration route provider outage cannot fabricate a quote or fall back to an unapproved route',async t=>{
 const f=await setup(t);f.traffic.roadUnavailable=true;
 const response=await f.r('live_quote',{pickup,destination,category:'economy'}),body=await f.read(response,400);
 assert.equal(Object.hasOwn(body,'route'),false);assert.equal(Object.hasOwn(body,'fare'),false);assert.equal(Object.hasOwn(body,'payable'),false);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM ride_quotes').get().n,0);assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM trips').get().n,0);assert.equal(f.ledger().n,0);
 assert.equal(JSON.stringify(body).includes(f.env.TOMTOM_API_KEY),false,'Provider errors cannot reveal the server-side key');
});

test('integration lost booking response, repeated wallet requests and cancellation never double debit',async t=>{
 const f=await setup(t),{read,r,env,state}=f;await read(await r('live_session'));f.credit(state.riderId,10000);
 await read(await f.a('commerce/coupons',{code:'INTEGRATION',kind:'percent',value:1000,maxUses:10,expiresAt:'2030-01-01T00:00:00Z'}),201);
 const q=await f.quote({coupon:'INTEGRATION'}),body={quoteId:q.id,method:'wallet'};f.traffic.loseBookResponse=true;
 assert.equal((await r('live_book',body)).status,503,'Response loss is simulated only after the real booking commits');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trips').get().n,1);
 const retries=await Promise.all([r('live_book',body),r('live_book',body)]);assert.ok(retries.every(response=>response.status===400));
 const trip=(await f.watch()).trip;assert.ok(trip.id);assert.equal(f.balance(state.riderId),10000-q.payable);assert.equal(env.db.prepare('SELECT COUNT(*) n FROM coupon_redemptions').get().n,1);
 const cancelled=await Promise.all([r('live_cancel',{tripId:trip.id,reason:'changed_plans'}),r('live_cancel',{tripId:trip.id,reason:'changed_plans'})]);assert.equal(cancelled.filter(response=>response.status===200).length,1);
 assert.equal(f.balance(state.riderId),10000);assert.equal(f.balance('escrow:'+trip.id),0);assert.equal(f.ledger().total,0);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM coupon_redemptions').get().n,0);assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trip_settlements WHERE trip_id=?').get(trip.id).n,1);
 const after=f.ledger();assert.equal((await r('live_cancel',{tripId:trip.id,reason:'duplicate'})).status,409);assert.deepEqual(f.ledger(),after);
 assert.equal((await f.adminTrip(trip.id)).status,'cancelled');
});

test('integration cancelled card trip reconciles an uncertain refund once through rider and admin gateways',async t=>{
 const f=await setup(t),{env,state,r,a,read,traffic}=f;
 // Prefixes select the existing merchant-enabled code path only; these literal
 // fixture strings are not merchant credentials and every request is intercepted.
 Object.assign(env,{MOYASAR_ENABLED:'true',MOYASAR_SECRET_KEY:'sk_live_OFFLINE_INTEGRATION_ONLY',MOYASAR_PUBLIC_KEY:'pk_live_OFFLINE_INTEGRATION_ONLY'});
 const q=await f.quote(),intent=await read(await r('live_payment_init',{purpose:'trip',quoteId:q.id,method:'card'}));
 traffic.payment={id:'integration-provider-payment',status:'paid',amount:intent.amount,currency:'SAR',metadata:{intent_id:intent.id},source:{type:'creditcard'}};
 await read(await r('live_payment_verify',{intentId:intent.id,paymentId:traffic.payment.id}));await read(await r('live_payment_verify',{intentId:intent.id,paymentId:traffic.payment.id}));
 assert.equal(f.balance(state.riderId),q.payable);
 const {trip}=await read(await r('live_book',{quoteId:q.id,method:'card',intentId:intent.id}),201);
 assert.equal((await read(await r('live_refunds'))).payments.length,0,'An active card trip cannot be refunded');
 assert.equal((await r('live_refund_request',{intentId:intent.id,reason:'Synthetic cancellation refund'},state.otherCookie)).status,400);
 await read(await r('live_cancel',{tripId:trip.id,reason:'changed_plans'}));assert.equal(f.balance(state.riderId),q.payable);
 const request=await read(await r('live_refund_request',{intentId:intent.id,reason:'Synthetic cancellation refund'}));assert.equal(f.balance(state.riderId),0);
 assert.equal((await r('live_refund_request',{intentId:intent.id,reason:'Duplicate refund attempt'})).status,400);
 assert.equal((await a('launch/refunds',undefined,{})).status,403);
 const listed=await read(await a('launch/refunds'));assert.equal(listed.items[0].id,request.id);
 await read(await a('launch/refunds',{action:'submit',id:request.id,confirm:true}));
 assert.equal(traffic.refundPosts,1);assert.equal(env.db.prepare('SELECT status FROM refund_requests WHERE id=?').get(request.id).status,'submitted_unknown');
 assert.equal((await a('launch/refunds',{action:'submit',id:request.id,confirm:true})).status,400);assert.equal(traffic.refundPosts,1,'Unknown financial outcome must never auto-resubmit');
 traffic.reconcileGate=deferred();
 const pending=[a('launch/refunds',{action:'reconcile',id:request.id}),a('launch/refunds',{action:'reconcile',id:request.id})];
 for(let i=0;i<40&&traffic.reconcileStarted<2;i++)await wait();
 assert.equal(traffic.reconcileStarted,2,'Both reconciliations must actually overlap at the mocked provider');
 traffic.reconcileGate.resolve();
 for(const response of await Promise.all(pending))assert.equal((await read(response)).status,'refunded');
 assert.equal(env.db.prepare("SELECT COUNT(*) n FROM operation_events WHERE id=?").get('refund-finalization:'+request.id).n,1);
 assert.equal(env.db.prepare("SELECT COUNT(*) n FROM wallet_entries WHERE kind='card_refund' AND reference=?").get(request.id).n,2);
 assert.equal(f.balance('refund:'+request.id),0);assert.equal(f.balance(state.riderId),0);assert.equal(f.ledger().total,0);
 const final=f.ledger(),calls=traffic.merchant.length;
 await read(await a('launch/refunds',{action:'reconcile',id:request.id}));assert.deepEqual(f.ledger(),final);assert.equal(traffic.merchant.length,calls);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM trips').get().n,1);assert.equal(env.db.prepare('SELECT COUNT(*) n FROM refund_requests').get().n,1);
});
