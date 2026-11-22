import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from '../../hub/tests/fixtures.mjs';
import {handleRiderAuth} from '../../hub/worker/rider-auth.js';
import riderGateway from '../worker/index.js';

// This suite exercises the real rider gateway, shared Worker auth handler and
// migration-backed SQLite fixture. All upstream calls are trapped locally:
// no production database, SMS, payment, mail or network call can be made.
const SITE='https://rider.offline.test';
const HUB='https://hub.offline.test';
const FIXTURE_IP='198.51.100.42';
const tokenFromCookie=header => header?.match(/__Host-mishwar_sid=([a-f0-9]{64})/)?.[1] ?? null;

function setup(t){
  const db=makeEnv();
  t.after(()=>db.db.close());
  const gatewayEnv={HUB_URL:HUB,HUB_SERVICE_KEY:db.RIDER_SERVICE_KEY};
  const originalFetch=globalThis.fetch;
  let provider=null;
  const upstream=[];
  globalThis.fetch=async(url,options={})=>{
    if(String(url)===HUB+'/internal/rider-auth'){
      upstream.push({method:options.method,redirect:options.redirect});
      assert.equal(options.method,'POST');
      assert.equal(options.redirect,'error','Vercel Node gateway must not follow redirects');
      assert.equal(options.headers['x-mishwar-key'],db.RIDER_SERVICE_KEY);
      const req=new Request(HUB+'/internal/rider-auth',{method:'POST',headers:options.headers,body:options.body});
      return handleRiderAuth(req,db);
    }
    if(provider && String(url).startsWith('https://api.authentica.sa/api/v2/')){
      return provider(String(url),options);
    }
    throw Error('NETWORK_BLOCKED_BY_OFFLINE_RIDER_AUTH_TEST');
  };
  t.after(()=>{globalThis.fetch=originalFetch});
  async function call(action,body={},session=''){
    const request=new Request(SITE+'/api/auth/'+action,{
      method:'POST',
      headers:{'Origin':SITE,'Content-Type':'application/json',...(session?{'Cookie':'__Host-mishwar_sid='+session}:{})},
      body:JSON.stringify(body)
    });
    const response=await riderGateway.fetch(request,gatewayEnv,{trustedClientIp:FIXTURE_IP});
    const json=await response.json();
    return {response,json,token:tokenFromCookie(response.headers.get('Set-Cookie'))};
  }
  return {db,call,upstream,setProvider:p=>{provider=p}};
}

const REGISTER={name:'Offline Rider QA',phone:'0509887766',email:'rider-test@example.test',password:'local-only-password-123'};

async function register(f){
  const r=await f.call('register',REGISTER);
  assert.equal(r.response.status,201,JSON.stringify(r.json));
  assert.equal(r.json.authenticated,true);
  assert.equal(r.json.phoneVerified,false);
  assert.equal(r.json.sessionToken,undefined,'session token must never reach frontend JSON');
  assert.match(r.response.headers.get('Set-Cookie')||'',/HttpOnly/i);
  assert.match(r.response.headers.get('Set-Cookie')||'',/Secure/i);
  assert.match(r.response.headers.get('Set-Cookie')||'',/SameSite=Lax/i);
  assert.match(r.token||'',/^[a-f0-9]{64}$/);
  return r.token;
}

test('RIDER-002/003: register -> private cookie session -> login rotates token -> logout revokes it',async t=>{
  const f=setup(t);
  const initial=await f.call('session');
  assert.equal(initial.response.status,200);
  assert.equal(initial.json.authenticated,false);
  const first=await register(f);
  const before=await f.call('session',{},first);
  assert.equal(before.response.status,200);
  assert.equal(before.json.authenticated,true);
  assert.equal(before.json.phoneVerified,false);
  assert.ok(before.json.accountKey);
  assert.equal(before.json.profile.name,REGISTER.name);
  const wrong=await f.call('password-login',{phone:REGISTER.phone,password:'definitely-wrong'});
  assert.equal(wrong.response.status,400);
  assert.equal(wrong.token,null);
  assert.equal((await f.call('session',{},first)).json.authenticated,true);
  const login=await f.call('password-login',{phone:REGISTER.phone,password:REGISTER.password});
  assert.equal(login.response.status,200,JSON.stringify(login.json));
  assert.ok(login.token&&login.token!==first,'login must rotate the session');
  assert.equal((await f.call('session',{},first)).json.authenticated,false,'old session must be revoked');
  assert.equal((await f.call('session',{},login.token)).json.authenticated,true);
  const logout=await f.call('logout',{},login.token);
  assert.equal(logout.response.status,200,JSON.stringify(logout.json));
  assert.equal(logout.json.ok,true);
  assert.match(logout.response.headers.get('Set-Cookie')||'',/Max-Age=0/i);
  assert.equal((await f.call('session',{},login.token)).json.authenticated,false);
  assert.ok(f.upstream.length>=8);
});

test('RIDER-003: recovery remains pending without a verified administrative approval',async t=>{
  const f=setup(t);
  const active=await register(f);
  const started=await f.call('recovery-start',{phone:REGISTER.phone});
  assert.equal(started.response.status,200,JSON.stringify(started.json));
  assert.match(started.json.recoveryToken||'',/^[a-f0-9]{64}$/);
  assert.match(started.json.code||'',/^\d{6}$/);
  const status=await f.call('recovery-status',{recoveryToken:started.json.recoveryToken});
  assert.equal(status.response.status,200);
  assert.equal(status.json.status,'pending');
  const forbidden=await f.call('recovery-finish',{recoveryToken:started.json.recoveryToken,password:'replacement-local-password-123'});
  assert.notEqual(forbidden.response.status,200,'pending recovery must never reset the password');
  assert.equal((await f.call('session',{},active)).json.authenticated,true,'failed recovery must preserve a valid session');
});

test('RIDER-003: fake Authentica OTP verifies the rider only after the correct challenge',async t=>{
  const f=setup(t);
  f.db.AUTHENTICA_API_KEY='offline-fake-key';
  f.db.AUTHENTICA_TEMPLATE_ID='91';
  let sends=0,checks=0;
  f.setProvider((url,options)=>{
    assert.equal(options.headers['X-Authorization'],'offline-fake-key');
    const body=JSON.parse(options.body);
    if(url.endsWith('/send-otp')){sends++;assert.equal(body.template_id,91);return Response.json({success:true})}
    if(url.endsWith('/verify-otp')){checks++;return Response.json({verified:body.otp==='246810'})}
    throw Error('UNEXPECTED_OFFLINE_SMS_ENDPOINT');
  });
  const token=await register(f);
  assert.equal((await f.call('session',{},token)).json.phoneVerified,false);
  const send=await f.call('phone-otp-start',{},token);
  assert.equal(send.response.status,200,JSON.stringify(send.json));
  assert.equal(sends,1);
  const cooldown=await f.call('phone-otp-start',{},token);
  assert.equal(cooldown.response.status,429);
  assert.equal(sends,1,'cooldown must not send a second SMS');
  const bad=await f.call('phone-otp-check',{code:'000000'},token);
  assert.notEqual(bad.response.status,200);
  const valid=await f.call('phone-otp-check',{code:'246810'},token);
  assert.equal(valid.response.status,200,JSON.stringify(valid.json));
  const after=await f.call('session',{},token);
  assert.equal(after.json.phoneVerified,true);
  assert.equal(sends,1);
  assert.equal(checks,2);
  const replay=await f.call('phone-otp-check',{code:'246810'},token);
  assert.notEqual(replay.response.status,200,'OTP cannot be consumed twice');
});

test('RIDER-004 security regression: logout must fail closed if durable public-session revocation fails',async t=>{
  const f=setup(t);
  const token=await register(f);
  assert.equal((await f.call('session',{},token)).json.authenticated,true);
  const realBatch=f.db.DB.batch;
  f.db.DB.batch=async()=>{throw Error('SIMULATED_LOCAL_D1_REVOCATION_FAILURE')};
  try{
    const result=await f.call('logout',{},token);
    assert.notEqual(result.response.status,200,'failed revocation cannot claim logout success');
    assert.equal(result.json.ok,undefined,'failed revocation must not report ok:true');
    assert.equal(result.response.headers.get('Set-Cookie'),null,'gateway must not clear cookie after failure');
    assert.equal((await f.call('session',{},token)).json.authenticated,true,'existing session still exists after failed batch');
  }finally{f.db.DB.batch=realBatch}
  const success=await f.call('logout',{},token);
  assert.equal(success.response.status,200,JSON.stringify(success.json));
  assert.equal((await f.call('session',{},token)).json.authenticated,false);
});
