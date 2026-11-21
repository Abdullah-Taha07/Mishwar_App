import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {checkedCaptainMeasurement,writeCaptainLocation,captainLocationForTrip,riderTrackingView,TRACKING_POLICY} from '../worker/live-tracking.js';
import {handleDriver,handleLiveRider} from '../worker/commerce.js';
import {drivingItinerary} from '../worker/routing.js';
import {launchAction,sharedTrip} from '../worker/launch-features.js';

const CAPTAIN='11111111-1111-4111-8111-111111111111',RIDER='rider:tracking-owner';
const nativeFetch=globalThis.fetch,nativeNow=Date.now;
const point={name:'Synthetic pickup',lat:24.7,lng:46.6},destination={name:'Synthetic destination',lat:24.72,lng:46.62};
const later=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve()};
test.afterEach(()=>{globalThis.fetch=nativeFetch;Date.now=nativeNow});
function setup(t,{status='arriving'}={}){
 let time=nativeNow();Date.now=()=>time;
 const env=makeEnv(true);t.after(()=>env.db.close());env.db.prepare("UPDATE captain_applications SET status='active'").run();
 Object.assign(env,{TOMTOM_ENABLED:'true',TOMTOM_API_KEY:'eta-offline-fixture-only',REQUIRE_COMMERCIAL_ROUTES:'true'});
 const at=new Date(time-5000).toISOString(),id=crypto.randomUUID(),quote='quote-'+id;
 env.db.prepare('INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').run(RIDER,'Synthetic tracking owner','+966500000093','tracking@example.test',at,at);
 env.db.prepare('INSERT INTO captain_presence VALUES(?,?,?,?,?,?,?)').run(CAPTAIN,1,at,point.lat,point.lng,10,at);
 env.db.prepare('INSERT INTO ride_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(quote,RIDER,JSON.stringify(point),JSON.stringify(destination),'economy',2500,0,null,1000,'2030-01-01T00:00:00Z',null);
 env.db.prepare('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,RIDER,CAPTAIN,status,JSON.stringify(point),JSON.stringify(destination),2500,1000,'cash_due',0,at,at);
 env.db.prepare('INSERT INTO trip_commerce VALUES(?,?,?,?,?,?)').run(id,quote,'cash',0,2500,null);
 const providerCalls=[];let provider=null;
 globalThis.fetch=async input=>{
  const url=new URL(input instanceof Request?input.url:input);
  assert.equal(url.hostname,'api.tomtom.com','Never call a real or unrelated provider');assert.equal(url.searchParams.get('key'),'eta-offline-fixture-only');
  providerCalls.push({path:url.pathname,traffic:url.searchParams.get('traffic')});
  if(provider)return provider(url);
  const coordinates=url.pathname.slice('/routing/1/calculateRoute/'.length).replace(/\/json$/,'').split(':').map(v=>{const[latitude,longitude]=v.split(',').map(Number);return{latitude,longitude}});
  return Response.json({routes:[{summary:{lengthInMeters:1800,travelTimeInSeconds:240,trafficDelayInSeconds:30},legs:coordinates.slice(1).map((p,n)=>({points:[coordinates[n],p]}))}]});
 };
 const measurement=(extra={})=>({lat:point.lat,lng:point.lng,accuracy:10,observedAt:new Date(time).toISOString(),tripId:id,heading:90,...extra});
 const view=async()=>{const r=env.db.prepare('SELECT t.*,p.latitude driver_lat,p.longitude driver_lng,p.accuracy driver_accuracy,p.location_at driver_location_at FROM trips t LEFT JOIN captain_presence p ON p.application_id=t.driver_id WHERE t.id=?').get(id);const trip={...r,pickup:point,destination,options:{stops:[]}};trip.driverLocation=await captainLocationForTrip(env,trip);return trip};
 const request=(role,body,token)=>new Request('https://local.test/'+(role==='rider'?'internal/live-rider':'api/driver'),{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://local.test',...(role==='rider'?{'x-mishwar-key':env.RIDER_SERVICE_KEY}:{'oai-authenticated-user-id':'qa-applicant'})},body:JSON.stringify({...body,...(token?{sessionToken:token}:{})})});
 return {env,id,view,measurement,providerCalls,clock:()=>time,advance(ms){time+=ms},provider(fn){provider=fn},rider:(body,actor='tracking-owner')=>handleLiveRider(request('rider',body,env.verifiedToken(actor)),env),driver:body=>handleDriver(request('captain',body),env)};
}

test('RDEV-003 measurement validates real sensor age, bounds and existing150m accuracy policy',t=>{
 const f=setup(t);assert.equal(TRACKING_POLICY.maxAccuracy,150);assert.equal(checkedCaptainMeasurement(f.measurement({accuracy:150})).accuracy,150);
 for(const patch of [{lat:91},{lng:-181},{accuracy:NaN},{accuracy:-1},{accuracy:151},{observedAt:new Date(f.clock()-31000).toISOString()},{observedAt:new Date(f.clock()+6000).toISOString()},{observedAt:undefined}])assert.throws(()=>checkedCaptainMeasurement(f.measurement(patch)));
 assert.equal(checkedCaptainMeasurement(f.measurement({heading:400})).heading,null);
});

test('RDEV-003 active-trip writes require assigned trip ID and cannot replay older/conflicting GPS',async t=>{
 const f=setup(t);await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement({tripId:undefined})),{status:403});
 await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement({tripId:undefined}),{available:true}),{status:403});
 await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement({tripId:'another-trip'})),{status:403});
 assert.equal((await writeCaptainLocation(f.env,CAPTAIN,f.measurement())).accepted,true);
 assert.equal((await writeCaptainLocation(f.env,CAPTAIN,f.measurement())).duplicate,true);
 await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement({lat:24.7001})),{status:409});
 await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement({observedAt:new Date(f.clock()-1000).toISOString()})),{status:409});
 assert.equal(f.env.db.prepare('SELECT location_at FROM captain_presence').get().location_at,f.measurement().observedAt);
});

test('RDEV-003 repeated availability with the same observed sample still turns an offline captain online',async t=>{
 const f=setup(t,{status:'completed'}),at=f.env.db.prepare('SELECT location_at FROM captain_presence').get().location_at;
 f.env.db.prepare('UPDATE captain_presence SET available=0').run();
 const result=await writeCaptainLocation(f.env,CAPTAIN,f.measurement({tripId:undefined,observedAt:at}),{available:true});
 assert.equal(result.duplicate,true);assert.equal(f.env.db.prepare('SELECT available FROM captain_presence').get().available,1);
 assert.equal(f.env.db.prepare('SELECT location_at FROM captain_presence').get().location_at,at);
});

test('RDEV-003 GPS rate limits and impossible jumps do not change the accepted location',async t=>{
 const f=setup(t);await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement({lat:30})),{status:409});
 await writeCaptainLocation(f.env,CAPTAIN,f.measurement());
 for(let n=2;n<30;n++)await writeCaptainLocation(f.env,CAPTAIN,f.measurement());
 await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement()),{status:429});
 assert.equal(f.env.db.prepare('SELECT latitude FROM captain_presence').get().latitude,point.lat);
});

test('RDEV-003 ETA uses driving facts, fixed freshness and one expiring cache entry without GPS route history',async t=>{
 const f=setup(t),a=await riderTrackingView(f.env,await f.view());
 assert.equal(a.eta.status,'available');assert.equal(a.eta.target,'pickup');assert.equal(a.eta.minutes,4);assert.equal(a.eta.durationSeconds,240);assert.equal(a.eta.trafficDelaySeconds,30);assert.equal(a.eta.trafficAware,true);
 f.advance(10000);const b=await riderTrackingView(f.env,await f.view());assert.equal(b.eta.expiresAt,a.eta.expiresAt);assert.equal(b.eta.calculatedAt,a.eta.calculatedAt);assert.equal(f.providerCalls.length,1);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM road_route_cache').get().n,1);
 assert.equal(f.env.db.prepare("SELECT COUNT(*) n FROM road_route_cache WHERE cache_key NOT LIKE 'live-eta:%'").get().n,0);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM wallet_entries').get().n,0);
});

test('RDEV-003 fresh movement invalidates old ETA during route throttle rather than claiming it is current',async t=>{
 const f=setup(t);await riderTrackingView(f.env,await f.view());f.advance(1000);
 await writeCaptainLocation(f.env,CAPTAIN,f.measurement({lat:point.lat+.001}));
 const pending=await riderTrackingView(f.env,await f.view());assert.equal(pending.eta.status,'unavailable');assert.equal(pending.eta.reason,'route_refresh_pending');assert.equal(f.providerCalls.length,1);
 f.advance(15000);await writeCaptainLocation(f.env,CAPTAIN,f.measurement({lat:point.lat+.001}));
 assert.equal((await riderTrackingView(f.env,await f.view())).eta.status,'available');assert.equal(f.providerCalls.length,2);
});

test('RDEV-003 stale GPS and unconfigured routing never fabricate ETA or contact a public fallback',async t=>{
 const f=setup(t);f.advance(31000);let value=await riderTrackingView(f.env,await f.view());assert.equal(value.eta.status,'unavailable');assert.equal(value.eta.reason,'location_stale');assert.equal(f.providerCalls.length,0);
 await writeCaptainLocation(f.env,CAPTAIN,f.measurement());f.env.TOMTOM_ENABLED='false';f.env.REQUIRE_COMMERCIAL_ROUTES='false';
 value=await riderTrackingView(f.env,await f.view());assert.equal(value.eta.status,'unavailable');assert.equal(value.eta.reason,'route_untrusted');assert.equal(f.providerCalls.length,0);
});

test('RDEV-003 in-flight ETA is deduplicated and discarded if newer GPS arrives before provider completion',async t=>{
 const f=setup(t),gate=later();f.provider(()=>gate.promise);
 const view=await f.view(),a=riderTrackingView(f.env,view),b=riderTrackingView(f.env,view);await flush();assert.equal(f.providerCalls.length,1);
 f.advance(1000);await writeCaptainLocation(f.env,CAPTAIN,f.measurement({lat:point.lat+.001}));
 gate.resolve(Response.json({routes:[{summary:{lengthInMeters:1800,travelTimeInSeconds:240,trafficDelayInSeconds:30},legs:[{points:[{latitude:point.lat,longitude:point.lng},{latitude:destination.lat,longitude:destination.lng}]}]}]}));
 for(const result of await Promise.all([a,b]))assert.equal(result.eta.status,'unavailable');
 assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM road_route_cache').get().n,0);
});

test('RDEV-003 completion during route work removes private location and old ETA',async t=>{
 const f=setup(t),gate=later();f.provider(()=>gate.promise);const pending=riderTrackingView(f.env,await f.view());await flush();
 f.env.db.prepare("UPDATE trips SET status='completed'").run();
 gate.resolve(Response.json({routes:[{summary:{lengthInMeters:1800,travelTimeInSeconds:240},legs:[{points:[{latitude:point.lat,longitude:point.lng},{latitude:destination.lat,longitude:destination.lng}]}]}]}));
 const value=await pending;assert.equal(value.status,'completed');assert.equal(value.driverLocation,null);assert.equal(value.eta,null);
 for(const key of ['driver_lat','driver_lng','driver_accuracy','driver_location_at'])assert.equal(value[key],undefined);
});

test('RDEV-003 expired route reply is not cached or relabeled as live',async t=>{
 const f=setup(t),gate=later();f.provider(()=>gate.promise);const pending=riderTrackingView(f.env,await f.view());await flush();f.advance(31000);
 gate.resolve(Response.json({routes:[{summary:{lengthInMeters:1800,travelTimeInSeconds:240},legs:[{points:[{latitude:point.lat,longitude:point.lng},{latitude:destination.lat,longitude:destination.lng}]}]}]}));
 const value=await pending;assert.equal(value.eta.status,'unavailable');assert.equal(value.driverLocation.fresh,false);assert.equal(f.env.db.prepare('SELECT COUNT(*) n FROM road_route_cache').get().n,0);
});

test('RDEV-003 arrival and unconfirmed multi-stop progress use explicit states rather than invented minutes',async t=>{
 const f=setup(t,{status:'arrived'});let value=await riderTrackingView(f.env,await f.view());assert.equal(value.eta.status,'arrived');assert.equal(value.eta.minutes,undefined);
 f.env.db.prepare("UPDATE trips SET status='riding'").run();const trip=await f.view();trip.options.stops=[point];value=await riderTrackingView(f.env,trip);
 assert.equal(value.eta.reason,'stops_progress_unavailable');assert.equal(value.eta.minutes,undefined);assert.equal(f.providerCalls.length,0);
});

test('RDEV-003 authenticated rider watches get only their trip ETA and terminal history never leaks captain presence',async t=>{
 const f=setup(t);let response=await f.rider({action:'live_watch'}),value=await response.json();assert.equal(response.status,200);assert.equal(value.trip.eta.status,'available');
 assert.equal((await (await f.rider({action:'live_watch',tripId:f.id},'another-owner')).json()).trip,null);
 f.env.db.prepare("UPDATE trips SET status='completed'").run();response=await f.rider({action:'live_history'});value=await response.json();assert.equal(value.trips[0].driverLocation,null);
 for(const key of ['driver_lat','driver_lng','driver_accuracy','driver_location_at'])assert.equal(value.trips[0][key],undefined);
 const before=f.env.db.prepare('SELECT location_at FROM captain_presence').get().location_at;
 response=await f.driver({action:'location',...f.measurement()});assert.equal(response.status,403);assert.equal(f.env.db.prepare('SELECT location_at FROM captain_presence').get().location_at,before);
});

test('RDEV-003 trusted OSRM live requests neither read nor persist GPS-origin route history',async t=>{
 const f=setup(t);f.env.TOMTOM_ENABLED='false';f.env.REQUIRE_COMMERCIAL_ROUTES='false';f.env.OSRM_BASE_URL='https://isolated-routing.example.test';
 const cacheKey='osrm:'+f.env.OSRM_BASE_URL+':'+[point.lng,point.lat,destination.lng,destination.lat].map(n=>n.toFixed(5)).join(',');
 f.env.db.prepare('INSERT INTO road_route_cache VALUES(?,?,?)').run(cacheKey,JSON.stringify({distanceMeters:99999,durationSeconds:99999,geometry:null,provider:'OSRM'}),'2030-01-01T00:00:00Z');
 let calls=0;globalThis.fetch=async input=>{assert.equal(new URL(input).hostname,'isolated-routing.example.test');calls++;return Response.json({code:'Ok',routes:[{distance:1800,duration:240}]})};
 const route=await drivingItinerary(f.env,point,destination,[],{cache:false,requireTrusted:true});assert.equal(route.durationSeconds,240);assert.equal(calls,1);
 assert.equal(JSON.parse(f.env.db.prepare('SELECT route_json FROM road_route_cache WHERE cache_key=?').get(cacheKey).route_json).durationSeconds,99999);
 f.env.db.prepare('DELETE FROM road_route_cache').run();const view=await riderTrackingView(f.env,await f.view());assert.equal(view.eta.provider,'OSRM');assert.equal(view.eta.trafficAware,false);assert.equal(view.eta.trafficDelaySeconds,0);
 assert.equal(f.env.db.prepare("SELECT COUNT(*) n FROM road_route_cache WHERE cache_key NOT LIKE 'live-eta:%'").get().n,0);
 delete f.env.OSRM_BASE_URL;await assert.rejects(drivingItinerary(f.env,point,destination,[],{cache:false,requireTrusted:true}),/UNTRUSTED_ETA_ROUTE/);assert.equal(calls,2);
});

test('RDEV-003 assignment and presence are rechecked atomically before GPS mutation',async t=>{
 const f=setup(t),before=f.env.db.prepare('SELECT location_at FROM captain_presence').get().location_at;
 await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement(),{beforeWrite:async()=>{f.env.db.prepare("UPDATE trips SET status='completed' WHERE id=?").run(f.id)}}),{status:409});
 assert.equal(f.env.db.prepare('SELECT location_at FROM captain_presence').get().location_at,before);
 assert.equal(f.env.db.prepare("SELECT COUNT(*) n FROM platform_settings WHERE key LIKE 'tracking-captain:%'").get().n,0);
});

test('RDEV-003 old-tab GPS cannot overwrite a newer sensor sample that wins the write race',async t=>{
 const f=setup(t),newer=new Date(f.clock()+1).toISOString();
 await assert.rejects(writeCaptainLocation(f.env,CAPTAIN,f.measurement(),{beforeWrite:async()=>{f.env.db.prepare('UPDATE captain_presence SET location_at=?,latitude=?').run(newer,24.7001)}}),{status:409});
 const current=f.env.db.prepare('SELECT location_at,latitude FROM captain_presence').get();assert.equal(current.location_at,newer);assert.equal(current.latitude,24.7001);
});

test('RDEV-003 completing or cancelling through real handlers removes the cached private ETA immediately',async t=>{
 for(const completed of [false,true]){
  const f=setup(t,{status:completed?'riding':'arriving'});assert.equal((await riderTrackingView(f.env,await f.view())).eta.status,'available');
  let response=completed?await f.driver({action:'trip_status',tripId:f.id,status:'completed',cashReceived:true}):await f.rider({action:'live_cancel',tripId:f.id,reason:'changed_plans'});assert.equal(response.status,200,await response.clone().text());
  assert.equal(f.env.db.prepare("SELECT COUNT(*) n FROM road_route_cache WHERE cache_key LIKE 'live-eta:%'").get().n,0);
  response=await f.rider({action:'live_session',tripId:f.id});const data=await response.json();assert.equal(data.recentTrip.eta,null);assert.equal(data.recentTrip.driverLocation,null);
 }
});

test('RDEV-003 zero provider duration never becomes an invented one-minute ETA',async t=>{
 const f=setup(t);f.provider(()=>Response.json({routes:[{summary:{lengthInMeters:0,travelTimeInSeconds:0},legs:[{points:[{latitude:point.lat,longitude:point.lng},{latitude:destination.lat,longitude:destination.lng}]}]}]}));
 const value=await riderTrackingView(f.env,await f.view());assert.equal(value.eta.status,'unavailable');assert.equal(value.eta.minutes,undefined);assert.equal(value.eta.durationSeconds,undefined);
});

test('RDEV-003 shared-token viewers use the same GPS age/accuracy policy and receive no location after completion',async t=>{
 const f=setup(t),share=await launchAction(f.env,'rider',RIDER,{action:'share_create',tripId:f.id});
 let data=await (await sharedTrip(f.env,share.token)).json();assert.equal(data.location.fresh,true);assert.equal(data.location.accuracy,10);assert.equal(data.rider_id,undefined);
 f.advance(31000);data=await (await sharedTrip(f.env,share.token)).json();assert.equal(data.location.fresh,false);
 f.env.db.prepare('UPDATE captain_presence SET accuracy=151').run();data=await (await sharedTrip(f.env,share.token)).json();assert.equal(data.location,null);
 f.env.db.prepare('UPDATE captain_presence SET accuracy=10,latitude=91').run();data=await (await sharedTrip(f.env,share.token)).json();assert.equal(data.location,null);
 f.env.db.prepare("UPDATE trips SET status='completed'").run();data=await (await sharedTrip(f.env,share.token)).json();assert.deepEqual(data,{ended:true,status:'completed'});
});
