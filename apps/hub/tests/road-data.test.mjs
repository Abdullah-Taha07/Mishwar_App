import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedRouteSnapshot,assertPriceableRoute,boundedRoadJson} from '../worker/road-data.js';
const good=()=>({distanceMeters:2400,durationSeconds:480,geometry:{type:'LineString',coordinates:[[46.6,24.7],[46.61,24.71]]},provider:'OSRM'});
test('invalid metrics or malformed road geometry cannot be accepted as a trusted snapshot',()=>{
 for(const invalid of [{distanceMeters:0},{durationSeconds:0},{distanceMeters:-1},{durationSeconds:Infinity},{distanceMeters:NaN},{geometry:{type:'Point',coordinates:[46.6,24.7]}},{geometry:{type:'LineString',coordinates:[[46.6,24.7],[Infinity,24.7]]}},{geometry:{type:'LineString',coordinates:[[46.6,24.7]]}}])assert.throws(()=>checkedRouteSnapshot({...good(),...invalid}));
 assert.deepEqual(checkedRouteSnapshot(good()),good());
});

test('MAIN audit: a traffic delay cannot exceed the whole driving duration',()=>{
 for(const trafficDelaySeconds of [-1,NaN,Infinity,481])assert.throws(()=>checkedRouteSnapshot({...good(),trafficDelaySeconds}));
 for(const trafficDelaySeconds of [0,120,480])assert.equal(checkedRouteSnapshot({...good(),trafficDelaySeconds}).trafficDelaySeconds,trafficDelaySeconds);
});
test('stale road data is never priceable, public demo quotes require explicit pilot approval',()=>{
 assert.throws(()=>assertPriceableRoute({}, {...good(),stale:true}));
 assert.throws(()=>assertPriceableRoute({}, {...good(),demoProvider:true}));
 assert.ok(assertPriceableRoute({ALLOW_PUBLIC_ROUTE_QUOTES:'true'},{...good(),demoProvider:true}));
 assert.ok(assertPriceableRoute({OSRM_BASE_URL:'https://routing.example.test'},good()));
 assert.throws(()=>assertPriceableRoute({},good()),'absence of a demo flag does not prove a commercial provider');
 assert.throws(()=>assertPriceableRoute({ALLOW_PUBLIC_ROUTE_QUOTES:'true'},{...good(),provider:'unknown'}));
});
test('provider deadlines include fetch and JSON, even if the transport ignores abort',async()=>{
 const old=globalThis.fetch;try{
  for(const fake of [()=>new Promise(()=>{}),async()=>({ok:true,json:()=>new Promise(()=>{})})]){globalThis.fetch=fake;await assert.rejects(boundedRoadJson('https://route.local.test',{},10),{name:'TimeoutError'})}
  globalThis.fetch=async()=>{throw Error('private native transport details')};await assert.rejects(boundedRoadJson('https://route.local.test',{},10),error=>!error.message.includes('private'));
 }finally{globalThis.fetch=old}
});
