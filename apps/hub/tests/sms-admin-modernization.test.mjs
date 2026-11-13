import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeEnv} from './fixtures.mjs';
import {freeAuth,manualPhoneAdmin,publicSession} from '../worker/free-auth.js';
import {handleAdmin} from '../worker/admin.js';

const mobile='0505550015';
const register=async env=>{
  const r=await freeAuth(env,'captain',{action:'register',name:'كابتن نظام التحقق',phone:mobile,password:'goodPass99',clientIp:'test-otp'});
  assert.equal(r.status,201);return (await r.json()).sessionToken;
};

test('Legacy WhatsApp approval is disabled unless explicitly enabled; SMS remains self-service',async()=>{
  const env=makeEnv(),token=await register(env);
  const session=await publicSession(env,token,'captain');
  const r=await manualPhoneAdmin(new Request('https://hub.example/api/admin/phone-verifications',{method:'POST',headers:{origin:'https://hub.example','content-type':'application/json'},body:JSON.stringify({actor:session.actor,role:'captain',code:'000000',confirmContact:true,method:'whatsapp'})}),env);
  assert.equal(r.status,410);
  assert.equal((await publicSession(env,token,'captain')).phoneVerified,false);
  const admin=await handleAdmin(new Request('https://hub.example/api/admin/phone-verifications',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'admin@example.com'}}),env);
  const body=await admin.json();assert.equal(body.smsConfigured,false);assert.equal(body.items.length,1);
  assert.equal(body.items[0].phone_verified_at,null);assert.equal(body.items[0].otp_active,0);
});

test('Captain password stays at least six characters while OTP UI accepts four',()=>{
  const src=readFileSync(new URL('../public/captain-auth.js',import.meta.url),'utf8');
  assert.match(src,/minlength="6" maxlength="128"/);
  assert.match(src,/maxlength="4" pattern="\[0-9\]\{4\}"/);
  const admin=readFileSync(new URL('../../admin/public/phone-verifications.js',import.meta.url),'utf8');
  assert.doesNotMatch(admin,/data-verify-phone|verify-phone-form|verification-whatsapp|واعتِماد التوثيق عبر واتساب/);
  assert.match(admin,/مراقبة توثيق SMS/);
});
