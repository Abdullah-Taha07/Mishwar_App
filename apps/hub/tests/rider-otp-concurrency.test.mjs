import test from 'node:test';
import assert from 'node:assert/strict';
import {makeEnv} from './fixtures.mjs';
import {freeAuth} from '../worker/free-auth.js';

async function account(env,phone='0501234567'){
  const registered=await freeAuth(env,'rider',{
    action:'register',name:'Offline OTP Race Test',phone,
    email:'offline-otp-'+phone+'@example.test',password:'offline-safe-password',clientIp:'offline-test'
  });
  const body=await registered.json();
  assert.equal(registered.status,201,JSON.stringify(body));
  return body.sessionToken;
}
const request=(env,token)=>freeAuth(env,'rider',{action:'phone-otp-start',sessionToken:token});

test('RIDER-006 concurrent OTP requests produce one provider send and one pending challenge',async t=>{
  const env=makeEnv();t.after(()=>env.db.close());
  env.AUTHENTICA_API_KEY='fake-only';env.AUTHENTICA_TEMPLATE_ID='91';
  const token=await account(env);
  const original=globalThis.fetch;
  let calls=0,releaseProvider;
  const hold=new Promise(resolve=>{releaseProvider=resolve});
  let started;const entered=new Promise(resolve=>{started=resolve});
  globalThis.fetch=async (url,options)=>{
    assert.match(String(url),/\/send-otp$/);
    assert.equal(options.headers['X-Authorization'],'fake-only');
    calls++;started();
    await hold;
    return Response.json({success:true});
  };
  let first,second;
  try{
    first=request(env,token);
    await entered; // The first request has the DB lease and is waiting on a fake provider.
    second=request(env,token);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(calls,1,'A second concurrent request must not call the SMS provider');
    releaseProvider();
    const [one,two]=await Promise.all([first,second]);
    assert.equal(one.status,200,await one.text());
    assert.equal(two.status,429,await two.text());
    assert.equal(calls,1);
    const attempts=env.db.prepare("SELECT n FROM access_rate_limits WHERE bucket LIKE 'otp:%' AND bucket NOT LIKE 'otp:send-lease:%'").all();
    assert.equal(attempts.length,1);
    assert.equal(attempts[0].n,1,'The rejected concurrent retry must not use hourly SMS quota');
    const challenges=env.db.prepare('SELECT id,consumed_at FROM public_phone_otp WHERE role=?').all('rider');
    assert.equal(challenges.length,1);
    assert.equal(challenges[0].consumed_at,null);
  }finally{
    releaseProvider();
    if(first||second)await Promise.allSettled([first,second].filter(Boolean));
    globalThis.fetch=original;
  }
});

test('RIDER-006 provider refusal retains a short send lease and never creates a false OTP challenge',async t=>{
  const env=makeEnv();t.after(()=>env.db.close());
  env.AUTHENTICA_API_KEY='fake-only';env.AUTHENTICA_TEMPLATE_ID='91';
  const token=await account(env,'0501234568');
  const original=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async()=>{requests++;return Response.json({error:'offline provider declined'},{status:503})};
  try{
    const first=await request(env,token);
    assert.notEqual(first.status,200);
    const second=await request(env,token);
    assert.equal(second.status,429,'Do not retry an uncertain provider send immediately');
    assert.equal(requests,1);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM public_phone_otp').get().n,0);
  }finally{globalThis.fetch=original}
});
