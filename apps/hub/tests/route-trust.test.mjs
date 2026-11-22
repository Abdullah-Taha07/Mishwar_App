import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {drivingRoute} from '../worker/routing.js';
import {commercialRoad} from '../worker/commercial-maps.js';
import {handleLiveRider} from '../worker/commerce.js';
const a={name:'Local pickup',lat:24.7,lng:46.6},z={name:'Local destination',lat:24.71,lng:46.61};
const key='osrm:https://router.project-osrm.org:46.60000,24.70000,46.61000,24.71000';
const oldFetch=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=oldFetch});
const quote=env=>handleLiveRider(new Request('https://local.test/internal/live-rider',{method:'POST',headers:{'x-mishwar-key':'test-rider-key'},body:JSON.stringify({action:'live_quote',pickup:a,destination:z,sessionToken:env.verifiedToken('route-owner')})}),env);
test('corrupt route cache is ignored and replaced by validated provider road data',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({code:'Ok',routes:[{distance:2400,duration:480,geometry:{type:'LineString',coordinates:[[46.6,24.7],[46.61,24.71]]}}]})};
 for(const malformed of ['not-json',JSON.stringify({distanceMeters:-1,durationSeconds:480}),JSON.stringify({distanceMeters:1,durationSeconds:1,geometry:{type:'LineString',coordinates:[[500,24],[46,24]]}})]){
  env.db.prepare('INSERT OR REPLACE INTO road_route_cache VALUES(?,?,?)').run(key,malformed,new Date(Date.now()+300000).toISOString());
  const route=await drivingRoute(env,a,z);assert.equal(route.distanceMeters,2400);
 }
 assert.equal(calls,3);
});
test('malformed provider routes and stale cached routes cannot create a fare quote',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());
 globalThis.fetch=async()=>Response.json({code:'Ok',routes:[{distance:0,duration:0}]});
 const bad=await quote(env);assert.equal(bad.status,400);assert.equal(env.db.prepare('SELECT count(*) AS n FROM ride_quotes').get().n,0);
 env.db.prepare('INSERT OR REPLACE INTO road_route_cache VALUES(?,?,?)').run(key,JSON.stringify({distanceMeters:2400,durationSeconds:480,provider:'OSRM',demoProvider:true}),new Date(Date.now()-60000).toISOString());
 globalThis.fetch=async()=>{throw Error('provider unavailable')};
 assert.equal((await quote(env)).status,400);assert.equal(env.db.prepare('SELECT count(*) AS n FROM ride_quotes').get().n,0);
});
test('public routing stays a disclosed estimate until explicit pilot approval or a configured provider',async t=>{
 const env=makeEnv();t.after(()=>env.db.close());delete env.ALLOW_PUBLIC_ROUTE_QUOTES;
 globalThis.fetch=async()=>Response.json({code:'Ok',routes:[{distance:2400,duration:480}]});
 assert.equal((await quote(env)).status,400);assert.equal(env.db.prepare('SELECT count(*) AS n FROM ride_quotes').get().n,0);
 env.ALLOW_PUBLIC_ROUTE_QUOTES='true';assert.equal((await quote(env)).status,200);
});
test('commercial provider rejects negative metrics and invalid geometry without exposing a credential',async()=>{
 for(const route of [{summary:{lengthInMeters:-1,travelTimeInSeconds:60}},{summary:{lengthInMeters:2400,travelTimeInSeconds:-2}},{summary:{lengthInMeters:2400,travelTimeInSeconds:480},legs:[{points:[{latitude:24,longitude:46},{latitude:95,longitude:46}]}]}]){
  globalThis.fetch=async()=>Response.json({routes:[route]});await assert.rejects(commercialRoad({TOMTOM_API_KEY:'local-only-fixture'},[a,z]));
 }
});
