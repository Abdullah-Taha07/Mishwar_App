import test from 'node:test';
import assert from 'node:assert/strict';
import hub from '../worker/index.js';
import {freeAuth} from '../worker/free-auth.js';
import {makeEnv} from './fixtures.mjs';

const configuredOrigin='https://captain-preview.test';
const post=(path,origin,body={},cookie='')=>new Request('https://hub.test'+path,{
  method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify(body),
});

test('a configured browser origin passes preflight and reaches captain login business validation',async t=>{
  const env=makeEnv();t.after(()=>env.db.close());env.PUBLIC_API_ORIGINS=configuredOrigin;
  const preflight=await hub.fetch(new Request('https://hub.test/api/auth/password-login',{
    method:'OPTIONS',headers:{origin:configuredOrigin,'access-control-request-method':'POST','access-control-request-headers':'content-type'},
  }),env,{});
  assert.equal(preflight.status,204);
  const response=await hub.fetch(post('/api/auth/password-login',configuredOrigin,{phone:'0500000019',password:'short'}),env,{});
  assert.equal(response.status,400,'a permitted origin reaches password validation, rather than a second conflicting CORS guard');
  assert.match((await response.json()).error,/كلمة مرور/);
  assert.equal(response.headers.get('access-control-allow-origin'),configuredOrigin);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM public_accounts').get().n,0);
  const denied=await hub.fetch(post('/api/auth/password-login',configuredOrigin+'.evil.test',{phone:'0500000019',password:'short'}),env,{});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get('access-control-allow-origin'),null);
});

test('a configured browser origin reaches authenticated captain application validation without broadening ownership',async t=>{
  const env=makeEnv();t.after(()=>env.db.close());env.PUBLIC_API_ORIGINS=configuredOrigin;
  const registered=await freeAuth(env,'captain',{action:'register',name:'Local captain fixture',phone:'0500000029',password:'local-fixture-password',clientIp:'192.0.2.29'});
  assert.equal(registered.status,201);
  const {sessionToken}=await registered.json();
  // A verified-phone fixture avoids sending SMS; production still needs a verified session.
  env.db.prepare('UPDATE public_accounts SET phone_verified_at=?').run(new Date().toISOString());
  const cookie='__Host-mishwar_captain='+sessionToken;
  const response=await hub.fetch(post('/api/application',configuredOrigin,{},cookie),env,{});
  assert.equal(response.status,400,'a permitted origin reaches the multipart/document validator');
  assert.match((await response.json()).error,/المستندات/);
  assert.equal(response.headers.get('access-control-allow-origin'),configuredOrigin);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM captain_applications').get().n,0);
  const anonymous=await hub.fetch(post('/api/application',configuredOrigin),env,{});
  assert.equal(anonymous.status,401,'CORS permission does not replace session ownership');
  const denied=await hub.fetch(post('/api/application','https://evil.test',{},cookie),env,{});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get('access-control-allow-origin'),null);
});
