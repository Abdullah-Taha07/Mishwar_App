import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {handleOperations} from '../worker/operations.js';
import {captainStopAction} from '../worker/stop-progress.js';

function setup(t,status='riding'){
 const env=makeEnv(true);t.after(()=>env.db.close());
 const id=crypto.randomUUID(),captain='11111111-1111-4111-8111-111111111111',at=new Date().toISOString();
 const stops=[{name:'Local stop A',lat:24.72,lng:46.62},{name:'Local stop B',lat:24.73,lng:46.63}];
 env.db.prepare('INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').run('rider:admin-sync','Synthetic rider','+966500000099','admin-sync@example.test',at,at);
 env.db.prepare('INSERT INTO trips(id,rider_id,driver_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'rider:admin-sync',captain,status,JSON.stringify({name:'Local pickup',lat:24.7,lng:46.6}),JSON.stringify({name:'Local destination',lat:24.74,lng:46.64}),3500,1000,'cash_due',0,at,at);
 env.db.prepare('INSERT INTO trip_options(trip_id,stops_json,guest_name,business_note) VALUES(?,?,?,?)').run(id,JSON.stringify(stops),'','');
 const read=async()=>{
  const response=await handleOperations(new Request('https://hub.local.test/internal/administration/operations/trips?id='+id),env);
  assert.equal(response.status,200);return response.json();
 };
 return {env,id,captain,stops,read};
}

test('administration detail preserves the booked stop order and current progress contract',async t=>{
 const f=setup(t),before=await f.read();
 assert.deepEqual(before.options.stops,f.stops);
 assert.equal(before.stopProgress.nextIndex,0);
 assert.deepEqual(before.stopProgress.stops.map(s=>s.status),['pending','pending']);
 await captainStopAction(f.env,f.captain,{tripId:f.id,stopIndex:0,phase:'arrived'});
 const arrived=await f.read();assert.equal(arrived.stopProgress.stops[0].status,'arrived');
 await captainStopAction(f.env,f.captain,{tripId:f.id,stopIndex:0,phase:'departed'});
 const departed=await f.read();assert.equal(departed.stopProgress.nextIndex,1);
 assert.deepEqual(departed.stopProgress.stops.map(s=>s.status),['departed','pending']);
 assert.deepEqual(departed.events.map(e=>e.action),['trip_stop_arrived','trip_stop_departed']);
 assert.equal(departed.fare_halalas,before.fare_halalas);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) AS n FROM wallet_entries').get().n,0);
});

test('administration tracking reports stale GPS without making up ETA or exposing raw tracking fields',async t=>{
 const f=setup(t),at=new Date(Date.now()-120000).toISOString();
 f.env.db.prepare('INSERT INTO captain_presence(application_id,available,last_seen,latitude,longitude,accuracy,location_at) VALUES(?,?,?,?,?,?,?)').run(f.captain,1,at,24.701,46.601,5,at);
 const value=await f.read();assert.equal(value.driverLocation.fresh,false);
 assert.equal(value.eta.status,'unavailable');assert.equal(value.eta.reason,'location_stale');
 assert.equal(value.eta.minutes,undefined);
 for(const key of ['driver_lat','driver_lng','driver_accuracy','driver_location_at'])assert.equal(Object.hasOwn(value,key),false);
});

for(const status of ['completed','cancelled'])test('administration '+status+' detail closes GPS/ETA and clears its private route cache',async t=>{
 const f=setup(t,status),at=new Date().toISOString();
 f.env.db.prepare('INSERT INTO captain_presence(application_id,available,last_seen,latitude,longitude,accuracy,location_at) VALUES(?,?,?,?,?,?,?)').run(f.captain,1,at,24.701,46.601,5,at);
 f.env.db.prepare('INSERT INTO road_route_cache VALUES(?,?,?)').run('live-eta:'+f.id,'{}',new Date(Date.now()+30000).toISOString());
 const value=await f.read();assert.equal(value.status,status);
 assert.equal(value.driverLocation,null);assert.equal(value.eta,null);
 assert.equal(f.env.db.prepare('SELECT COUNT(*) AS n FROM road_route_cache WHERE cache_key=?').get('live-eta:'+f.id).n,0);
});
