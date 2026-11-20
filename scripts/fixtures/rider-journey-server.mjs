import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createServer} from 'node:http';
import {existsSync, readFileSync, realpathSync} from 'node:fs';
import {extname, isAbsolute, join, relative, resolve} from 'node:path';
import {makeEnv} from '../../apps/hub/tests/fixtures.mjs';
import riderGateway from '../../apps/rider/worker/index.js';
import hubWorker from '../../apps/hub/worker/index.js';

// RIDER-013: real source gateways and Worker, migration-backed in-memory SQLite.
// Only provider I/O and the eligible captain/documents are synthetic fixtures.
// This module never assigns browser state, seeds a rider quote/route/booking,
// changes production configuration, or opens a provider network connection.
const HUB_ORIGIN = 'https://journey-hub.offline.test';
const TRUSTED_IP = '198.51.100.73';
const SMS_KEY = 'offline-journey-authentica-only';
const MAP_KEY = 'offline-journey-tomtom-only';
const OTP = '246810';
const RIDER = {name: 'راكب تجربة الحجز', phone: '0500000071', email: 'journey-rider@example.test', password: 'journey-offline-rider-only-123'};
const CAPTAIN = {name: 'كابتن تجربة الحجز', phone: '0500000072', email: 'journey-captain@example.test', password: 'journey-offline-captain-only-123'};
const PICKUP = {name: 'انطلاق تجربة مشوار', area: 'موقع اصطناعي للاختبار', lat: 24.7136, lng: 46.6753};
const DESTINATION = {name: 'وجهة تجربة مشوار', area: 'موقع اصطناعي للاختبار', lat: 24.721, lng: 46.684};
let activeServer = false;

const json = (data, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
const cookieOf = response => String(response.headers.get('set-cookie') || '').split(';', 1)[0];
const normalizedPhone = phone => '+966' + phone.slice(1);
const pointValid = point => Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.lat >= 23.8 && point.lat <= 25.5 && point.lng >= 45.5 && point.lng <= 48;

export async function startJourneyServer({publicRoot = 'apps/rider/dist/public'} = {}) {
  assert.equal(activeServer, false, 'Close the previous local journey server first');
  const root = realpathSync(resolve(publicRoot));
  assert.ok(existsSync(join(root, 'index.html')), 'Supply an existing rider public build; this helper does not build');
  activeServer = true;
  const originalFetch = globalThis.fetch;
  const context = new AsyncLocalStorage();
  const pending = new Set();
  const audit = {
    database: 'isolated migration-backed SQLite in memory; new database for every reset',
    gateways: 'real rider source gateway and real shared source Worker',
    providers: 'synthetic Authentica and TomTom responses; no provider network I/O',
    browserStateSeeded: false,
    captainSetup: 'synthetic approved application and valid fixture documents; phone proved through real OTP APIs; economy/comfort approved through the real local administration API',
    scenarios: [], requests: [], upstream: [], providerRequests: [], captainActions: [], errors: [], externalBlocked: [],
  };
  let current = null, origin = '', resetting = false, closed = false;

  const label = () => {
    const scope = context.getStore();
    return {scenarioId: scope?.state?.fixture.scenarioId ?? current?.fixture.scenarioId ?? null, phase: scope?.phase ?? 'outside-request'};
  };
  async function checked(response, expected, operation) {
    const data = await response.json();
    assert.equal(response.status, expected, operation + ': ' + JSON.stringify(data));
    return data;
  }
  function inputRequest(url, body, cookie = '') {
    return new Request(url, {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: new URL(url).origin, ...(cookie ? {Cookie: cookie} : {})},
      body: JSON.stringify(body),
    });
  }
  const riderCall = (state, path, body, cookie = '', phase = 'setup') => context.run({state, phase}, () => riderGateway.fetch(
    inputRequest(origin + path, body, cookie), {HUB_URL: HUB_ORIGIN, HUB_SERVICE_KEY: state.env.RIDER_SERVICE_KEY}, {trustedClientIp: TRUSTED_IP},
  ));
  const hubCall = (state, path, body, cookie = '', phase = 'setup') => context.run({state, phase}, () => hubWorker.fetch(inputRequest(HUB_ORIGIN + path, body, cookie), state.env, {}));

  async function guardedFetch(input, options = {}) {
    const request = new Request(input, options), url = new URL(request.url);
    const scope = context.getStore();
    if (url.origin === HUB_ORIGIN) {
      assert.ok(scope?.state, 'A gateway request must belong to a local fixture');
      audit.upstream.push({...label(), path: url.pathname, method: request.method});
      return hubWorker.fetch(request, scope.state.env, {});
    }
    if (url.origin === 'https://api.authentica.sa' && ['/api/v2/send-otp', '/api/v2/verify-otp'].includes(url.pathname)) {
      assert.ok(scope?.state, 'Fake SMS must belong to a local fixture');
      assert.equal(request.headers.get('X-Authorization'), SMS_KEY);
      assert.equal(request.method, 'POST');
      const payload = await request.json();
      assert.ok([normalizedPhone(RIDER.phone), normalizedPhone(CAPTAIN.phone)].includes(payload.phone), 'Only synthetic fixture phones may use fake SMS');
      const operation = url.pathname.endsWith('/send-otp') ? 'send-otp' : 'verify-otp';
      audit.providerRequests.push({...label(), provider: 'Authentica', operation, mocked: true});
      if (operation === 'send-otp') { assert.equal(payload.template_id, 91); return json({success: true}); }
      return json({verified: payload.otp === OTP});
    }
    if (url.origin === 'https://api.tomtom.com') {
      assert.ok(scope?.state, 'Fake map provider must belong to a local fixture');
      assert.equal(url.searchParams.get('key'), MAP_KEY);
      if (url.pathname.startsWith('/search/2/search/')) {
        const query = decodeURIComponent(url.pathname.slice('/search/2/search/'.length).replace(/\.json$/, ''));
        const point = /انطلاق|pickup/i.test(query) ? PICKUP : DESTINATION;
        audit.providerRequests.push({...label(), provider: 'TomTom', operation: 'search', mocked: true});
        return json({results: [{type: 'POI', poi: {name: point.name}, position: {lat: point.lat, lon: point.lng}, address: {freeformAddress: point.name, municipality: 'الرياض', municipalitySubdivision: point.area}}]});
      }
      if (url.pathname.startsWith('/search/2/reverseGeocode/')) {
        const [lat, lng] = url.pathname.slice('/search/2/reverseGeocode/'.length).replace(/\.json$/, '').split(',').map(Number);
        assert.ok(pointValid({lat, lng}), 'Reverse fixture is restricted to synthetic Riyadh test points');
        const point = Math.hypot(lat - PICKUP.lat, lng - PICKUP.lng) < Math.hypot(lat - DESTINATION.lat, lng - DESTINATION.lng) ? PICKUP : DESTINATION;
        audit.providerRequests.push({...label(), provider: 'TomTom', operation: 'reverse', mocked: true});
        return json({addresses: [{position: lat + ',' + lng, address: {freeformAddress: point.name, streetName: point.name, municipality: 'الرياض', municipalitySubdivision: point.area}}]});
      }
      if (url.pathname.startsWith('/routing/1/calculateRoute/')) {
        const raw = url.pathname.slice('/routing/1/calculateRoute/'.length).replace(/\/json$/, '');
        const points = raw.split(':').map(part => {const [lat, lng] = part.split(',').map(Number); return {lat, lng};});
        assert.ok(points.length >= 2 && points.length <= 4 && points.every(pointValid), 'Route fixture requires valid local itinerary points');
        audit.providerRequests.push({...label(), provider: 'TomTom', operation: 'route', mocked: true});
        // Test-only road facts returned at the provider boundary, not seeded in
        // the browser or quote tables. The actual adapter validates and prices it.
        return json({routes: [{summary: {lengthInMeters: 2400, travelTimeInSeconds: 480, trafficDelayInSeconds: 0}, legs: points.slice(1).map((point, i) => ({points: [points[i], point].map(p => ({latitude: p.lat, longitude: p.lng}))}))}]});
      }
    }
    // The browser runner may use Node fetch to reach this server or its local
    // CDP port. Every other destination is denied before native fetch is called.
    if (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)) return originalFetch(request);
    audit.externalBlocked.push({...label(), origin: url.origin, path: url.pathname});
    throw Error('EXTERNAL_NETWORK_FORBIDDEN in local journey fixture');
  }
  globalThis.fetch = guardedFetch;

  const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'};
  const server = createServer((request, response) => {
    const work = (async () => {
      const url = new URL(request.url, origin);
      if (url.origin !== origin) { response.writeHead(403); response.end(); return; }
      if (url.pathname.startsWith('/api/')) {
        if (resetting || !current || closed) { response.writeHead(503, {'Content-Type': 'application/json'}); response.end('{"error":"Local fixture is resetting"}'); return; }
        const state = current;
        let raw = ''; for await (const chunk of request) {raw += chunk; if (Buffer.byteLength(raw) > 20000) throw Error('Oversized local API request');}
        let body = {}; try {body = raw ? JSON.parse(raw) : {};} catch {}
        const row = {scenarioId: state.fixture.scenarioId, phase: 'browser', path: url.pathname, action: body.action || null, method: request.method, status: null};
        audit.requests.push(row);
        const reply = await context.run({state, phase: 'browser'}, () => riderGateway.fetch(new Request(origin + request.url, {
          method: request.method, headers: request.headers, ...(['GET', 'HEAD'].includes(request.method) ? {} : {body: raw}),
        }), {HUB_URL: HUB_ORIGIN, HUB_SERVICE_KEY: state.env.RIDER_SERVICE_KEY}, {trustedClientIp: TRUSTED_IP}));
        row.status = reply.status;
        const bytes = Buffer.from(await reply.arrayBuffer());
        response.writeHead(reply.status, Object.fromEntries(reply.headers)); response.end(bytes); return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {response.writeHead(405); response.end(); return;}
      const file = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname === '/install' ? '/install.html' : decodeURIComponent(url.pathname)));
      const inside = relative(root, file);
      if (inside.startsWith('..') || isAbsolute(inside) || !mime[extname(file)]) {response.writeHead(403); response.end(); return;}
      try {
        const actual = realpathSync(file), actualRelative = relative(root, actual);
        if (actualRelative.startsWith('..') || isAbsolute(actualRelative)) {response.writeHead(403); response.end(); return;}
        response.writeHead(200, {'Content-Type': mime[extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(url.pathname === '/sw.js' ? {'Service-Worker-Allowed': '/'} : {})});
        response.end(request.method === 'HEAD' ? undefined : readFileSync(actual));
      } catch {response.writeHead(404); response.end();}
    })().catch(error => {
      audit.errors.push({scenarioId: current?.fixture.scenarioId, error: String(error.message).slice(0, 200)});
      if (!response.headersSent) response.writeHead(500, {'Content-Type': 'application/json'});
      response.end('{"error":"Local journey server error"}');
    });
    pending.add(work); void work.finally(() => pending.delete(work));
  });

  async function verifiedAccount(state, role) {
    const credentials = role === 'rider' ? RIDER : CAPTAIN;
    const call = (path, body, cookie) => role === 'rider' ? riderCall(state, path, body, cookie) : hubCall(state, path, body, cookie);
    const registration = await call('/api/auth/register', credentials);
    const cookie = cookieOf(registration);
    assert.ok(cookie.startsWith(role === 'rider' ? '__Host-mishwar_sid=' : '__Host-mishwar_captain='));
    await checked(registration, 201, role + ' fixture registration');
    await checked(await call('/api/auth/phone-otp-start', {}, cookie), 200, role + ' fake OTP start');
    await checked(await call('/api/auth/phone-otp-check', {code: OTP}, cookie), 200, role + ' fake OTP check');
    return {cookie, call};
  }

  async function snapshot() {
    assert.ok(current && !closed, 'Local journey fixture is unavailable');
    const db = current.env.db;
    const trips = db.prepare(`SELECT t.id,t.status,t.payment_status,t.fare_halalas,t.driver_id,
      c.method,COALESCE(c.discount_halalas,0) AS discount_halalas,c.cash_due_halalas,
      q.category,q.route_json,t.pickup_json,t.destination_json
      FROM trips t LEFT JOIN trip_commerce c ON c.trip_id=t.id
      LEFT JOIN ride_quotes q ON q.id=c.quote_id ORDER BY t.created_at,t.id`).all().map(row => {
      const {route_json, pickup_json, destination_json, ...trip} = row;
      return {...trip, payable: trip.fare_halalas - trip.discount_halalas,
        route: route_json ? JSON.parse(route_json) : null, pickup: JSON.parse(pickup_json), destination: JSON.parse(destination_json)};
    });
    const ratings = db.prepare('SELECT trip_id,role,score,comment FROM trip_ratings').all();
    const riderRatings = ratings.filter(row => row.role === 'rider');
    const trip = trips.at(-1) || null;
    return {
      scenarioId: current.fixture.scenarioId, returning: current.fixture.returning,
      database: 'isolated SQLite; synthetic data only', trip, trips,
      tripCount: trips.length, status: trip?.status ?? null,
      ratingCount: riderRatings.length, ratingScore: riderRatings.at(-1)?.score ?? null,
      liveBookCount: audit.requests.filter(row => row.scenarioId === current.fixture.scenarioId && row.action === 'live_book').length,
      externalNetworkCalls: audit.externalBlocked.filter(row => row.scenarioId === current.fixture.scenarioId).length,
      category: trip?.category ?? null, payable: trip?.payable ?? null, route: trip?.route ?? null,
      counts: {
        riderAccounts: db.prepare("SELECT COUNT(*) AS n FROM public_accounts WHERE role='rider'").get().n,
        verifiedRiders: db.prepare("SELECT COUNT(*) AS n FROM public_accounts WHERE role='rider' AND phone_verified_at IS NOT NULL").get().n,
        quotes: db.prepare('SELECT COUNT(*) AS n FROM ride_quotes').get().n,
        trips: trips.length, ratings: db.prepare('SELECT COUNT(*) AS n FROM trip_ratings').get().n,
        riderRatings: db.prepare("SELECT COUNT(*) AS n FROM trip_ratings WHERE role='rider'").get().n,
        settlements: db.prepare('SELECT COUNT(*) AS n FROM trip_settlements').get().n,
        walletEntries: db.prepare('SELECT COUNT(*) AS n FROM wallet_entries').get().n,
      },
      ratings,
      ledgerTotal: db.prepare('SELECT COALESCE(SUM(amount_halalas),0) AS n FROM wallet_entries').get().n,
    };
  }

  async function resetFixture({returning = false, scenarioId = 'journey-' + (audit.scenarios.length + 1)} = {}) {
    assert.equal(closed, false, 'Local journey server is closed');
    assert.equal(resetting, false, 'Do not reset scenarios concurrently');
    resetting = true;
    try {
      await Promise.allSettled([...pending]);
      if (current) {
        current.receipt = await snapshot();
        const previous = audit.scenarios.find(row => row.scenarioId === current.fixture.scenarioId);
        if (previous) previous.receipt = current.receipt;
        current.env.db.close();
      }
      const env = makeEnv(true);
      Object.assign(env, {AUTHENTICA_API_KEY: SMS_KEY, AUTHENTICA_TEMPLATE_ID: '91', TOMTOM_ENABLED: 'true', TOMTOM_API_KEY: MAP_KEY, REQUIRE_COMMERCIAL_ROUTES: 'true'});
      const fixture = {
        scenarioId: String(scenarioId), returning: Boolean(returning), credentials: {...RIDER}, otp: OTP,
        places: {pickup: {...PICKUP}, destination: {...DESTINATION}},
        gps: {latitude: PICKUP.lat, longitude: PICKUP.lng, accuracy: 5},
        disclosure: 'Synthetic provider facts and eligible captain; rider enters addresses and creates quotes/bookings only through the UI.',
      };
      const state = {env, fixture, captainCookie: '', captainId: '', receipt: null};
      current = state;
      audit.scenarios.push({scenarioId: fixture.scenarioId, returning: fixture.returning, database: 'new in-memory SQLite', synthetic: true});
      const captain = await verifiedAccount(state, 'captain');
      state.captainCookie = captain.cookie;
      const account = env.db.prepare("SELECT actor FROM public_accounts WHERE role='captain'").get();
      state.captainId = env.db.prepare('SELECT id FROM captain_applications').get().id;
      env.db.prepare("UPDATE captain_applications SET user_id=?,phone=?,email=?,status='active' WHERE id=?").run(account.actor, normalizedPhone(CAPTAIN.phone), CAPTAIN.email, state.captainId);
      // The runner compares economy and comfort. Declare the synthetic vehicle's
      // eligibility through the real administration handler; acceptance keeps
      // its normal category, dispatch, document and account guards.
      const categoryPath = '/internal/administration/commerce/captain-categories';
      const categoryRequest = inputRequest(HUB_ORIGIN + categoryPath, {captainId: state.captainId, categories: ['economy', 'comfort']});
      categoryRequest.headers.set('x-mishwar-key', env.ADMIN_SERVICE_KEY);
      audit.upstream.push({scenarioId: fixture.scenarioId, phase: 'setup', path: categoryPath, method: 'POST'});
      await checked(await context.run({state, phase: 'setup'}, () => hubWorker.fetch(categoryRequest, env, {})), 200, 'fixture vehicle economy/comfort approval');
      env.db.prepare("INSERT INTO platform_settings(key,value,updated_at,updated_by) VALUES('commission_bps','1000',?,'local-journey-fixture') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
      await checked(await hubCall(state, '/api/driver', {action: 'available', available: true, lat: PICKUP.lat, lng: PICKUP.lng, accuracy: 5}, state.captainCookie), 200, 'eligible fixture captain online');
      if (returning) {
        const rider = await verifiedAccount(state, 'rider');
        await checked(await rider.call('/api/auth/logout', {}, rider.cookie), 200, 'returning rider fixture logout before UI login');
      }
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM ride_quotes').get().n, 0, 'Never seed the rider quote');
      assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM trips').get().n, 0, 'Never seed a rider trip');
      return fixture;
    } finally {resetting = false;}
  }

  async function advanceTrip(action, {pin} = {}) {
    assert.ok(current && !closed && !resetting, 'Local journey fixture is unavailable');
    const state = current, target = ({start: 'riding', complete: 'completed'})[action] || action;
    assert.ok(['accept', 'arrived', 'riding', 'completed'].includes(target), 'Unsupported fixture captain action');
    const trip = state.env.db.prepare("SELECT id FROM trips WHERE status IN ('matching','arriving','arrived','riding') ORDER BY created_at DESC LIMIT 1").get();
    assert.ok(trip, 'The browser must create a real local booking before captain progression');
    const call = body => hubCall(state, '/api/driver', body, state.captainCookie, 'captain');
    if (target === 'accept') await checked(await call({action: 'available', available: true, lat: PICKUP.lat, lng: PICKUP.lng, accuracy: 5}), 200, 'captain refreshes real availability');
    const body = target === 'accept' ? {action: 'accept', tripId: trip.id} : {action: 'trip_status', tripId: trip.id, status: target, ...(pin === undefined ? {} : {pin}), ...(target === 'completed' ? {cashReceived: true} : {})};
    const result = await call(body);
    audit.captainActions.push({scenarioId: state.fixture.scenarioId, action: target, status: result.status, tripId: trip.id});
    await checked(result, 200, 'real captain API ' + target);
    return snapshot();
  }

  async function close() {
    if (closed) return;
    closed = true;
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    await Promise.allSettled([...pending]);
    current?.env.db.close();
    if (globalThis.fetch === guardedFetch) globalThis.fetch = originalFetch;
    activeServer = false;
  }
  try {
    await new Promise((done, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', done);});
    origin = 'http://127.0.0.1:' + server.address().port;
    await resetFixture();
    return {origin, get env() {return current.env;}, get fixture() {return current.fixture;}, audit, resetFixture, advanceTrip, snapshot, close};
  } catch (error) {await close(); throw error;}
}
