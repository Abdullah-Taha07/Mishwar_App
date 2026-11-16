import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {freeAuth, publicSession} from '../worker/free-auth.js';
import {emailAuth} from '../worker/email-auth.js';
import {handleRiderAuth, tokenHash} from '../worker/rider-auth.js';

const originalFetch = globalThis.fetch;
test.beforeEach(() => { globalThis.fetch = async () => { throw Error('External network forbidden'); }; });
test.afterEach(() => { globalThis.fetch = originalFetch; });

async function setup(t, role = 'rider') {
  const env = makeEnv();
  t.after(() => env.db.close());
  Object.assign(env, {AUTHENTICA_API_KEY: 'r09-offline-only', AUTHENTICA_TEMPLATE_ID: '91'});
  const created = await freeAuth(env, role, {action: 'register', name: 'Offline R09', phone: '0500000091', email: 'r09@example.test', password: 'r09-offline-password', clientIp: 'offline'});
  assert.equal(created.status, 201);
  const {sessionToken} = await created.json();
  const call = (action, extra = {}) => freeAuth(env, role, {action, sessionToken, clientIp: 'offline', ...extra});
  return {env, role, sessionToken, call};
}

function smsProvider({verify = () => ({status: true}), send = () => ({success: true})} = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.ok(String(url).startsWith('https://api.authentica.sa/api/v2/'));
    assert.ok(init.signal, 'provider I/O must have a timeout');
    const body = JSON.parse(init.body);
    const operation = String(url).split('/').at(-1);
    calls.push({operation, body});
    const result = await (operation === 'send-otp' ? send(body) : verify(body));
    return result instanceof Response ? result : Response.json(result);
  };
  return calls;
}

for (const role of ['rider', 'captain']) {
  test(`R09 ${role}: OTP limits provider guesses and rejects expired challenges`, async t => {
    const {env, sessionToken, call} = await setup(t, role);
    const calls = smsProvider({verify: () => ({status: false})});
    assert.equal((await call('phone-otp-start')).status, 200);
    assert.equal((await freeAuth(env, role === 'rider' ? 'captain' : 'rider', {action: 'phone-otp-check', sessionToken, code: '123456'})).status, 401);
    assert.equal(calls.filter(c => c.operation === 'verify-otp').length, 0);
    for (let n = 0; n < 3; n++) assert.equal((await call('phone-otp-check', {code: '123456'})).status, 400);
    assert.equal((await call('phone-otp-check', {code: '123456'})).status, 429);
    assert.equal(calls.filter(c => c.operation === 'verify-otp').length, 3);
    env.db.prepare('UPDATE public_phone_otp SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    assert.equal((await call('phone-otp-check', {code: '123456'})).status, 400);
    assert.equal((await publicSession(env, sessionToken, role)).phoneVerified, false);
  });

  test(`R09 ${role}: a new login cannot use the former session's OTP`, async t => {
    const {env, call} = await setup(t, role);
    const calls = smsProvider();
    assert.equal((await call('phone-otp-start')).status, 200);
    const login = await freeAuth(env, role, {action: 'password-login', phone: '0500000091', password: 'r09-offline-password', clientIp: 'offline'});
    assert.equal(login.status, 200);
    const otherToken = (await login.json()).sessionToken;
    assert.equal((await call('phone-otp-check', {sessionToken: otherToken, code: '123456'})).status, 400);
    assert.equal((await call('phone-otp-check', {code: '123456'})).status, 401);
    assert.equal(calls.filter(c => c.operation === 'verify-otp').length, 0);
    assert.equal((await publicSession(env, otherToken, role)).phoneVerified, false);
  });

  test(`R09 ${role}: OTP expiring while the provider checks it cannot verify an account`, async t => {
    const {env, sessionToken, call} = await setup(t, role);
    smsProvider({verify: () => {
      env.db.prepare('UPDATE public_phone_otp SET expires_at=?').run('2000-01-01T00:00:00.000Z');
      return {status: true};
    }});
    assert.equal((await call('phone-otp-start')).status, 200);
    assert.equal((await call('phone-otp-check', {code: '123456'})).status, 400);
    assert.equal((await publicSession(env, sessionToken, role)).phoneVerified, false);
    assert.equal(env.db.prepare('SELECT consumed_at FROM public_phone_otp').get().consumed_at, null);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM rider_phone_accounts').get().n, 0);
  });

  test(`R09 ${role}: logout during provider verification revokes the pending proof`, async t => {
    const {env, call} = await setup(t, role);
    smsProvider({verify: async () => {
      assert.equal((await call('logout')).status, 200);
      return {status: true};
    }});
    assert.equal((await call('phone-otp-start')).status, 200);
    assert.equal((await call('phone-otp-check', {code: '123456'})).status, 400);
    assert.equal(env.db.prepare('SELECT phone_verified_at FROM public_accounts').get().phone_verified_at, null);
    assert.equal(env.db.prepare('SELECT consumed_at FROM public_phone_otp').get().consumed_at, null);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM rider_phone_accounts').get().n, 0);
  });

  test(`R09 ${role}: concurrent correct checks consume one proof only`, async t => {
    const {env, call} = await setup(t, role);
    let readers = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    smsProvider({verify: async () => {
      if (++readers === 2) release();
      await barrier;
      return {status: true};
    }});
    assert.equal((await call('phone-otp-start')).status, 200);
    // D1 serializes atomic batches; the local fixture uses one SQLite connection.
    const batch = env.DB.batch.bind(env.DB);
    let queue = Promise.resolve();
    env.DB.batch = items => {
      const next = queue.then(() => batch(items));
      queue = next.catch(() => {});
      return next;
    };
    const checked = await Promise.all([call('phone-otp-check', {code: '123456'}), call('phone-otp-check', {code: '123456'})]);
    assert.deepEqual(checked.map(response => response.status).sort(), [200, 400]);
    assert.ok(env.db.prepare('SELECT consumed_at FROM public_phone_otp').get().consumed_at);
    assert.equal(env.db.prepare('SELECT verification_method FROM public_accounts').get().verification_method, 'authentica_sms');
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM rider_phone_accounts').get().n, role === 'rider' ? 1 : 0);
  });
}

test('R09 failed SMS send leaves no challenge and rejects provider response details', async t => {
  const {env, call} = await setup(t);
  smsProvider({send: () => Response.json({secret: 'provider-private-probe'}, {status: 403})});
  const response = await call('phone-otp-start');
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /provider-private-probe|r09-offline-only|0500000091/);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM public_phone_otp').get().n, 0);
});

test('R09 resend cooldown does not use the hourly send quota', async t => {
  const {env, call} = await setup(t);
  const calls = smsProvider();
  assert.equal((await call('phone-otp-start')).status, 200);
  for (let n = 0; n < 4; n++) assert.equal((await call('phone-otp-start')).status, 429);
  assert.equal(calls.length, 1);
  assert.equal(env.db.prepare("SELECT n FROM access_rate_limits WHERE bucket LIKE 'otp:%'").get().n, 1);
});

test('R09 failed email delivery removes its link and reveals no provider body', async t => {
  const {env, sessionToken} = await setup(t);
  Object.assign(env, {RESEND_API_KEY: 'r09-email-offline-only', MISHWAR_EMAIL_FROM: 'offline@example.test'});
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    assert.ok(init.signal);
    return Response.json({message: 'email-provider-private-probe'}, {status: 503});
  };
  const response = await emailAuth(env, 'rider', {action: 'email-request-verification', sessionToken, clientIp: 'offline'});
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /email-provider-private-probe|r09-email-offline-only/);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM email_auth_tokens').get().n, 0);
});

test('R09 email stores only the token hash and rejects expired links without side effects', async t => {
  const {env, sessionToken} = await setup(t);
  Object.assign(env, {RESEND_API_KEY: 'r09-email-offline-only', MISHWAR_EMAIL_FROM: 'offline@example.test'});
  let token;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const mail = JSON.parse(init.body);
    token = mail.html.match(/email-verify=([a-f0-9]{64})/)[1];
    return Response.json({id: 'offline-delivery'});
  };
  const issued = await emailAuth(env, 'rider', {action: 'email-request-verification', sessionToken, clientIp: 'offline'});
  assert.equal(issued.status, 200);
  assert.doesNotMatch(await issued.text(), /email-verify=|r09-email-offline-only/);
  const row = env.db.prepare('SELECT * FROM email_auth_tokens').get();
  assert.equal(row.token_hash, await tokenHash(token));
  assert.notEqual(row.token_hash, token);
  assert.equal(row.target_email, 'r09@example.test');
  env.db.prepare('UPDATE email_auth_tokens SET expires_at=?').run('2000-01-01T00:00:00.000Z');
  const checked = await emailAuth(env, 'rider', {action: 'email-confirm', token, clientIp: 'offline'});
  assert.equal(checked.status, 400);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM verified_emails').get().n, 0);
  assert.equal(env.db.prepare('SELECT consumed_at FROM email_auth_tokens').get().consumed_at, null);
});

test('R09 legacy rider OTP expiring during provider verification creates no account or session', async t => {
  const env = makeEnv();
  t.after(() => env.db.close());
  Object.assign(env, {AUTHENTICA_API_KEY: 'r09-offline-only', AUTHENTICA_TEMPLATE_ID: '91'});
  const call = body => handleRiderAuth(new Request('https://offline.test/internal/rider-auth', {
    method: 'POST', headers: {'x-mishwar-key': 'test-rider-key'}, body: JSON.stringify(body)
  }), env);
  smsProvider({verify: () => {
    env.db.prepare('UPDATE phone_challenges SET expires_at=?').run('2000-01-01T00:00:00.000Z');
    return {status: true};
  }});
  const started = await call({action: 'start', name: 'Legacy offline R09', phone: '0500000092', clientIp: 'offline'});
  assert.equal(started.status, 200);
  const {challengeId} = await started.json();
  const checked = await call({action: 'check', challengeId, code: '123456'});
  assert.equal(checked.status, 400);
  assert.equal(env.db.prepare('SELECT status FROM phone_challenges').get().status, 'pending');
  for (const table of ['riders', 'rider_phone_accounts', 'rider_sessions', 'phone_challenge_uses'])
    assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
});

test('R09 concurrent legacy OTP checks create one identity and one session', async t => {
  const env = makeEnv();
  t.after(() => env.db.close());
  Object.assign(env, {AUTHENTICA_API_KEY: 'r09-offline-only', AUTHENTICA_TEMPLATE_ID: '91'});
  const call = body => handleRiderAuth(new Request('https://offline.test/internal/rider-auth', {
    method: 'POST', headers: {'x-mishwar-key': 'test-rider-key'}, body: JSON.stringify(body)
  }), env);
  let readers = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  smsProvider({verify: async () => {
    if (++readers === 2) release();
    await barrier;
    return {status: true};
  }});
  const started = await call({action: 'start', name: 'Legacy offline R09', phone: '0500000092', clientIp: 'offline'});
  assert.equal(started.status, 200);
  const {challengeId} = await started.json();
  const batch = env.DB.batch.bind(env.DB);
  let queue = Promise.resolve();
  env.DB.batch = items => {
    const next = queue.then(() => batch(items));
    queue = next.catch(() => {});
    return next;
  };
  const responses = await Promise.all([call({action: 'check', challengeId, code: '123456'}), call({action: 'check', challengeId, code: '123456'})]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  for (const table of ['riders', 'rider_phone_accounts', 'rider_sessions', 'phone_challenge_uses'])
    assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1);
  assert.equal(env.db.prepare('SELECT status FROM phone_challenges').get().status, 'consumed');
});
