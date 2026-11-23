import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {eligibleCaptains,dispatchTrip} from '../worker/dispatch.js';

const good='11111111-1111-4111-8111-111111111111';
function drivers(t){
  const env=makeEnv(true);t.after(()=>env.db.close());
  const at=new Date().toISOString();
  env.db.prepare("UPDATE captain_applications SET status='active' WHERE id=?").run(good);
  env.db.prepare('INSERT INTO captain_presence VALUES(?,?,?,?,?,?,?)').run(good,1,at,24.72,46.62,5,at);
  env.db.prepare("INSERT INTO captain_applications SELECT 'corrupted-driver','corrupted-user','+966500000099','corrupt@example.test',personal_json,vehicle_json,documents_json,'active',submitted_at,reviewed_at FROM captain_applications WHERE id=?").run(good);
  env.db.prepare('INSERT INTO captain_presence VALUES(?,?,?,?,?,?,?)').run('corrupted-driver',1,at,24.721,46.62,5,at);
  env.db.prepare('UPDATE captain_applications SET vehicle_json=? WHERE id=?').run('{not valid json','corrupted-driver');
  return env;
}
test('a malformed captain vehicle record is safely excluded without breaking dispatch for valid captains',async t=>{
  const env=drivers(t),pickup={lat:24.721,lng:46.62};
  const candidates=await eligibleCaptains(env,pickup,'economy','test-trip');
  assert.deepEqual(candidates.map(c=>c.id),[good]);
});
test('an invalid existing offer does not stop reassigning to a valid captain',async t=>{
  const env=drivers(t),at=new Date().toISOString(),pickup={lat:24.721,lng:46.62};
  env.db.prepare('INSERT INTO riders(id,name,phone,email,created_at,last_seen) VALUES(?,?,?,?,?,?)').run('rider:corrupt','Test Rider','','',at,at);
  env.db.prepare('INSERT INTO ride_quotes(id,rider_id,pickup_json,destination_json,category,fare_halalas,discount_halalas,coupon,commission_bps,expires_at,route_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('quote:corrupt','rider:corrupt',JSON.stringify(pickup),JSON.stringify({lat:24.73,lng:46.63}),'economy',1500,0,null,0,new Date(Date.now()+60000).toISOString(),null);
  env.db.prepare("INSERT INTO trips(id,rider_id,driver_id,status,pickup_json,destination_json,fare_halalas,commission_bps,payment_status,is_demo,created_at,updated_at) VALUES(?,?,NULL,'matching',?,?,?,?,?,0,?,?)").run('trip:corrupt','rider:corrupt',JSON.stringify(pickup),JSON.stringify({lat:24.73,lng:46.63}),1500,0,'cash_due',at,at);
  env.db.prepare('INSERT INTO trip_commerce(trip_id,quote_id,method,discount_halalas,cash_due_halalas,coupon) VALUES(?,?,?,?,?,?)').run('trip:corrupt','quote:corrupt','cash',0,1500,null);
  env.db.prepare('INSERT INTO dispatch_offers(trip_id,captain_id,offered_at,expires_at) VALUES(?,?,?,?)').run('trip:corrupt','corrupted-driver',at,new Date(Date.now()+60000).toISOString());
  await dispatchTrip(env,'trip:corrupt');
  assert.equal(env.db.prepare('SELECT captain_id FROM dispatch_offers WHERE trip_id=?').get('trip:corrupt')?.captain_id,good);
});
