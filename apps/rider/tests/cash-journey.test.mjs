import test from 'node:test';
import assert from 'node:assert/strict';
import rider from '../dist/server/index.js';
import hub from '../../hub/dist/server/index.js';
import admin from '../../admin/dist/server/index.js';
import {makeEnv} from '../../hub/tests/fixtures.mjs';

// Local proxy integration, not a deployed/browser acceptance test. SQLite applies
// the real migrations; verified phones, approved documents and a road-provider
// cache entry are explicit fixtures. No SMS, mapping or payment provider is called.
test('local cash journey crosses compiled rider, hub and admin gateways with one persisted settlement', async t => {
  const env = makeEnv(true);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; env.db.close(); });
  const origins = {rider: 'https://rider.local.test', hub: 'https://hub.local.test', admin: 'https://admin.local.test'};
  const riderEnv = {HUB_URL: origins.hub, HUB_SERVICE_KEY: env.RIDER_SERVICE_KEY};
  const adminEnv = {ADMIN_EMAIL: env.CAPTAIN_ADMIN_EMAIL, HUB_URL: origins.hub, HUB_SERVICE_KEY: env.ADMIN_SERVICE_KEY, HUB_ACCESS_TOKEN: 'local-platform-access-fixture'};
  const routed = [];
  let blockedExternalCalls = 0;
  globalThis.fetch = async (input, options) => {
    const request = new Request(input, options);
    const url = new URL(request.url);
    if (url.origin !== origins.hub) {
      blockedExternalCalls++;
      throw Error('External network forbidden in local cash journey');
    }
    routed.push(url.pathname);
    return hub.fetch(request, env, {});
  };
  const request = (origin, path, body, cookie = '', extraHeaders = {}) => new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {origin, 'content-type': 'application/json', cookie, ...extraHeaders},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const asRider = (path, body, cookie = '', headers) => rider.fetch(request(origins.rider, path, body, cookie, headers), riderEnv);
  const asCaptain = (action, body = {}, cookie = '', headers) => hub.fetch(request(origins.hub, '/api/driver', {action, ...body}, cookie, headers), env, {});
  // The compiled admin Worker is a platform-authenticated owner adapter. These
  // identity headers model that trusted platform boundary, not Vercel staff login.
  const asAdmin = (path, headers = {'oai-authenticated-user-id': 'local-owner', 'oai-authenticated-user-email': env.CAPTAIN_ADMIN_EMAIL}) => admin.fetch(request(origins.admin, path, undefined, '', headers), adminEnv);
  const read = async (response, status, step) => {
    assert.equal(response.status, status, step);
    return response.json();
  };
  const sessionCookie = (response, name) => {
    const header = response.headers.get('set-cookie') || '';
    assert.ok(header.includes('HttpOnly') && header.includes('Secure'), 'login issues a secure HTTP-only cookie');
    const cookie = header.split(';', 1)[0];
    assert.ok(cookie.startsWith(name + '='), 'expected role cookie is issued');
    return cookie;
  };

  // Exercise public registration/login proxies, but seed verified phone ownership
  // locally rather than treating a mocked SMS delivery as proof of verification.
  const password = 'local-cash-journey-password';
  await read(await asRider('/api/auth/register', {name: 'Local rider', phone: '0500000011', email: 'rider@local.test', password}), 201, 'rider registration');
  await read(await hub.fetch(request(origins.hub, '/api/auth/register', {name: 'Local captain', phone: '0500000012', email: 'captain@local.test', password}), env, {}), 201, 'captain registration');
  const at = new Date().toISOString();
  env.db.prepare('UPDATE public_accounts SET phone_verified_at=?,verification_method=?').run(at, 'local_test_fixture');
  const riderActor = env.db.prepare("SELECT actor FROM public_accounts WHERE role='rider'").get().actor;
  const captainActor = env.db.prepare("SELECT actor FROM public_accounts WHERE role='captain'").get().actor;
  const captainId = env.db.prepare('SELECT id FROM captain_applications').get().id;
  env.db.prepare("UPDATE captain_applications SET user_id=?,phone=?,status='active'").run(captainActor, '+966500000012');
  env.db.prepare("INSERT INTO platform_settings VALUES('commission_bps','1000',?,'local-test-fixture')").run(at);
  const pickup = {name: 'Local test pickup', area: '', lat: 24.7, lng: 46.6};
  const destination = {name: 'Local test destination', area: '', lat: 24.71, lng: 46.61};
  env.db.prepare('INSERT INTO road_route_cache VALUES(?,?,?)').run(
    'osrm:https://router.project-osrm.org:46.60000,24.70000,46.61000,24.71000',
    JSON.stringify({distanceMeters: 2400, durationSeconds: 480, geometry: {type: 'LineString', coordinates: [[46.6, 24.7], [46.61, 24.71]]}, provider: 'OSRM', trafficAware: false, demoProvider: true}),
    new Date(Date.now() + 600000).toISOString(),
  );
  const riderLogin = await asRider('/api/auth/password-login', {phone: '0500000011', password});
  const riderCookie = sessionCookie(riderLogin, '__Host-mishwar_sid');
  const riderLoginData = await read(riderLogin, 200, 'rider password login');
  assert.equal(riderLoginData.phoneVerified, true);
  assert.equal(Object.hasOwn(riderLoginData, 'sessionToken'), false);
  const captainLogin = await hub.fetch(request(origins.hub, '/api/auth/password-login', {phone: '0500000012', password}), env, {});
  const captainCookie = sessionCookie(captainLogin, '__Host-mishwar_captain');
  const captainLoginData = await read(captainLogin, 200, 'captain password login');
  assert.equal(captainLoginData.phoneVerified, true);
  assert.equal(Object.hasOwn(captainLoginData, 'sessionToken'), false);

  // Identity headers and anonymous requests cannot create/accept/read private trips.
  assert.equal((await asRider('/api/live', {action: 'live_book', actor: riderActor}, '', {'oai-authenticated-user-id': riderActor})).status, 401);
  assert.equal((await asCaptain('accept', {tripId: 'forged-trip'}, '', {'oai-authenticated-user-id': captainActor})).status, 401);
  assert.equal((await asAdmin('/api/admin/operations/trips', {})).status, 403);
  assert.equal((await asAdmin('/api/admin/operations/trips', {'oai-authenticated-user-id': 'visitor', 'oai-authenticated-user-email': 'visitor@local.test'})).status, 403);
  assert.equal((await hub.fetch(request(origins.hub, '/internal/administration/operations/trips', undefined, '', {'x-mishwar-key': 'wrong-fixture-key'}), env, {})).status, 403);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 0);

  await read(await asCaptain('available', {available: true, ...pickup, accuracy: 5}, captainCookie), 200, 'eligible captain goes online');
  const quote = await read(await asRider('/api/live', {action: 'live_quote', pickup, destination, category: 'economy'}, riderCookie), 200, 'rider quote through both gateways');
  assert.ok(quote.id && Number.isSafeInteger(quote.payable) && quote.payable > 0);
  const bookBody = {action: 'live_book', quoteId: quote.id, method: 'cash', arrivalNote: 'Local fixture gate'};
  const booked = await read(await asRider('/api/live', bookBody, riderCookie), 201, 'cash booking persists');
  const tripId = booked.trip.id;
  assert.equal(booked.trip.is_demo, 0, 'the real booking handler is exercised within the local fixture');
  assert.equal(booked.trip.rider_id, 'rider:' + riderActor);
  assert.equal(booked.trip.fare_halalas, quote.payable);
  assert.equal(booked.trip.method, 'cash');
  const offers = await read(await asCaptain('session', {}, captainCookie), 200, 'captain receives dispatch offer');
  assert.equal(offers.requests[0].id, tripId);
  assert.equal(offers.requests[0].rider_phone, undefined, 'offer does not disclose rider phone before acceptance');
  const visible = await read(await asAdmin('/api/admin/operations/trips'), 200, 'admin gateway sees the same persisted booking');
  assert.equal(visible.total, 1);
  assert.equal(visible.items[0].id, tripId);
  assert.equal(visible.items[0].status, 'matching');
  assert.deepEqual(visible.items[0].pickup, pickup);
  assert.deepEqual(visible.items[0].destination, destination);

  // Current contract rejects duplicate attempts while active, rather than creating
  // a second trip or settlement; it does not promise a reusable idempotency key.
  assert.equal((await asRider('/api/live', bookBody, riderCookie)).status, 400);
  await read(await asCaptain('accept', {tripId}, captainCookie), 200, 'captain accepts assigned offer');
  assert.equal((await asCaptain('accept', {tripId}, captainCookie)).status, 409);
  const watch = () => asRider('/api/live', {action: 'live_watch'}, riderCookie);
  const accepted = await read(await watch(), 200, 'rider sees captain acceptance');
  assert.equal(accepted.trip.id, tripId);
  assert.equal(accepted.trip.driver_id, captainId);
  assert.equal(accepted.trip.status, 'arriving');
  assert.equal((await asCaptain('trip_status', {tripId, status: 'completed', cashReceived: true}, captainCookie)).status, 409, 'state transitions cannot be skipped');
  for (const status of ['arrived', 'riding']) {
    await read(await asCaptain('trip_status', {tripId, status}, captainCookie), 200, 'captain transition ' + status);
    const riderState = await read(await watch(), 200, 'rider transition ' + status);
    const adminState = await read(await asAdmin('/api/admin/operations/trips?id=' + tripId), 200, 'admin transition ' + status);
    assert.equal(riderState.trip.status, status);
    assert.equal(adminState.status, status);
  }
  assert.equal((await asCaptain('trip_status', {tripId, status: 'completed'}, captainCookie)).status, 400, 'cash completion requires collection confirmation');
  assert.equal((await read(await watch(), 200, 'missing cash confirmation preserves ride')).trip.status, 'riding');
  await read(await asCaptain('trip_status', {tripId, status: 'completed', cashReceived: true}, captainCookie), 200, 'cash trip completes');
  const finalRider = await read(await asRider('/api/live', {action: 'live_session', tripId}, riderCookie), 200, 'rider final state');
  const finalAdmin = await read(await asAdmin('/api/admin/operations/trips?id=' + tripId), 200, 'admin final state');
  const finalCaptain = await read(await asCaptain('history', {}, captainCookie), 200, 'captain final history');
  assert.equal(finalRider.trip, null);
  for (const trip of [finalRider.recentTrip, finalAdmin, finalCaptain.trips[0]]) {
    assert.equal(trip.id, tripId);
    assert.equal(trip.status, 'completed');
    assert.equal(trip.payment_status, 'cash_collected');
    assert.equal(trip.fare_halalas, quote.payable);
    assert.equal(trip.driver_id, captainId);
  }
  const ledgerBeforeRetry = env.db.prepare('SELECT COUNT(*) AS n FROM wallet_entries').get().n;
  assert.equal((await asCaptain('trip_status', {tripId, status: 'completed', cashReceived: true}, captainCookie)).status, 409);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 1);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM trip_settlements WHERE trip_id=?').get(tripId).n, 1);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM wallet_entries').get().n, ledgerBeforeRetry);
  assert.equal(env.db.prepare('SELECT SUM(amount_halalas) AS total FROM wallet_entries').get().total, 0);
  assert.equal(env.db.prepare('SELECT balance_halalas FROM wallet_accounts WHERE account_id=?').get('captain:' + captainId).balance_halalas, -Math.round(quote.payable / 10));
  assert.ok(routed.includes('/internal/rider-auth') && routed.includes('/internal/live-rider') && routed.includes('/internal/administration/operations/trips'));
  assert.equal(blockedExternalCalls, 0, 'provider cache fixtures avoid even attempted external requests');
});
