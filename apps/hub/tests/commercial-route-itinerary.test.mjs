import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialRoad} from '../worker/commercial-maps.js';
import {drivingItinerary} from '../worker/routing.js';
import {checkedRouteSnapshot} from '../worker/road-data.js';
import {handleLiveRider} from '../worker/commerce.js';
import {makeEnv} from './fixtures.mjs';

const originalFetch = globalThis.fetch;
const key = 'synthetic-route-itinerary-only';
const pickup = {name: 'Local route start', lat: 24.7, lng: 46.6};
const stop = {name: 'Local route stop', lat: 24.74, lng: 46.69};
const destination = {name: 'Local route end', lat: 24.78, lng: 46.78};
const envConfig = {TOMTOM_ENABLED: 'true', TOMTOM_API_KEY: key, REQUIRE_COMMERCIAL_ROUTES: 'true'};
const providerPoint = point => ({latitude: point.lat, longitude: point.lng});
const route = (points = [pickup, destination], summary = {}) => ({
  summary: {lengthInMeters: 30000, travelTimeInSeconds: 2400, trafficDelayInSeconds: 120, ...summary},
  legs: points.slice(1).map((point, index) => ({points: [providerPoint(points[index]), providerPoint(point)]})),
});

// Only the declared provider boundary is replaced. An unexpected destination
// fails before any transport runs; SQLite and Worker handlers remain real.
function provider(body, observed = []) {
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.tomtom.com');
    assert.equal(parsed.searchParams.get('key'), key);
    assert.equal(options.redirect, 'manual');
    observed.push(parsed);
    return Response.json({routes: [body]});
  };
}
test.afterEach(() => {globalThis.fetch = originalFetch;});

test('RIDER-014 commercial road rejects a finite geometry for another requested origin or destination', async () => {
  for (const points of [
    [{...pickup, lat: pickup.lat + .1}, destination],
    [pickup, {...destination, lng: destination.lng + .1}],
  ]) {
    provider(route(points));
    await assert.rejects(commercialRoad(envConfig, [pickup, destination]));
  }
});

test('RIDER-014 each requested stop requires its own ordered provider leg', async () => {
  provider(route());
  await assert.rejects(commercialRoad(envConfig, [pickup, stop, destination]), 'Missing waypoint leg cannot be accepted');
  const misplaced = route([pickup, {...stop, lat: stop.lat + .1}, destination]);
  provider(misplaced);
  await assert.rejects(commercialRoad(envConfig, [pickup, stop, destination]), 'Another stop is not the requested itinerary');
});

test('RIDER-014 flattening provider legs cannot invent a road segment across disconnected waypoint endpoints', async () => {
  const disconnected = route([pickup, stop, destination]);
  disconnected.legs[1].points[0] = providerPoint({...stop, lng: stop.lng + .005});
  provider(disconnected);
  await assert.rejects(commercialRoad(envConfig, [pickup, stop, destination]));
});

test('RIDER-014 valid road snapping and ordered stops preserve provider geometry and traffic-inclusive duration', async () => {
  const snapped = [pickup, stop, destination].map(point => ({...point, lat: point.lat + .002, lng: point.lng - .001}));
  const body = route(snapped), observed = [];
  provider(body, observed);
  const result = await commercialRoad(envConfig, [pickup, stop, destination]);
  assert.equal(observed.length, 1);
  assert.equal(decodeURIComponent(observed[0].pathname), '/routing/1/calculateRoute/24.7,46.6:24.74,46.69:24.78,46.78/json');
  assert.equal(observed[0].searchParams.get('traffic'), 'true');
  assert.equal(observed[0].searchParams.get('computeTravelTimeFor'), 'all');
  assert.equal(result.distanceMeters, 30000);
  assert.equal(result.durationSeconds, 2400, 'Traffic delay is already included; never add it a second time');
  assert.equal(result.trafficDelaySeconds, 120);
  assert.equal(result.trafficAware, true);
  assert.deepEqual(result.geometry.coordinates, body.legs.flatMap(leg => leg.points.map(point => [point.longitude, point.latitude])));
});

test('RIDER-014 the existing two-kilometre road snapping limit rejects a distant commercial endpoint', async () => {
  provider(route([{...pickup, lat: pickup.lat + .019}, destination]));
  await assert.rejects(commercialRoad(envConfig, [pickup, destination]));
  provider(route([{...pickup, lat: pickup.lat + .017}, destination]));
  assert.equal((await commercialRoad(envConfig, [pickup, destination])).provider, 'TomTom');
});

test('RIDER-014 traffic delay cannot be longer than the entire traffic-inclusive journey', async () => {
  provider(route(undefined, {trafficDelayInSeconds: 2401}));
  await assert.rejects(commercialRoad(envConfig, [pickup, destination]));
  assert.throws(() => checkedRouteSnapshot({distanceMeters: 30000, durationSeconds: 2400, trafficDelaySeconds: 2401}));
  assert.equal(checkedRouteSnapshot({distanceMeters: 30000, durationSeconds: 2400, trafficDelaySeconds: 2400}).trafficDelaySeconds, 2400);
});

test('RIDER-014 a wrong commercial route cannot create a confirmed quote in independent SQLite', async t => {
  const env = makeEnv(); t.after(() => env.db.close()); Object.assign(env, envConfig);
  const token = env.verifiedToken('local-itinerary-owner');
  provider(route([{...pickup, lat: pickup.lat + .1}, destination]));
  const response = await handleLiveRider(new Request('https://local.test/internal/live-rider', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-mishwar-key': env.RIDER_SERVICE_KEY},
    body: JSON.stringify({action: 'live_quote', sessionToken: token, pickup, destination, category: 'economy'}),
  }), env);
  assert.equal(response.status, 400);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM ride_quotes').get().n, 0);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 0);
  assert.equal((await response.text()).includes(key), false);
});

test('RIDER-014 a matching stopped itinerary stores the exact provider metrics and unchanged fare policy', async t => {
  const env = makeEnv(); t.after(() => env.db.close()); Object.assign(env, envConfig);
  const token = env.verifiedToken('local-valid-itinerary-owner');
  provider(route([pickup, stop, destination]));
  const response = await handleLiveRider(new Request('https://local.test/internal/live-rider', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'x-mishwar-key': env.RIDER_SERVICE_KEY},
    body: JSON.stringify({action: 'live_quote', sessionToken: token, pickup, destination, stops: [stop], category: 'economy'}),
  }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.fare, 3400, '3 SAR + 30 road km at 0.90 + 40 traffic-inclusive minutes at 0.10');
  assert.equal(result.route.distanceMeters, 30000);
  assert.equal(result.route.durationSeconds, 2400);
  assert.equal(result.route.trafficDelaySeconds, 120);
  assert.equal(result.route.trafficAware, true);
  const saved = env.db.prepare('SELECT route_json,fare_halalas FROM ride_quotes WHERE id=?').get(result.id);
  const savedRoute = JSON.parse(saved.route_json);
  assert.equal(saved.fare_halalas, result.fare);
  assert.equal(savedRoute.distanceMeters, result.route.distanceMeters);
  assert.equal(savedRoute.durationSeconds, result.route.durationSeconds);
  assert.deepEqual(savedRoute.geometry, result.route.geometry);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 0, 'Pricing a route is not booking a ride');
});

test('RIDER-014 optional commercial route validation failure keeps disclosed nontraffic fallback', async t => {
  const env = makeEnv(); t.after(() => env.db.close());
  Object.assign(env, envConfig, {REQUIRE_COMMERCIAL_ROUTES: 'false', OSRM_BASE_URL: 'https://osrm.local.test'});
  const calls = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url); calls.push(parsed.origin);
    if (parsed.origin === 'https://api.tomtom.com') return Response.json({routes: [route([{...pickup, lat: pickup.lat + .1}, destination])]});
    assert.equal(parsed.origin, 'https://osrm.local.test');
    return Response.json({code: 'Ok', routes: [{distance: 30000, duration: 2400, geometry: {type: 'LineString', coordinates: [[pickup.lng, pickup.lat], [destination.lng, destination.lat]]}}]});
  };
  const result = await drivingItinerary(env, pickup, destination);
  assert.deepEqual(calls, ['https://api.tomtom.com', 'https://osrm.local.test']);
  assert.equal(result.provider, 'OSRM');
  assert.equal(result.trafficAware, false);
  assert.equal(result.durationSeconds, 2400);
});
