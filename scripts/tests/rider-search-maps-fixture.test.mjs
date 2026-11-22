import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createSearchMapsProvider, MAP_PLACES, MAP_QUERIES} from '../fixtures/rider-search-maps-provider.mjs';

function call(provider, operation, path, signal) {
  const url = new URL('https://api.tomtom.com' + path);
  url.searchParams.set('key', 'offline-journey-tomtom-only');
  if (operation === 'route') {url.searchParams.set('traffic', 'true'); url.searchParams.set('travelMode', 'car');}
  const request = new Request(url, {signal});
  return provider.fetch({request, url, body: null, operation, scenarioId: 'provider-contract'});
}
const searchPath = query => '/search/2/search/' + encodeURIComponent(query) + '.json';
const routePath = '/routing/1/calculateRoute/24.7136,46.6753:24.737,46.705/json';

test('declared Arabic/English street/district/landmark fixtures retain real adapter coordinate order', async () => {
  const provider = createSearchMapsProvider();
  for (const item of MAP_QUERIES) {
    const response = await call(provider, 'search', searchPath(item.query));
    const row = (await response.json()).results[0], expected = MAP_PLACES[item.place];
    assert.deepEqual(row.position, {lat: expected.lat, lon: expected.lng});
  }
  assert.equal(provider.audit.length, 6);
  assert.ok(provider.audit.every(row => row.synthetic));
  assert.equal(JSON.stringify(provider.audit).includes('offline-journey-tomtom-only'), false);
});

test('provider holds an old response while a newer response finishes independently', async () => {
  const provider = createSearchMapsProvider();
  provider.setSearch('held query', {points: [MAP_PLACES.a], mode: 'hold'});
  let oldFinished = false;
  const old = call(provider, 'search', searchPath('held query')).then(value => {oldFinished = true; return value;});
  assert.equal(provider.held.length, 1);
  const fresh = await call(provider, 'search', searchPath('King Fixture Road'));
  assert.equal(fresh.ok, true); assert.equal(oldFinished, false);
  provider.releaseHeld('search');
  assert.equal((await (await old).json()).results[0].position.lon, MAP_PLACES.a.lng);
});

test('synthetic provider distinguishes HTTP failure, connection loss, timeout abort and wrong geometry', async () => {
  const provider = createSearchMapsProvider();
  provider.setRouteMode('fail'); assert.equal((await call(provider, 'route', routePath)).status, 503);
  provider.setRouteMode('disconnect'); await assert.rejects(call(provider, 'route', routePath), /Declared local provider connection failure/);
  provider.setRouteMode('timeout'); const controller = new AbortController();
  const pending = call(provider, 'route', routePath, controller.signal); controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  provider.setRouteMode('wrong-route');
  const wrong = await (await call(provider, 'route', routePath)).json();
  assert.ok(Math.abs(wrong.routes[0].legs[0].points[0].latitude - 24.7136) > .1);
});

test('provider rejects nonfixture keys, origins, methods and operations before any native network call', async () => {
  const provider = createSearchMapsProvider();
  const invoke = (raw, options = {}, operation = 'search') => {
    const url = new URL(raw), request = new Request(url, options);
    return provider.fetch({request, url, body: null, operation, scenarioId: 'denied'});
  };
  await assert.rejects(invoke('https://api.tomtom.com/search/2/search/x.json?key=other'));
  await assert.rejects(invoke('https://other.offline.test/search?key=offline-journey-tomtom-only'));
  await assert.rejects(invoke('https://api.tomtom.com/search/2/search/x.json?key=offline-journey-tomtom-only', {method: 'POST'}));
  await assert.rejects(invoke('https://api.tomtom.com/unsupported?key=offline-journey-tomtom-only', {}, 'unknown'));
});
