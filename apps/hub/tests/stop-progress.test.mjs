import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {captainStopAction,tripStopProgress,stopSnapshot} from '../worker/stop-progress.js';

const captain='11111111-1111-4111-8111-111111111111';
const stops=[{name:'Stop A',lat:24.72,lng:46.62},{name:'Stop B',lat:24.74,lng:46.64}];
function setup(t,number=2,status='riding'){
 const env=makeEnv(true);t.after(()=>env.db.close());const id=crypto.randomUUID(),at=new Date().toISOString();
 env.db.prepare('INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').run('rider:stop-test','Rider','+966500000024','stop@example.test',at,at);
 env.db.prepare('INSERT INTO trips(id,rider_id,driver_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'rider:stop-test',captain,status,JSON.stringify({name:'Pickup',lat:24.7,lng:46.6}),JSON.stringify({name:'Final',lat:24.76,lng:46.66}),3500,1000,'cash_due',0,at,at);
 env.db.prepare('INSERT INTO trip_options(trip_id,stops_json,guest_name,business_note) VALUES(?,?,?,?)').run(id,JSON.stringify(stops.slice(0,number)),'','');
 return {env,id,record:()=>env.db.prepare('SELECT status,fare_halalas,payment_status FROM trips WHERE id=?').get(id)};
}
test('RDEV-005 progress is bound to assigned captain and exact booked stop count',async t=>{
 const f=setup(t);await assert.rejects(captainStopAction(f.env,'other',{tripId:f.id,stopIndex:0,phase:'arrived'}),{code:'STOP_FORBIDDEN'});
 for(const input of [{stopIndex:2,phase:'arrived'},{stopIndex:'0',phase:'arrived'},{stopIndex:0,phase:'skip'}])await assert.rejects(captainStopAction(f.env,captain,{tripId:f.id,...input}),{code:'STOP_INVALID'});
 assert.equal(f.env.db.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE action LIKE 'trip_stop_%'").get().n,0);
});
test('RDEV-005 arrival then departure at each stop is ordered, idempotent and never reprices',async t=>{
 const f=setup(t),before=f.record();
 await assert.rejects(captainStopAction(f.env,captain,{tripId:f.id,stopIndex:0,phase:'departed'}),{code:'STOP_SEQUENCE_CONFLICT'});
 await assert.rejects(captainStopAction(f.env,captain,{tripId:f.id,stopIndex:1,phase:'arrived'}),{code:'STOP_SEQUENCE_CONFLICT'});
 const arrived=await captainStopAction(f.env,captain,{tripId:f.id,stopIndex:0,phase:'arrived'});assert.equal(arrived.stopProgress.stops[0].status,'arrived');
 assert.equal((await captainStopAction(f.env,captain,{tripId:f.id,stopIndex:0,phase:'arrived'})).idempotent,true);
 const departed=await captainStopAction(f.env,captain,{tripId:f.id,stopIndex:0,phase:'departed'});assert.equal(departed.stopProgress.stops[0].status,'departed');
 await captainStopAction(f.env,captain,{tripId:f.id,stopIndex:1,phase:'arrived'});
 const last=await captainStopAction(f.env,captain,{tripId:f.id,stopIndex:1,phase:'departed'});
 assert.equal(last.stopProgress.allDeparted,true);assert.equal(last.stopProgress.nextIndex,null);
 assert.deepEqual(f.record(),before);assert.equal(f.env.db.prepare("SELECT COUNT(*) AS n FROM wallet_entries").get().n,0);
 assert.equal(f.env.db.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE action LIKE 'trip_stop_%'").get().n,4);
});
test('RDEV-005 no progress edits on completed trips; read returns truthful state',async t=>{
 const f=setup(t,1,'completed');await assert.rejects(captainStopAction(f.env,captain,{tripId:f.id,stopIndex:0,phase:'arrived'}),{code:'STOP_TRIP_CHANGED'});
 const result=await tripStopProgress(f.env,{id:f.id,stops_json:JSON.stringify(stops.slice(0,1))});assert.equal(result.stops[0].status,'pending');
 assert.equal(stopSnapshot({id:f.id,options:{stops:[]}},[]),null);
});
