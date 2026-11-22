import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {launchAction} from '../worker/launch-features.js';
import {handleLiveRider} from '../worker/commerce.js';

const captain = '11111111-1111-4111-8111-111111111111';
const rider = 'rider:receipt-owner';
const createdAt = '2026-11-17T08:15:00.000Z';
const completedAt = '2026-11-17T08:45:00.000Z';
const pickup = {name: 'انطلاق إيصال اختباري', area: 'حي اختبار', lat: 24.7, lng: 46.6};
const destination = {...pickup, name: 'وجهة إيصال اختباري', lat: 24.71};
const originalFetch = globalThis.fetch;
test.beforeEach(() => {globalThis.fetch = () => {throw Error('Receipt tests must not access a provider');};});
test.afterEach(() => {globalThis.fetch = originalFetch;});

function fixture(t) {
  const env = makeEnv(true); t.after(() => env.db.close());
  env.db.prepare("UPDATE captain_applications SET status='active'").run();
  env.db.prepare('INSERT INTO riders VALUES(?,?,?,?,?,?,?)').run(rider, 'مالك إيصال اختباري', '+966500000081', 'receipt@example.test', 'active', createdAt, createdAt);
  return env;
}
function trip(env, extra = {}) {
  const data = {id: crypto.randomUUID(), status: 'completed', fare: 2500, discount: 500, method: 'cash', paymentStatus: 'cash_collected', isDemo: 0, commissionBps: 1000, pickup, destination, ...extra};
  env.db.prepare('INSERT INTO trips VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(data.id, rider, captain, data.status, JSON.stringify(data.pickup), JSON.stringify(data.destination), data.fare, data.commissionBps, data.paymentStatus, data.isDemo, createdAt, completedAt);
  if (data.method !== null) {
    const quoteId = 'quote-' + data.id;
    env.db.prepare('INSERT INTO ride_quotes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(quoteId, rider, JSON.stringify(pickup), JSON.stringify(destination), 'comfort', data.fare, data.discount, null, data.commissionBps, '2030-01-01T00:00:00.000Z', null);
    env.db.prepare('INSERT INTO trip_commerce VALUES(?,?,?,?,?,?)').run(data.id, quoteId, data.method, data.discount, data.method === 'cash' ? data.fare - data.discount : 0, null);
  }
  return data;
}
const receipt = async (env, data, role = 'rider', owner = rider, extra = {}) => (await launchAction(env, role, owner, {action: 'receipt', tripId: data.id, ...extra})).receipt;
const count = (env, table) => env.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n;

test('RDEV-002 receipt distinguishes trip dates from issue time and preserves integer halalas', async t => {
  const env = fixture(t), data = trip(env), value = await receipt(env, data);
  assert.equal(value.tripCreatedAt, createdAt);
  assert.equal(value.tripCompletedAt, completedAt);
  assert.equal(value.tripId, data.id); assert.equal(value.tripStatus, 'completed');
  assert.notEqual(value.created_at, completedAt, 'Generating a receipt later must not change the historical trip date');
  assert.equal(value.currency, 'SAR');
  assert.equal(value.fare, 2500); assert.equal(value.discount, 500);
  assert.equal(value.total, 2000); assert.equal(value.paid, 2000, 'Legacy paid field remains the net total for compatibility');
  assert.equal(value.paymentStatus, 'cash_collected');
  assert.equal(value.taxInvoice, false);
});

test('RDEV-002 receipt uses the completed settlement time when later trip metadata was updated', async t => {
  const env = fixture(t), data = trip(env, {status: 'riding'});
  env.db.prepare("INSERT INTO trip_settlements VALUES(?,'complete',?)").run(data.id, completedAt);
  env.db.prepare("UPDATE trips SET status='completed',updated_at=? WHERE id=?").run('2026-11-19T10:00:00.000Z', data.id);
  assert.equal((await receipt(env, data)).tripCompletedAt, completedAt);
});

test('RDEV-002 an invalid historical date stays unknown instead of becoming the receipt issue time', async t => {
  const env = fixture(t), data = trip(env);
  env.db.prepare('UPDATE trips SET created_at=?,updated_at=? WHERE id=?').run('invalid-date', 'invalid-date', data.id);
  const value = await receipt(env, data);
  assert.equal(value.tripCreatedAt, null); assert.equal(value.tripCompletedAt, null);
  assert.ok(Number.isFinite(Date.parse(value.created_at)), 'Receipt issue time remains a separate valid timestamp');
});

test('RDEV-002 receipts allow only the trip owner or its assigned captain without cross-account disclosure', async t => {
  const env = fixture(t), data = trip(env);
  await assert.rejects(receipt(env, data, 'rider', 'rider:another-owner'));
  await assert.rejects(receipt(env, data, 'captain', 'another-captain'));
  await assert.rejects(receipt(env, data, 'admin', captain));
  await assert.rejects(receipt(env, {...data, id: 'missing-trip'}));
  assert.equal(count(env, 'trip_receipts'), 0);
  assert.equal((await receipt(env, data, 'captain', captain)).commission, 250);
  assert.equal((await receipt(env, data)).commission, undefined);
});

test('RDEV-002 incomplete, cancelled and demo trips never generate a receipt', async t => {
  const env = fixture(t), data = trip(env);
  for (const status of ['matching', 'arriving', 'arrived', 'riding', 'cancelled']) {
    env.db.prepare('UPDATE trips SET status=? WHERE id=?').run(status, data.id);
    await assert.rejects(receipt(env, data));
  }
  env.db.prepare("UPDATE trips SET status='completed',is_demo=1 WHERE id=?").run(data.id);
  await assert.rejects(receipt(env, data));
  assert.equal(count(env, 'trip_receipts'), 0);
});

test('RDEV-002 completed trips retain receipts across payment methods without asserting unconfirmed collection', async t => {
  const env = fixture(t);
  for (const [method, paymentStatus] of [['cash', 'cash_due'], ['wallet', 'paid'], ['card', 'paid'], ['applepay', 'held'], [null, 'demo']]) {
    const data = trip(env, {method, paymentStatus}), value = await receipt(env, data);
    assert.equal(value.paymentStatus, paymentStatus);
    assert.equal(value.total, method === null ? 2500 : 2000);
    assert.equal(value.method, method);
  }
});

test('RDEV-002 malformed money never creates a misleading receipt', async t => {
  const env = fixture(t);
  for (const changes of [{fare: -1}, {fare: 2500.5}, {discount: -1}, {discount: 2500.5}, {discount: 2501}, {fare: Number.MAX_SAFE_INTEGER + 1}]) {
    const data = trip(env, changes);
    await assert.rejects(receipt(env, data));
  }
  assert.equal(count(env, 'trip_receipts'), 0);
});

test('RDEV-002 repeated and concurrent receipt requests preserve one number and issue timestamp', async t => {
  const env = fixture(t), data = trip(env);
  const values = await Promise.all(Array.from({length: 8}, () => receipt(env, data)));
  assert.equal(count(env, 'trip_receipts'), 1);
  assert.ok(values[0].receipt_number);
  for (const value of values) {
    assert.equal(value.receipt_number, values[0].receipt_number);
    assert.equal(value.created_at, values[0].created_at);
  }
  const persisted = 'MW-EXISTING-RECEIPT';
  env.db.prepare('UPDATE trip_receipts SET receipt_number=? WHERE trip_id=?').run(persisted, data.id);
  assert.equal((await receipt(env, data)).receipt_number, persisted, 'Previously issued numbers remain unchanged');
});

test('RDEV-002 two trips with the same truncated identifier prefix keep separate receipt identities', async t => {
  const env = fixture(t);
  const first = trip(env, {id: '12345678-1234-4123-8123-123456789011'});
  const second = trip(env, {id: '12345678-1234-4123-8123-123456789022'});
  const a = await receipt(env, first), b = await receipt(env, second);
  assert.ok(a.receipt_number); assert.ok(b.receipt_number);
  assert.notEqual(a.receipt_number, b.receipt_number);
  assert.equal(count(env, 'trip_receipts'), 2);
});

test('RDEV-002 receipt responses whitelist route labels and never expose unrelated point metadata or secrets', async t => {
  const env = fixture(t), secret = 'synthetic-private-marker';
  Object.assign(env, {RIDER_SERVICE_KEY: secret, MERCHANT_LEGAL_NAME: 'مشوار الاختباري'});
  const data = trip(env, {pickup: {...pickup, phone: secret, sessionToken: secret, customer: {email: secret}}, destination: {...destination, apiKey: secret}});
  const value = await receipt(env, data);
  assert.deepEqual(value.pickup, pickup); assert.deepEqual(value.destination, destination);
  assert.equal(JSON.stringify(value).includes(secret), false);
  assert.equal(value.commission, undefined);
});

test('RDEV-002 authenticated receipt API derives ownership from the session and leaves financial records unchanged', async t => {
  const env = fixture(t), data = trip(env), token = env.verifiedToken('receipt-owner');
  const before = Object.fromEntries(['trips', 'wallet_entries', 'trip_settlements', 'payment_intents', 'refund_requests'].map(table => [table, count(env, table)]));
  const request = sessionToken => new Request('https://local.test/internal/live-rider', {method: 'POST', headers: {'Content-Type': 'application/json', 'x-mishwar-key': env.RIDER_SERVICE_KEY}, body: JSON.stringify({action: 'live_receipt', tripId: data.id, sessionToken, actor: 'another-owner', role: 'captain', owner: captain})});
  const response = await handleLiveRider(request(token), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).receipt.commission, undefined);
  const stranger = await handleLiveRider(request(env.verifiedToken('another-owner')), env);
  assert.equal(stranger.status, 400);
  assert.equal((await stranger.text()).includes(data.id), false);
  const after = Object.fromEntries(Object.keys(before).map(table => [table, count(env, table)]));
  assert.deepEqual(after, before);
  assert.equal(count(env, 'trip_receipts'), 1);
});
