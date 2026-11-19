import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedRoadJson } from '../worker/road-data.js';
import { commercialRoad, commercialPlaces } from '../worker/commercial-maps.js';

const points = [{ lat: 24.7136, lng: 46.6753 }, { lat: 24.7674, lng: 46.6434 }];

test('TomTom route uses Cloudflare-compatible manual redirect mode', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(init.redirect, 'manual');
      assert.match(String(url), /^https:\/\/api\.tomtom\.com\/routing\/1\/calculateRoute\//);
      return Response.json({ routes: [{ summary: { lengthInMeters: 8350, travelTimeInSeconds: 615 }, legs: [{ points: [{ longitude: 46.6753, latitude: 24.7136 }, { longitude: 46.6434, latitude: 24.7674 }] }] }] });
    };
    const route = await commercialRoad({ TOMTOM_API_KEY: 'test-not-real-secret' }, points);
    assert.equal(route.provider, 'TomTom');
    assert.equal(route.distanceMeters, 8350);
    assert.equal(route.durationSeconds, 615);
    assert.equal(route.trafficAware, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('Routing rejects HTTP redirects without following them', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      assert.equal(init.redirect, 'manual');
      return Response.redirect('https://untrusted.example/route', 302);
    };
    await assert.rejects(boundedRoadJson('https://api.tomtom.com/route', {}, 2000), /تعذر جلب مسار/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('TomTom place lookup uses manual redirect and rejects 3xx', async () => {
  const original = globalThis.fetch;
  const env = {
    TOMTOM_ENABLED: 'true',
    TOMTOM_API_KEY: 'test-not-real-secret',
    RIDER_SERVICE_KEY: 'test-internal-service-key',
    DB: { prepare() { return { bind() { return this; }, async first() { return { n: 1 }; } }; } }
  };
  const request = () => new Request('https://hub.example/internal/places/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mishwar-key': env.RIDER_SERVICE_KEY },
    body: JSON.stringify({ lat: 24.7136, lon: 46.6753, q: 'Riyadh', clientIp: '198.51.100.1' })
  });
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(init.redirect, 'manual');
      assert.match(String(url), /^https:\/\/api\.tomtom\.com\/search\/2\/search\//);
      return Response.json({ results: [] });
    };
    const ok = await commercialPlaces(request(), env);
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).features, []);
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.redirect, 'manual');
      return Response.redirect('https://untrusted.example/places', 302);
    };
    const refused = await commercialPlaces(request(), env);
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /تعذر البحث/);
  } finally {
    globalThis.fetch = original;
  }
});
