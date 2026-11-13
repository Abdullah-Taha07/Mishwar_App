import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeEnv } from './fixtures.mjs';
import { handleDriver } from '../worker/commerce.js';
import worker from '../worker/index.js';
import { freeAuth } from '../worker/free-auth.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const origin='https://mishwar-api.abduuallah3.workers.dev';

// Public clients cannot spoof the otherwise-internal identity header.
test('public captain driver endpoint rejects untrusted identity header without a session', async()=>{
  const env=makeEnv(true);
  env.db.prepare("UPDATE captain_applications SET status='active'").run();
  const request=new Request(origin+'/api/driver',{
    method:'POST',
    headers:{origin, 'content-type':'application/json','oai-authenticated-user-id':'qa-applicant'},
    body:JSON.stringify({action:'available',available:true,lat:24.7,lng:46.6,accuracy:5})
  });
  const response=await worker.fetch(request,env,{});
  assert.equal(response.status,401);
  assert.equal((await response.json()).error,'سجل الدخول');
});

test('captain availability is persisted and returned without turning on for invalid GPS',async()=>{
 const env=makeEnv(true);
 env.db.prepare("UPDATE captain_applications SET status='active'").run();
 const request=(available,accuracy)=>new Request(origin+'/api/driver',{
   method:'POST',headers:{origin,'content-type':'application/json','oai-authenticated-user-id':'qa-applicant'},
   body:JSON.stringify({action:'available',available,lat:24.7,lng:46.6,accuracy})
 });
 let r=await handleDriver(request(true,999),env,{});
 assert.notEqual(r.status,200);
 r=await handleDriver(request(true,5),env,{});
 assert.equal(r.status,200,await r.text());
 const db=env.db.prepare('SELECT available FROM captain_presence').get();
 assert.equal(db.available,1);
 r=await handleDriver(request(false,5),env,{});
 assert.equal(r.status,200);
 assert.equal((await r.json()).available,false);
 assert.equal(env.db.prepare('SELECT available FROM captain_presence').get().available,0);
});

test('captain dashboard adapts sheet, preserves account details, and polls pending decisions',()=>{
  assert.match(source('../public/driver.css'),/driver-panel/);
  assert.match(source('../public/driver-responsive.css'),/driver-grab/);
  assert.match(source('../public/dashboard.html'),/driver-responsive\.css/);
  assert.match(source('../public/driver.js'),/data-persist="captain-info"/);
  assert.match(source('../public/driver.js'),/window\.startCaptainGPS/);
  assert.match(source('../public/onboarding.js'),/startStatusPolling/);
  assert.match(source('../public/captain-auth.js'),/pollCaptainVerification/);
  assert.match(source('../../admin/public/phone-verifications.js'),/setInterval/);
});


test('SMS-verified captain session can enable availability end-to-end through public Worker',async()=>{
 const env=makeEnv(true);
 const registered=await freeAuth(env,'captain',{action:'register',name:'كابتن اختبارات التجربة',phone:'0507654321',password:'correcthorsebattery',email:'newcaptain@example.test',clientIp:'captain-integration'});
 assert.equal(registered.status,201);
 const {sessionToken}=await registered.json();
 const actor=env.db.prepare("SELECT actor FROM public_accounts WHERE role='captain'").get().actor;
 env.db.prepare("UPDATE public_accounts SET phone_verified_at=? WHERE actor=?").run(new Date().toISOString(),actor);
 env.db.prepare("UPDATE captain_applications SET status='active',user_id=?").run(actor);
 const response=await worker.fetch(new Request(origin+'/api/driver',{
   method:'POST',headers:{origin,'content-type':'application/json','cookie':'__Host-mishwar_captain='+sessionToken},
   body:JSON.stringify({action:'available',available:true,lat:24.7,lng:46.6,accuracy:10})
 }),env,{});
 assert.equal(response.status,200,await response.clone().text());
 assert.deepEqual(await response.json(),{ok:true,available:true});
 assert.equal(env.db.prepare('SELECT available FROM captain_presence').get().available,1);
});
