import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {sendAuthenticaOtp,verifyAuthenticaOtp} from '../worker/authentica.js';

test('SMS send handler survives currentTarget becoming null after await', async () => {
  const script=readFileSync(new URL('../public/captain-auth.js',import.meta.url),'utf8');
  let html='';let sendButton={disabled:false,isConnected:true,textContent:'إرسال رمز SMS'};
  const status={textContent:'',isConnected:true};
  const otpForm={};
  const back={};const refresh={};const logout={};
  const elements={'#captain-send-otp':sendButton,'#captain-otp-status':status,'#captain-otp-form':otpForm,'#captain-pending-back':back,'#refresh-account':refresh,'#logout-account':logout};
  const app={set innerHTML(v){html=v},get innerHTML(){return html}};
  const document={hidden:true,querySelector(q){return q==='#app'?app:elements[q]||null}};
  const window={};
  const fetch=async(url)=>Response.json({authenticated:true,phoneVerified:false,smsConfigured:true,profile:{name:'QA',phone:'+966500000000'}});
  const requests=[];
  const mockFetch=async(url)=>{requests.push(url);return Response.json(url.includes('phone-otp-start')?{ok:true,retryAfter:60}:{authenticated:true,phoneVerified:false,smsConfigured:true,profile:{name:'QA',phone:'+966500000000'}})};
  const timers=[];
  runInNewContext(script,{window,document,fetch:mockFetch,localStorage:{getItem(){return null}},location:{reload(){}},console,setInterval(fn){timers.push(fn);return timers.length},clearInterval(){},setTimeout(){},Response,JSON});
  await window.ensureCaptainAccount();
  assert.match(html,/captain-otp-form/);
  const event={currentTarget:sendButton};
  const result=sendButton.onclick(event);
  event.currentTarget=null; // Browser clears currentTarget after dispatch, before async response.
  await result;
  assert.match(status.textContent,/تم طلب إرسال الرمز/);
  assert.match(sendButton.textContent,/إعادة الإرسال بعد/);
  assert.equal(sendButton.disabled,true);
  assert.equal(requests.filter(x=>x.includes('phone-otp-start')).length,1);
});

test('Authentica v2 verified result is recognized, not confused with transport success',async()=>{
  const original=globalThis.fetch;
  const env={AUTHENTICA_API_KEY:'fake-only',AUTHENTICA_TEMPLATE_ID:'5'};
  try{
    globalThis.fetch=async()=>Response.json({verified:true});
    assert.equal(await verifyAuthenticaOtp(env,'+966500000000','1234'),true);
    globalThis.fetch=async()=>Response.json({status:'verified'});
    assert.equal(await verifyAuthenticaOtp(env,'+966500000000','1234'),true);
    globalThis.fetch=async()=>Response.json({success:true});
    assert.equal(await verifyAuthenticaOtp(env,'+966500000000','1234'),false);
  }finally{globalThis.fetch=original}
});
