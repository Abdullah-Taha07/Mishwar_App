import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import handler from '../api/[...path].js';

const nativeFetch=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=nativeFetch});
const env={HUB_URL:'https://offline-hub.test',HUB_SERVICE_KEY:'offline-key'};
const request=(body,cookie='')=>new Request('https://rider.test/api/live',{method:'POST',headers:{host:'rider.test',origin:'https://rider.test','content-type':'application/json',cookie,'oai-authenticated-user-id':'victim','oai-authenticated-user-email':'private@example.test'},body:JSON.stringify(body)});

test('rider worker ignores platform identity headers and responds as guest without a cookie',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No hub call allowed for guest')};
 const response=await worker.fetch(request({action:'live_session',actor:'victim',sessionToken:'f'.repeat(64)}),env);assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.guest,true);assert.equal(data.accountKey,null);assert.equal(data.trip,null);assert.equal(data.wallet.balance,0);assert.equal(calls,0);
 assert.equal((await worker.fetch(request({action:'live_book',actor:'victim'}),env)).status,401);
});

test('rider worker forwards cookie credentials and clears all client-supplied identity fields',async()=>{
 let body;globalThis.fetch=async(url,options)=>{assert.equal(url,'https://offline-hub.test/internal/live-rider');body=JSON.parse(options.body);return Response.json({accountKey:'opaque-key',verified:true,trip:null})};
 const token='a'.repeat(64);await worker.fetch(request({action:'live_session',actor:'forged',platformActor:'forged',email:'forged@example.test',sessionToken:'f'.repeat(64)},'__Host-mishwar_sid='+token),env);
 assert.equal(body.sessionToken,token);assert.equal(body.actor,'');assert.equal(body.platformActor,'');assert.equal(body.email,'');
});

test('Vercel adapter cannot turn arbitrary incoming identity headers into a private rider session',async()=>{
 const previous={HUB_URL:process.env.HUB_URL,HUB_SERVICE_KEY:process.env.HUB_SERVICE_KEY};Object.assign(process.env,env);
 let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Unexpected network')};
 const headers={};let payload;const res={statusCode:0,setHeader:(name,value)=>headers[name.toLowerCase()]=value,end:value=>payload=value};
 try{
  await handler({url:'/api/live',method:'POST',headers:{host:'rider.test',origin:'https://rider.test','content-type':'application/json','oai-authenticated-user-id':'victim','oai-authenticated-user-email':'private@example.test'},body:{action:'live_session',actor:'victim'}},res);
  assert.equal(res.statusCode,200);assert.equal(JSON.parse(payload.toString()).guest,true);assert.equal(calls,0);
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
