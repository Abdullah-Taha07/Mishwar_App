import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {freeAuth} from '../worker/free-auth.js';

async function newAccount(env,role,phone){
 const r=await freeAuth(env,role,{action:'register',name:'اختبار توثيق مشوار',phone,password:'strongpass',email:role+'@example.test',clientIp:'test'});
 assert.equal(r.status,201);
 return (await r.json()).sessionToken;
}
const run=(env,role,token,action,code)=>freeAuth(env,role,{action,sessionToken:token,code});
test('Authentica verifies rider and captain without exposing codes or API key',async()=>{
 const env=makeEnv();Object.assign(env,{AUTHENTICA_API_KEY:'fake-key',AUTHENTICA_TEMPLATE_ID:'91'});
 const sent=[];const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(options.headers['X-Authorization'],'fake-key');if(String(url).endsWith('/send-otp')){sent.push(body);return Response.json({success:true})}return Response.json({status:body.otp==='123456'})};
 try{
  for(const [role,phone] of [['rider','0501234567'],['captain','0501234568']]){
   const token=await newAccount(env,role,phone);
   assert.equal((await run(env,role,token,'phone-otp-check','123456')).status,400);
   const start=await run(env,role,token,'phone-otp-start');assert.equal(start.status,200,await start.text());
   assert.equal((await run(env,role,token,'phone-otp-start')).status,429);
   assert.equal((await run(env,role,token,'phone-otp-check','000000')).status,400);
   assert.equal((await run(env,role,token,'phone-otp-check','123456')).status,200);
   assert.equal((await run(env,role,token,'phone-otp-check','123456')).status,400);
   const session=await(await run(env,role,token,'session')).json();assert.equal(session.phoneVerified,true);assert.equal(session.verificationCode,null);
   assert.equal(env.db.prepare('SELECT verification_method FROM public_accounts WHERE role=?').get(role).verification_method,'authentica_sms');
  }
  assert.equal(sent.length,2);assert.equal(sent[0].template_id,91);
 }finally{globalThis.fetch=original}
});
test('Authentica fails closed without a configured template',async()=>{
 const env=makeEnv();env.AUTHENTICA_API_KEY='fake-key';const token=await newAccount(env,'captain','0501234567');
 const r=await run(env,'captain',token,'phone-otp-start');assert.equal(r.status,503);
});
