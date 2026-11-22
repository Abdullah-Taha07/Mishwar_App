import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {handleDriver} from '../worker/commerce.js';
import {captainStopAction} from '../worker/stop-progress.js';
import {captainLocationForTrip,riderTrackingView} from '../worker/live-tracking.js';

const captain='11111111-1111-4111-8111-111111111111';
const origin='https://stop-completion.local.test';
function setup(t){
 const env=makeEnv(true);t.after(()=>env.db.close());
 const id=crypto.randomUUID(),at=new Date().toISOString();
 env.db.prepare("UPDATE captain_applications SET status='active'").run();
 env.db.prepare('INSERT INTO riders(id,name,created_at,last_seen) VALUES(?,?,?,?)').run('rider:stop-completion','Offline stop completion',at,at);
 env.db.prepare('INSERT INTO trips(id,rider_id,driver_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(id,'rider:stop-completion',captain,'riding',JSON.stringify({name:'Pickup',lat:24.7,lng:46.6}),JSON.stringify({name:'Destination',lat:24.73,lng:46.63}),3500,1000,'cash_due',0,at,at);
 env.db.prepare('INSERT INTO trip_commerce(trip_id,quote_id,method,cash_due_halalas) VALUES(?,?,?,?)').run(id,'offline-stop-quote','cash',3500);
 env.db.prepare('INSERT INTO trip_options(trip_id,stops_json,guest_name,business_note) VALUES(?,?,?,?)').run(id,JSON.stringify([{name:'First stop',lat:24.71,lng:46.61},{name:'Second stop',lat:24.72,lng:46.62}]),'','');
 const finish=()=>handleDriver(new Request(origin+'/api/driver',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':'qa-applicant'},body:JSON.stringify({action:'trip_status',tripId:id,status:'completed',cashReceived:true})}),env);
 const progress=(stopIndex,phase)=>captainStopAction(env,captain,{tripId:id,stopIndex,phase});
 return {env,id,finish,progress};
}
test('a riding trip cannot settle before all booked stops were departed',async t=>{
 const f=setup(t);
 const result=await f.finish();
 assert.equal(result.status,409,JSON.stringify(await result.json()));
 assert.equal(f.env.db.prepare('SELECT status FROM trips WHERE id=?').get(f.id).status,'riding');
 assert.equal(f.env.db.prepare('SELECT COUNT(*) AS n FROM trip_settlements').get().n,0);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) AS n FROM wallet_entries').get().n,0);
});
test('stop completion remains blocked at arrival and until the final departure, then settles once',async t=>{
 const f=setup(t);
 for(const [index,phase]of [[0,'arrived'],[0,'departed'],[1,'arrived']]){
  await f.progress(index,phase);assert.equal((await f.finish()).status,409);
 }
 await f.progress(1,'departed');assert.equal((await f.finish()).status,200);
 assert.equal((await f.finish()).status,409);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) AS n FROM trip_settlements').get().n,1);
 assert.equal(f.env.db.prepare('SELECT SUM(amount_halalas) AS n FROM wallet_entries').get().n,0);
});

test('the atomic settlement rechecks departures rather than trusting a pre-write snapshot',async t=>{
 const f=setup(t);for(const i of [0,1]){await f.progress(i,'arrived');await f.progress(i,'departed')}
 const batch=f.env.DB.batch;
 // Model a change between the handler's validated read and D1's atomic write.
 // The transaction must fail closed even if the read snapshot said all departed.
 let interleaved=false;
 f.env.DB.batch=async items=>{
  if(!interleaved){interleaved=true;f.env.db.prepare('DELETE FROM operation_events WHERE id=?').run('trip-stop:'+f.id+':1:departed')}
  return batch(items);
 };
 const response=await f.finish();assert.equal(response.status,409);
 assert.equal((await response.json()).code,'STOP_SEQUENCE_CONFLICT');
 assert.equal(f.env.db.prepare('SELECT status FROM trips WHERE id=?').get(f.id).status,'riding');
 assert.equal(f.env.db.prepare('SELECT COUNT(*) AS n FROM trip_settlements').get().n,0);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) AS n FROM wallet_entries').get().n,0);
 assert.equal(f.env.db.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE action='trip_completion_snapshot'").get().n,0,'The failed settlement batch rolls back its snapshot too');
});

function trackingFixture(t){
 const f=setup(t),originalFetch=globalThis.fetch;let providerCalls=0,provider=null;
 t.after(()=>{globalThis.fetch=originalFetch});
 Object.assign(f.env,{TOMTOM_ENABLED:'true',TOMTOM_API_KEY:'offline-stop-eta-fixture',REQUIRE_COMMERCIAL_ROUTES:'true'});
 const at=new Date(Date.now()-1000).toISOString();
 f.env.db.prepare('INSERT INTO captain_presence VALUES(?,?,?,?,?,?,?)').run(captain,1,at,24.72,46.62,5,at);
 globalThis.fetch=async input=>{
  const url=new URL(input instanceof Request?input.url:input);
  assert.equal(url.hostname,'api.tomtom.com');assert.equal(url.searchParams.get('key'),'offline-stop-eta-fixture');providerCalls++;
  const facts=()=>{
   const points=url.pathname.slice('/routing/1/calculateRoute/'.length).replace(/\/json$/,'').split(':').map(s=>{const[latitude,longitude]=s.split(',').map(Number);return {latitude,longitude}});
   return Response.json({routes:[{summary:{lengthInMeters:2200,travelTimeInSeconds:420,trafficDelayInSeconds:20},legs:points.slice(1).map((point,index)=>({points:[points[index],point]}))}]});
  };
  return provider?provider(facts):facts();
 };
 const view=async()=>{
  const row=f.env.db.prepare('SELECT t.*,o.stops_json,p.latitude driver_lat,p.longitude driver_lng,p.accuracy driver_accuracy,p.location_at driver_location_at FROM trips t JOIN trip_options o ON o.trip_id=t.id JOIN captain_presence p ON p.application_id=t.driver_id WHERE t.id=?').get(f.id);
  const trip={...row,pickup:JSON.parse(row.pickup_json),destination:JSON.parse(row.destination_json),options:{stops:JSON.parse(row.stops_json)}};
  trip.driverLocation=await captainLocationForTrip(f.env,trip);return riderTrackingView(f.env,trip);
 };
 return {...f,view,providerCalls:()=>providerCalls,provider:fn=>{provider=fn}};
}

test('remaining-stop ETA stays unavailable, then the final leg uses provider facts after all departures',async t=>{
 const f=trackingFixture(t);
 assert.equal((await f.view()).eta.reason,'stops_progress_unavailable');assert.equal(f.providerCalls(),0);
 for(const i of [0,1]){await f.progress(i,'arrived');await f.progress(i,'departed')}
 const trip=await f.view();assert.equal(trip.eta.status,'available');assert.equal(trip.eta.target,'destination');
 assert.equal(trip.eta.durationSeconds,420);assert.equal(trip.eta.distanceMeters,2200);assert.equal(trip.eta.provider,'TomTom');
 assert.equal(f.providerCalls(),1);assert.equal((await f.view()).eta.durationSeconds,420);assert.equal(f.providerCalls(),1,'The same completed-stop snapshot may reuse its fresh route');
});

test('a stop-progress change during route calculation discards its former ETA',async t=>{
 const f=trackingFixture(t);for(const i of [0,1]){await f.progress(i,'arrived');await f.progress(i,'departed')}
 f.provider(async facts=>{f.env.db.prepare('DELETE FROM operation_events WHERE id=?').run('trip-stop:'+f.id+':1:departed');return facts()});
 const trip=await f.view();assert.equal(trip.eta.status,'unavailable');assert.equal(trip.eta.reason,'trip_changed');
 assert.equal(f.env.db.prepare("SELECT COUNT(*) AS n FROM road_route_cache WHERE cache_key LIKE 'live-eta:%'").get().n,0);
});

test('the stop fingerprint is checked again by the cache write statement',async t=>{
 const f=trackingFixture(t);for(const i of [0,1]){await f.progress(i,'arrived');await f.progress(i,'departed')}
 const prepare=f.env.DB.prepare;let interleaved=false;
 f.env.DB.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.startsWith('INSERT INTO road_route_cache(cache_key,route_json,expires_at) SELECT'))return statement;
  return {...statement,bind(...values){const bound=statement.bind(...values);return {...bound,async run(){
   if(!interleaved){interleaved=true;f.env.db.prepare('DELETE FROM operation_events WHERE id=?').run('trip-stop:'+f.id+':1:departed')}
   return bound.run();
  }}}};
 };
 const trip=await f.view();assert.equal(trip.eta.status,'unavailable');assert.equal(trip.eta.reason,'trip_changed');
 assert.equal(f.env.db.prepare("SELECT COUNT(*) AS n FROM road_route_cache WHERE cache_key LIKE 'live-eta:%'").get().n,0);
});
