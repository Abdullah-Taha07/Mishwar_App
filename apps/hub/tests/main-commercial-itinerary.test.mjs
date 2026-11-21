import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialRoad} from '../worker/commercial-maps.js';

const a={lat:24.7,lng:46.6},b={lat:24.71,lng:46.61},stop={lat:24.705,lng:46.605};
const env={TOMTOM_API_KEY:'main-audit-synthetic-route-only'};
const original=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=original});
const leg=(start,end)=>({points:[{latitude:start.lat,longitude:start.lng},{latitude:end.lat,longitude:end.lng}]});
function provide(legs){globalThis.fetch=async()=>Response.json({routes:[{summary:{lengthInMeters:2400,travelTimeInSeconds:480,trafficDelayInSeconds:30},legs}]})}

test('MAIN audit: commercial route retains the actual requested itinerary geometry and traffic facts',async()=>{
 provide([leg(a,stop),leg(stop,b)]);const road=await commercialRoad(env,[a,stop,b]);
 assert.equal(road.distanceMeters,2400);assert.equal(road.durationSeconds,480);assert.equal(road.trafficDelaySeconds,30);
 assert.deepEqual(road.geometry.coordinates,[[a.lng,a.lat],[stop.lng,stop.lat],[stop.lng,stop.lat],[b.lng,b.lat]]);
});

test('MAIN audit: commercial route cannot omit or invent an itinerary leg',async()=>{
 provide([leg(a,b)]);await assert.rejects(commercialRoad(env,[a,stop,b]));
 provide([leg(a,stop),leg(stop,b)]);await assert.rejects(commercialRoad(env,[a,b]));
});

test('MAIN audit: a valid route in another city cannot substitute for the requested pickup or destination',async()=>{
 for(const legs of [[leg({lat:21,lng:39},b)],[leg(a,{lat:21,lng:39})],[leg({lat:21,lng:39},{lat:21.01,lng:39.01})]]){
  provide(legs);await assert.rejects(commercialRoad(env,[a,b]));
 }
});

test('MAIN audit: intermediate stops must be represented at their requested position',async()=>{
 const wrong={lat:24.9,lng:46.8};provide([leg(a,wrong),leg(wrong,b)]);
 await assert.rejects(commercialRoad(env,[a,stop,b]));
});

test('MAIN audit: disconnected legs cannot create a fabricated connector between valid nearby points',async()=>{
 provide([leg(a,stop),leg({...stop,lat:stop.lat+.005},b)]);
 await assert.rejects(commercialRoad(env,[a,stop,b]));
});

test('MAIN audit: existing two-kilometre snapping allowance still accepts near-road endpoints',async()=>{
 const snappedA={...a,lat:a.lat+.003},snappedB={...b,lng:b.lng+.003};
 provide([leg(snappedA,snappedB)]);assert.equal((await commercialRoad(env,[a,b])).distanceMeters,2400);
});

test('MAIN audit: malformed endpoint coordinates fail without exposing route credentials',async()=>{
 provide([{points:[{latitude:a.lat,longitude:a.lng},{latitude:95,longitude:b.lng}]}]);
 await assert.rejects(commercialRoad(env,[a,b]),error=>!error.message.includes(env.TOMTOM_API_KEY));
});
