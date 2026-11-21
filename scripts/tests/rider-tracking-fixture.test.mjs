import test from 'node:test';
import assert from 'node:assert/strict';
import {startTrackingServer} from '../fixtures/rider-tracking-server.mjs';

test('RDEV-003 isolated gateways/auth/SQLite captain GPS and road ETA lifecycle',async t=>{
  const transport=globalThis.fetch,lab=await startTrackingServer({publicRoot:'apps/rider/public'});
  let cookie='',tripId,pin;
  const request=async(path,body,authenticated=true)=>{
    const r=await transport(lab.origin+path,{method:'POST',headers:{Origin:lab.origin,'Content-Type':'application/json',...(authenticated&&cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  const live=()=>request('/api/live',{action:'live_session',...(tripId?{tripId}:{})});
  try{
    const f=await lab.resetFixture({returning:true,scenarioId:'tracking-gateway-acceptance'});
    await t.test('real login, quote, booking and assigned captain acceptance',async()=>{
      const login=await request('/api/auth/password-login',{phone:f.credentials.phone,password:f.credentials.password});assert.equal(login.status,200);cookie=login.cookie;assert.ok(cookie);
      const q=await request('/api/live',{action:'live_quote',pickup:f.places.pickup,destination:f.places.destination,category:'comfort'});assert.equal(q.status,200,JSON.stringify(q.data));
      const b=await request('/api/live',{action:'live_book',quoteId:q.data.id,method:'cash',safetyPin:true});assert.equal(b.status,201,JSON.stringify(b.data));tripId=b.data.trip.id;pin=b.data.trip.startPin;
      await lab.advanceTrip('accept');assert.equal((await live()).data.trip.status,'arriving');
    });
    await t.test('authenticated captain sample produces bounded pickup road ETA',async()=>{
      assert.equal((await lab.gps({lat:24.7127,lng:46.6744})).status,200);lab.invalidateEtaCache();
      const data=(await live()).data.trip;assert.equal(data.driverLocation.fresh,true);assert.equal(data.driverLocation.lat,24.7127);assert.equal(data.eta.status,'available');assert.equal(data.eta.tripId,tripId);assert.equal(data.eta.target,'pickup');assert.equal(data.eta.minutes,4);assert.equal(data.eta.distanceMeters,1000);assert.equal(data.eta.provider,'TomTom');assert.equal(data.eta.trafficDelaySeconds,35);assert.ok(Date.parse(data.eta.expiresAt)<=Date.parse(data.eta.locationAt)+30000);
    });
    await t.test('bad GPS, another assignment and unauthenticated read cannot expose tracking',async()=>{
      const before=(await live()).data.trip.driverLocation;
      assert.equal((await lab.gps({lat:24.711,lng:46.673},{accuracy:151})).status,400);
      assert.equal((await lab.gps({lat:24.711,lng:46.673},{observedAt:new Date(Date.now()-60000).toISOString()})).status,400);
      assert.equal((await lab.gps({lat:24.711,lng:46.673},{tripId:'00000000-0000-4000-8000-000000000099'})).status,403);
      assert.deepEqual((await live()).data.trip.driverLocation,before);
      const denied=await request('/api/live',{action:'live_session',tripId},false);assert.ok(!denied.data.trip);assert.ok(!JSON.stringify(denied.data).includes('driverLocation'));
    });
    await t.test('stale sensor and declared provider failure never fabricate ETA',async()=>{
      lab.ageGpsForFixture();let data=(await live()).data.trip;assert.equal(data.driverLocation.fresh,false);assert.equal(data.eta.status,'unavailable');
      lab.controls.routeMode='failure';lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.7128,lng:46.6745})).status,200);data=(await live()).data.trip;assert.equal(data.eta.status,'unavailable');assert.equal(data.eta.durationSeconds,undefined);
      lab.controls.routeMode='ready';lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.7129,lng:46.6746})).status,200);assert.equal((await live()).data.trip.eta.status,'available');
    });
    await t.test('arrived and riding use correct target without a fake zero ETA',async()=>{
      await lab.advanceTrip('arrived');let data=(await live()).data.trip;assert.equal(data.eta.status,'arrived');assert.equal(data.eta.durationSeconds,undefined);
      pin=data.startPin;assert.match(pin,/^\d{4}$/);await lab.advanceTrip('start',{pin});lab.invalidateEtaCache();assert.equal((await lab.gps({lat:24.714,lng:46.676})).status,200);data=(await live()).data.trip;assert.equal(data.eta.target,'destination');assert.equal(data.eta.minutes,7);assert.equal(data.eta.distanceMeters,2200);
    });
    await t.test('completion stops raw and public tracking while retaining one balanced local trip',async()=>{
      await lab.advanceTrip('complete');const reply=(await live()).data,trip=reply.trip||reply.recentTrip;assert.equal(trip.status,'completed');assert.equal(trip.driverLocation,null);assert.ok(trip.eta==null);assert.ok(!Object.keys(trip).some(k=>/^driver_(lat|lng|accuracy|location_at)$/.test(k)));
      const final=await lab.snapshot();assert.equal(final.tripCount,1);assert.equal(final.counts.settlements,1);assert.equal(final.ledgerTotal,0);assert.equal(final.externalNetworkCalls,0);assert.equal(lab.audit.errors.length,0);assert.equal(lab.audit.externalBlocked.length,0);
    });
  }finally{await lab.close()}
});
