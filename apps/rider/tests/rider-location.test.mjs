import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const sandbox = {window: {}, setTimeout, clearTimeout};
vm.runInNewContext(readFileSync(new URL('../public/rider-location.js', import.meta.url), 'utf8'), sandbox);
const {inspect, validatePosition, createTracker} = sandbox.window.MishwarLocation;
const EPOCH = 1800000000000;
const sample = (extra = {}) => ({lat: 24.7, lng: 46.6, accuracy: 5, observedAt: EPOCH, source: 'gps', ...extra});
const position = (extra = {}) => { const p = sample(extra); return {coords: {latitude: p.lat, longitude: p.lng, accuracy: p.accuracy}, timestamp: p.observedAt}; };
const flush = async () => { for (let n = 0; n < 6; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };

function harness(extra = {}) {
  const state = {time: EPOCH, nextId: 0, timers: new Map(), watches: [], clears: [], points: [], search: [], statuses: [], visible: true, apply: true};
  const geo = {
    watchPosition(success, error, options) { const id = state.watches.length; state.watches.push({success, error, options}); return id; },
    clearWatch(id) { state.clears.push(id); },
  };
  const tracker = createTracker({
    geolocation: geo, isSecure: true, isVisible: () => state.visible, canApply: () => state.apply,
    now: () => state.time,
    setTimeout(fn, delay) { const id = ++state.nextId; state.timers.set(id, {at: state.time + delay, fn}); return id; },
    clearTimeout(id) { state.timers.delete(id); },
    reverse: async p => ({...p, name: 'Resolved test address'}),
    onPoint: p => state.points.push(p), onSearch: p => state.search.push(p), onStatus: (value, reason) => state.statuses.push({value, reason}),
    ...extra,
  });
  async function advance(amount) {
    const end = state.time + amount;
    while (true) {
      const next = [...state.timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      state.time = next[1].at; state.timers.delete(next[0]); next[1].fn(); await flush();
    }
    state.time = end; await flush();
  }
  return {state, tracker, geo, advance, fix: p => state.watches.at(-1).success(p || position({observedAt: state.time})), error: code => state.watches.at(-1).error({code})};
}

test('GPS accepts valid world coordinates and exact accuracy, age and clock-skew boundaries', () => {
  for (const p of [sample(), sample({lat: -90, lng: 180, accuracy: 150}), sample({observedAt: EPOCH - 30000}), sample({observedAt: EPOCH + 5000})]) assert.equal(inspect(p, EPOCH).ok, true);
});
test('GPS rejects malformed coordinates, poor accuracy, invalid dates, stale and future measurements', () => {
  const cases = [
    [null, 'coordinates'], [sample({lat: NaN}), 'coordinates'], [sample({lng: Infinity}), 'coordinates'],
    [sample({lat: 90.001}), 'coordinates'], [sample({lng: -180.001}), 'coordinates'], [sample({lat: '24.7'}), 'coordinates'],
    ...[0, -1, 150.001, NaN, Infinity, undefined].map(accuracy => [sample({accuracy}), 'accuracy']),
    ...[undefined, NaN, '1800000000000'].map(observedAt => [sample({observedAt}), 'timestamp']),
    [sample({observedAt: EPOCH - 30001}), 'stale'], [sample({observedAt: EPOCH + 5001}), 'future'],
  ];
  for (const [p, reason] of cases) { const result = inspect(p, EPOCH); assert.equal(result.ok, false); assert.equal(result.reason, reason); }
  assert.equal(inspect(sample(), NaN).reason, 'timestamp');
});
test('browser position conversion never invents a missing timestamp or returns an invalid point', () => {
  const good = validatePosition(position(), EPOCH); assert.equal(good.ok, true); assert.equal(good.point.source, 'gps'); assert.equal(good.point.observedAt, EPOCH);
  for (const p of [undefined, {}, {coords: {latitude: 24.7, longitude: 46.6, accuracy: 5}}, position({accuracy: NaN})]) { const bad = validatePosition(p, EPOCH); assert.equal(bad.ok, false); assert.equal(bad.point, undefined); }
});
test('registration is high accuracy, uncached, single-watch and caller initiated', async () => {
  const h = harness(); assert.equal(h.state.watches.length, 0); assert.equal(h.tracker.start(), true); assert.equal(h.tracker.start(), true);
  assert.equal(h.state.watches.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(h.state.watches[0].options)), {enableHighAccuracy: true, timeout: 15000, maximumAge: 0});
  h.fix(); await flush(); assert.equal(h.state.points.length, 1); assert.equal(h.state.statuses.at(-1).value, 'live');
});
test('invalid measurements never reach the cache, geocoder, search bias or pickup', async () => {
  let reverses = 0; const h = harness({reverse: p => { reverses++; return p; }}); h.tracker.start();
  for (const p of [position({accuracy: 1000}), position({observedAt: EPOCH - 30001}), position({observedAt: EPOCH + 5001}), position({lat: NaN})]) h.fix(p);
  await flush(); assert.equal(h.tracker.current(), null); assert.equal(reverses, 0); assert.equal(h.state.points.length, 0); assert.equal(h.state.search.filter(Boolean).length, 0);
});
test('service-area rejection precedes cache, search and geocoding and preserves manual choice', async () => {
  let reverses = 0; const h = harness({manual: true, acceptsPoint: p => p.lat >= 24.3 && p.lat <= 25.1, reverse: p => { reverses++; return p; }});
  h.tracker.start({explicit: true}); h.fix(position({lat: 21.5})); await flush();
  assert.equal(h.tracker.current(), null); assert.equal(reverses, 0); assert.equal(h.state.points.length, 0); assert.equal(h.state.search.filter(Boolean).length, 0);
  assert.equal(h.state.statuses.at(-1).value, 'invalid'); assert.equal(h.state.statuses.at(-1).reason, 'service-area');
  h.tracker.stop(); assert.equal(h.tracker.start(), false, 'a rejected explicit fix must not remove manual protection');
});
test('explicit locate preserves manual pickup until a new accepted fix resolves', async () => {
  const result = deferred(), h = harness({manual: true, reverse: () => result.promise});
  assert.equal(h.tracker.start(), false); assert.equal(h.tracker.start({explicit: true}), true);
  h.fix(position({accuracy: 151})); await flush(); assert.equal(h.state.points.length, 0);
  h.fix(); await flush(); assert.equal(h.state.points.length, 0); assert.notEqual(h.state.statuses.at(-1).value, 'live');
  result.resolve({name: 'Fresh GPS'}); await flush(); assert.equal(h.state.points.length, 1); assert.equal(h.state.statuses.at(-1).value, 'live');
});
test('denied, unavailable and timeout errors preserve manual pickup and release the watch', async () => {
  for (const [code, state] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
    const h = harness({manual: true}); h.tracker.start({explicit: true}); h.error(code); await flush();
    assert.equal(h.state.points.length, 0); assert.equal(h.state.statuses.at(-1).value, state); assert.deepEqual(h.state.clears, [0]);
    assert.equal(h.tracker.start(), false, 'automatic restart must still respect the manual choice');
  }
});
test('manual choice stops watch, clears GPS search bias and defeats delayed reverse geocoding', async () => {
  const pending = deferred(), h = harness({reverse: () => pending.promise}); h.tracker.start(); h.fix(); await flush();
  h.tracker.manual(); pending.resolve({name: 'Late GPS'}); await flush();
  assert.equal(h.state.points.length, 0); assert.equal(h.tracker.current(), null); assert.equal(h.state.search.at(-1), null); assert.equal(h.state.statuses.at(-1).value, 'manual');
  h.fix(position({observedAt: EPOCH + 1000})); await flush(); assert.equal(h.state.points.length, 0); assert.equal(h.tracker.start(), false);
});
test('stop and account reset invalidate browser callbacks and geocoder promises', async () => {
  for (const action of ['stop', 'reset']) {
    const pending = deferred(), h = harness({reverse: () => pending.promise}); h.tracker.start(); h.fix(); await flush();
    h.tracker[action](); pending.resolve({name: 'Old account address'}); h.fix(); await flush();
    assert.equal(h.state.points.length, 0); assert.equal(h.state.search.at(-1), null); assert.equal(h.tracker.current(), null);
  }
});
test('newest ordered measurement wins even when geocoder promises resolve out of order', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const h = harness({reverse: () => ++count === 1 ? first.promise : second.promise}); h.tracker.start(); h.fix();
  h.state.time += 1000; h.fix(position({lat: 24.8, observedAt: h.state.time}));
  second.resolve({name: 'New address'}); await flush(); first.resolve({name: 'Old address'}); await flush();
  h.fix(position({lat: 24.6, observedAt: EPOCH})); await flush();
  assert.equal(h.state.points.length, 1); assert.equal(h.state.points[0].lat, 24.8); assert.equal(h.state.points[0].name, 'New address');
});
test('fresh stationary fixes renew the measurement lifetime without needing movement', async () => {
  const h = harness(); h.tracker.start(); h.fix(); await flush(); await h.advance(20000); h.fix(); await flush(); await h.advance(20000);
  assert.equal(h.tracker.current().observedAt, EPOCH + 20000); assert.equal(h.state.points.length, 2);
});
test('expiry removes GPS and search bias without silently choosing a manual replacement', async () => {
  const h = harness(); h.tracker.start(); h.fix(); await flush(); await h.advance(30000);
  assert.notEqual(h.tracker.current(), null); await h.advance(1);
  assert.equal(h.tracker.current(), null); assert.equal(h.state.search.at(-1), null); assert.equal(h.state.statuses.at(-1).value, 'stale'); assert.equal(h.state.points.length, 1);
});
test('a slow geocoder cannot commit a sample after its freshness deadline', async () => {
  const pending = deferred(), h = harness({reverse: () => pending.promise}); h.tracker.start(); h.fix(); await flush();
  await h.advance(30001); pending.resolve({name: 'Expired address'}); await flush(); assert.equal(h.state.points.length, 0); assert.equal(h.state.statuses.at(-1).value, 'stale');
});
test('reverse labels cannot alter GPS coordinates, source, accuracy or observed time', async () => {
  const h = harness({reverse: async () => ({name: 'Label', lat: 0, lng: 0, accuracy: 1, observedAt: EPOCH + 100000, source: 'manual'})});
  h.tracker.start(); h.fix(); await flush(); const p = h.state.points[0]; assert.equal(p.lat, 24.7); assert.equal(p.lng, 46.6); assert.equal(p.accuracy, 5); assert.equal(p.observedAt, EPOCH); assert.equal(p.source, 'gps');
  const current = h.tracker.current(); current.lat = 0; assert.equal(h.tracker.current().lat, 24.7);
});
test('geocoder failures retain a validated GPS fix without reporting an invented address', async () => {
  const h = harness({reverse: async () => { throw Error('offline'); }}); h.tracker.start(); h.fix(); await flush();
  assert.equal(h.state.points[0].resolved, false); assert.equal(h.state.points[0].lat, 24.7); assert.equal(h.state.statuses.at(-1).value, 'live');
});
test('application and visibility gates are checked after geocoding, before changing pickup', async () => {
  for (const field of ['apply', 'visible']) {
    const pending = deferred(), h = harness({reverse: () => pending.promise}); h.tracker.start(); h.fix(); h.state[field] = false;
    pending.resolve({name: 'Blocked address'}); await flush(); assert.equal(h.state.points.length, 0); assert.notEqual(h.state.statuses.at(-1).value, 'live');
  }
});
test('unsupported, insecure and hidden environments fail without starting geolocation', () => {
  for (const [extra, expected] of [[{geolocation: null}, 'unsupported'], [{isSecure: false}, 'insecure'], [{isVisible: false}, 'stopped']]) {
    const h = harness(extra); assert.equal(h.tracker.start({explicit: true}), false); assert.equal(h.state.watches.length, 0); assert.equal(h.state.statuses.at(-1).value, expected);
  }
});
test('missing or rejecting Permissions API does not prevent browser-mediated GPS use', async () => {
  for (const permissions of [undefined, {query: () => Promise.reject(Error('unsupported'))}, {query() { throw Error('unsupported'); }}]) {
    const h = harness({permissions}); assert.equal(h.tracker.start(), true); h.fix(); await flush(); assert.equal(h.state.points.length, 1);
  }
});
test('permission revocation detaches listener, clears GPS and ignores already queued callbacks', async () => {
  const permission = {state: 'granted', onchange: null}; const h = harness({permissions: {query: async () => permission}});
  h.tracker.start(); await flush(); h.fix(); await flush(); permission.state = 'denied'; permission.onchange(); await flush();
  assert.equal(permission.onchange, null); assert.equal(h.tracker.current(), null); assert.equal(h.state.search.at(-1), null); assert.equal(h.state.statuses.at(-1).value, 'denied');
  h.fix(position({observedAt: EPOCH + 1000})); await flush(); assert.equal(h.state.points.length, 1); assert.equal(h.tracker.start(), false);
  permission.state = 'granted'; assert.equal(h.tracker.start({explicit: true}), true); assert.equal(h.state.watches.length, 2);
});
test('explicit retry recovers when a detached denied PermissionStatus stays stale', async () => {
  const denied = {state: 'denied', onchange: null}, granted = {state: 'granted', onchange: null}; let reads = 0;
  const h = harness({permissions: {query: async () => ++reads === 1 ? denied : granted}});
  h.tracker.start({explicit: true}); await flush(); assert.equal(h.state.statuses.at(-1).value, 'denied'); assert.equal(h.tracker.start(), false);
  assert.equal(h.tracker.start({explicit: true}), true); await flush(); h.fix(); await flush();
  assert.equal(reads, 2); assert.equal(denied.state, 'denied'); assert.equal(h.state.points.length, 1); assert.equal(h.state.statuses.at(-1).value, 'live');
});
test('late permission queries after stop cannot attach an observer or restart GPS', async () => {
  const pending = deferred(), permission = {state: 'granted', onchange: null}; const h = harness({permissions: {query: () => pending.promise}});
  h.tracker.start(); h.tracker.stop(); pending.resolve(permission); await flush(); assert.equal(permission.onchange, null); assert.equal(h.state.watches.length, 1);
});
test('synchronous watch errors and thrown registration errors release state safely', () => {
  for (const geo of [
    {watchPosition(_success, error) { error({code: 1}); return 19; }, clearWatch(id) { assert.equal(id, 19); }},
    {watchPosition() { throw Error('browser denied'); }, clearWatch() {}},
  ]) {
    const h = harness({geolocation: geo}); assert.equal(h.tracker.start({explicit: true}), false); assert.equal(h.tracker.current(), null); assert.ok(['denied', 'unavailable'].includes(h.state.statuses.at(-1).value));
  }
});
