import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {freeAuth} from '../worker/free-auth.js';
import worker from '../dist/server/index.js';
const origin='https://mishwar-api.abduuallah3.workers.dev';

test('captain dashboard requires a verified cookie and cannot be accessed with a forged public identity header',async()=>{
  const env=makeEnv(true);
  const registration=await freeAuth(env,'captain',{
    action:'register', name:'Test Captain', phone:'0507654321',
    password:'correcthorsebattery', email:'dashboard-cookie@example.test',clientIp:'test'
  });
  assert.equal(registration.status,201,await registration.clone().text());
  const {sessionToken}=await registration.json();
  const actor=env.db.prepare("SELECT actor FROM public_accounts WHERE role='captain' AND phone=?").get('+966507654321').actor;
  env.db.prepare('UPDATE public_accounts SET phone_verified_at=? WHERE actor=?').run(new Date().toISOString(),actor);
  env.db.prepare("UPDATE captain_applications SET status='active',user_id=?").run(actor);
  const forged=await worker.fetch(new Request(origin+'/dashboard',{headers:{'oai-authenticated-user-id':actor}}),env,{});
  assert.equal(forged.status,302);
  const verifiedSession=await worker.fetch(new Request(origin+'/dashboard',{headers:{cookie:'__Host-mishwar_captain='+sessionToken}}),env,{});
  assert.equal(verifiedSession.status,200);
  assert.match(verifiedSession.headers.get('content-type')||'',/text\/html/);
  const directHtml=await worker.fetch(new Request(origin+'/dashboard.html',{headers:{cookie:'__Host-mishwar_captain='+sessionToken}}),env,{});
  assert.equal(directHtml.status,200);
  const absent=await worker.fetch(new Request(origin+'/dashboard'),env,{});
  assert.equal(absent.status,302);
});
