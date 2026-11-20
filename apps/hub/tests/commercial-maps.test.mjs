import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialPlaces, commercialRoad} from '../worker/commercial-maps.js';
import {drivingItinerary} from '../worker/routing.js';
import {assertPriceableRoute, boundedRoadJson} from '../worker/road-data.js';
import {makeEnv} from './fixtures.mjs';

const a = {lat: 24.7, lng: 46.6}, z = {lat: 24.71, lng: 46.61};
const PRIVATE_KEY = 'synthetic-server-only-tomtom-key';
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const placeEnv = (extra = {}) => ({
  TOMTOM_ENABLED: 'true', TOMTOM_API_KEY: PRIVATE_KEY, RIDER_SERVICE_KEY: 'synthetic-rider-service-key',
  DB: {prepare() { return {bind() { return this; }, first: async () => ({n: 1})}; }}, ...extra,
});
function request(path = 'search', body = {}, key = 'synthetic-rider-service-key') {
  return new Request('https://local.test/internal/places/' + path, {method: 'POST', headers: {'x-mishwar-key': key},
    body: JSON.stringify({lat: '24.7', lon: '46.6', q: 'Local test place', clientIp: '192.0.2.1', ...body})});
}
const providerRoute = (extra = {}) => ({summary: {lengthInMeters: 2400, travelTimeInSeconds: 480, trafficDelayInSeconds: 30},
  legs: [{points: [{latitude: a.lat, longitude: a.lng}, {latitude: z.lat, longitude: z.lng}]}], ...extra});

test('places configuration exposes only the explicitly public map key and identifies the search provider', async () => {
  globalThis.fetch = () => { throw Error('CONFIG_MUST_NOT_CALL_PROVIDER'); };
  const result = await commercialPlaces(request('config'), placeEnv({TOMTOM_MAPS_BROWSER_KEY: 'synthetic-browser-key'}));
  const body = await result.json(); assert.equal(result.status, 200); assert.equal(body.browserKey, 'synthetic-browser-key');
  assert.equal(body.searchConfigured, true); assert.equal(body.searchProvider, 'TomTom'); assert.equal(JSON.stringify(body).includes(PRIVATE_KEY), false);
  const disabled = await (await commercialPlaces(request('config'), placeEnv({TOMTOM_ENABLED: 'false'}))).json();
  assert.equal(disabled.searchConfigured, false); assert.equal(disabled.searchProvider, 'Photon');
});
test('place authentication, disabled service and exhausted rate limit stop before a provider request', async () => {
  let calls = 0; globalThis.fetch = () => { calls++; throw Error('UNEXPECTED_PROVIDER'); };
  assert.equal((await commercialPlaces(request('search', {}, 'wrong'), placeEnv())).status, 403);
  assert.equal((await commercialPlaces(request(), placeEnv({TOMTOM_API_KEY: '   '}))).status, 503);
  assert.equal((await commercialPlaces(request(), placeEnv({DB: {prepare() { return {bind() { return this; }, first: async () => ({n: 51})}; }}}))).status, 429);
  assert.equal(calls, 0);
});
test('place input accepts ordinary URL coordinate strings but rejects coercible arrays, booleans and missing values', async () => {
  let calls = 0;
  globalThis.fetch = async url => { calls++; const u = new URL(url); assert.equal(u.searchParams.get('lat'), '24.7'); assert.equal(u.searchParams.get('lon'), '46.6'); return Response.json({results: []}); };
  assert.equal((await commercialPlaces(request(), placeEnv())).status, 200);
  for (const lat of [[24.7], true, null, '', ' ', '0x18.b', '24.7junk', 'Infinity']) assert.equal((await commercialPlaces(request('search', {lat}), placeEnv())).status, 400);
  assert.equal((await commercialPlaces(request('search', {q: {toString: 'bad'}}), placeEnv())).status, 400);
  assert.equal(calls, 1);
});
test('search normalizes only real finite positions, never inventing a POI at the search centre', async () => {
  globalThis.fetch = async () => Response.json({results: [
    {poi: {name: 'Valid place'}, position: {lat: 24.72, lon: 46.63}, address: {municipality: 'Riyadh'}},
    {poi: {name: 'Missing position'}}, {position: null}, {position: {lat: null, lon: 46.6}},
    {position: {lat: '24.7', lon: 46.6}}, {position: {lat: 91, lon: 46.6}}, {position: {lat: 24.7, lon: Infinity}},
  ]});
  const body = await (await commercialPlaces(request(), placeEnv())).json();
  assert.equal(body.provider, 'TomTom'); assert.equal(body.features.length, 1);
  assert.deepEqual(body.features[0].geometry.coordinates, [46.63, 24.72]); assert.equal(body.features[0].properties.name, 'Valid place');
});
test('reverse geocoding parses TomTom latitude-longitude strings without substituting query coordinates', async () => {
  globalThis.fetch = async () => Response.json({addresses: [
    {position: '24.721,46.631', address: {freeformAddress: 'Local reverse result'}},
    ...[undefined, null, '', ' ', '24.7', '24.7,', ',46.6', 'null,46.6', 'NaN,46.6', '91,46.6', '24.7,181', [24.7, 46.6]].map(position => ({position, address: {freeformAddress: 'Invalid result'}})),
  ]});
  const body = await (await commercialPlaces(request('reverse'), placeEnv())).json();
  assert.equal(body.features.length, 1); assert.deepEqual(body.features[0].geometry.coordinates, [46.631, 24.721]);
});
test('place query is encoded in the path and cannot override private credentials or fixed provider parameters', async () => {
  const query = 'مكان /?key=forged&countrySet=XX#fragment';
  globalThis.fetch = async (url, init) => {
    const u = new URL(url); assert.equal(u.origin, 'https://api.tomtom.com');
    assert.equal(decodeURIComponent(u.pathname.split('/').at(-1).slice(0, -5)), query);
    assert.equal(u.searchParams.get('key'), PRIVATE_KEY); assert.equal(u.searchParams.getAll('key').length, 1);
    assert.equal(u.searchParams.get('countrySet'), 'SA'); assert.equal(init.redirect, 'manual'); return Response.json({results: []});
  };
  assert.equal((await commercialPlaces(request('search', {q: query, key: 'forged', countrySet: 'XX'}), placeEnv())).status, 200);
});
test('raw provider, SQL and JSON errors cannot expose a URL or private server key through places', async () => {
  const detail = 'تعذر provider https://api.tomtom.com/private?key=' + PRIVATE_KEY;
  for (const fake of [async () => { throw Error(detail); }, async () => ({ok: true, json: async () => { throw Error(detail); }}), async () => Response.json({error: detail})]) {
    globalThis.fetch = fake;
    const response = await commercialPlaces(request(), placeEnv()), body = await response.text();
    assert.equal(response.status, 400); assert.match(body, /تعذر البحث/); assert.equal(body.includes(PRIVATE_KEY), false); assert.equal(body.includes('https:'), false);
  }
  const response = await commercialPlaces(request(), placeEnv({DB: {prepare() { throw Error(detail); }}}));
  assert.equal((await response.text()).includes(PRIVATE_KEY), false);
});
test('places deadline covers both fetch and JSON even if the provider ignores abort', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const phase of ['fetch', 'json']) {
    let started; const ready = new Promise(resolve => { started = resolve; });
    globalThis.fetch = phase === 'fetch' ? () => { started(); return new Promise(() => {}); } : async () => ({ok: true, json() { started(); return new Promise(() => {}); }});
    const operation = commercialPlaces(request(), placeEnv()); await ready; t.mock.timers.tick(8001);
    const response = await operation; assert.equal(response.status, 504); assert.match((await response.json()).error, /انتهت مهلة البحث/);
  }
});
test('required commercial routing fails closed before any fallback for disabled or incomplete configuration', async () => {
  let calls = 0; globalThis.fetch = () => { calls++; throw Error('UNEXPECTED_FALLBACK'); };
  for (const env of [{}, {TOMTOM_ENABLED: 'false', TOMTOM_API_KEY: PRIVATE_KEY}, {TOMTOM_ENABLED: 'true'}, {TOMTOM_ENABLED: 'true', TOMTOM_API_KEY: '  '}]) {
    await assert.rejects(drivingItinerary({...env, REQUIRE_COMMERCIAL_ROUTES: 'true'}, a, z), /بانتظار التفعيل/);
  }
  assert.equal(calls, 0);
});
test('required commercial routing never falls back after a provider failure and rejects noncommercial quotes', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('تعذر ' + PRIVATE_KEY); };
  await assert.rejects(drivingItinerary({TOMTOM_ENABLED: 'true', TOMTOM_API_KEY: PRIVATE_KEY, REQUIRE_COMMERCIAL_ROUTES: 'true'}, a, z), error => !error.message.includes(PRIVATE_KEY));
  assert.equal(calls, 1);
  assert.throws(() => assertPriceableRoute({REQUIRE_COMMERCIAL_ROUTES: 'true', OSRM_BASE_URL: 'https://local.test'}, {distanceMeters: 2400, durationSeconds: 480, provider: 'OSRM'}), /تجاري/);
});
test('optional commercial routing keeps disclosed nontraffic OSRM fallback when configured', async t => {
  const env = makeEnv(); t.after(() => env.db.close()); Object.assign(env, {TOMTOM_ENABLED: 'true', TOMTOM_API_KEY: PRIVATE_KEY, OSRM_BASE_URL: 'https://route.local.test'});
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(new URL(url).host);
    if (new URL(url).host === 'api.tomtom.com') throw Error('synthetic provider outage');
    return Response.json({code: 'Ok', routes: [{distance: 2400, duration: 480, geometry: {type: 'LineString', coordinates: [[46.6, 24.7], [46.61, 24.71]]}}]});
  };
  const route = await drivingItinerary(env, a, z); assert.deepEqual(calls, ['api.tomtom.com', 'route.local.test']);
  assert.equal(route.provider, 'OSRM'); assert.equal(route.trafficAware, false); assert.equal(route.demoProvider, false);
});
test('commercial routes preserve requested traffic and reject malformed metrics, geometry and delays', async () => {
  let calls = 0; globalThis.fetch = async url => { calls++; const query = new URL(url).searchParams; assert.equal(query.get('traffic'), 'true'); assert.equal(query.get('departAt'), 'now'); return Response.json({routes: [providerRoute()]}); };
  const route = await commercialRoad({TOMTOM_API_KEY: PRIVATE_KEY}, [a, z]);
  assert.equal(route.distanceMeters, 2400); assert.equal(route.durationSeconds, 480); assert.equal(route.trafficDelaySeconds, 30); assert.equal(route.trafficAware, true);
  for (const points of [[{...a, lat: NaN}, z], [a, {...z, lng: 181}], [a]]) await assert.rejects(commercialRoad({TOMTOM_API_KEY: PRIVATE_KEY}, points));
  assert.equal(calls, 1, 'invalid input must not consume a provider request');
  for (const bad of [
    ...[NaN, Infinity, -1, 0].map(lengthInMeters => providerRoute({summary: {lengthInMeters, travelTimeInSeconds: 480}})),
    ...[NaN, Infinity, -1, 0].map(travelTimeInSeconds => providerRoute({summary: {lengthInMeters: 2400, travelTimeInSeconds}})),
    ...[null, -1, Infinity, '30'].map(trafficDelayInSeconds => providerRoute({summary: {lengthInMeters: 2400, travelTimeInSeconds: 480, trafficDelayInSeconds}})),
    providerRoute({legs: []}), providerRoute({legs: [{points: [{latitude: 24.7, longitude: 46.6}]}]}),
    providerRoute({legs: [{points: [{latitude: 24.7, longitude: 46.6}, {latitude: 91, longitude: 46.6}]}]}),
  ]) { globalThis.fetch = async () => Response.json({routes: [bad]}); await assert.rejects(commercialRoad({TOMTOM_API_KEY: PRIVATE_KEY}, [a, z])); }
});
test('road JSON sanitizer rejects private details even in Arabic or forged native timeout errors', async () => {
  for (const error of [Error('تعذر https://api.tomtom.com/?key=' + PRIVATE_KEY), Object.assign(Error('private ' + PRIVATE_KEY), {name: 'TimeoutError'})]) {
    globalThis.fetch = async () => { throw error; };
    await assert.rejects(boundedRoadJson('https://route.local.test', {}, 30), result => !result.message.includes(PRIVATE_KEY) && !result.message.includes('https:'));
  }
});
