import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{canonicalClientIp} from '../worker/index.js';
import adapter from '../api/[...path].js';
const nativeFetch=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=nativeFetch});
const env={HUB_URL:'https://hub.test',HUB_SERVICE_KEY:'local-service-key',HUB_ACCESS_TOKEN:'local-gateway-fixture'};
const trusted={trustedClientIp:'192.0.2.5'};
const cookie='__Host-mishwar_sid='+'a'.repeat(64);
const request=(path,body,extra={})=>new Request('https://rider.test'+path,{method:body?'POST':'GET',headers:{origin:'https://rider.test','content-type':'application/json',cookie,...extra},...(body?{body:JSON.stringify(body)}:{})});
test('every rider upstream route uses server credentials and forbids redirects and identity claims',async()=>{
 const seen=[];globalThis.fetch=async(url,init)=>{seen.push({url,init});return Response.json({ok:true})};
 for(const [path,body] of [['/api/shared-trip?token=fixture'],['/api/service-status'],['/api/map-config'],['/api/places?q=test&lat=24.7&lon=46.6'],['/api/places/reverse?lat=24.7&lon=46.6'],['/api/auth/session'],['/api/background'],['/api/estimate',{pickup:{},destination:{},clientIp:'forged'}],['/api/live',{action:'live_session',actor:'forged',platformActor:'forged',sessionToken:'forged'}]]){
  assert.equal((await worker.fetch(request(path,body,{'OAI-Sites-Authorization':'forged','x-mishwar-key':'forged','cf-connecting-ip':'198.51.100.99'}),env,trusted)).status,200);
 }
 assert.equal(seen.length,9);
 for(const {init} of seen){assert.equal(init.headers['x-mishwar-key'],env.HUB_SERVICE_KEY);assert.equal(init.headers['OAI-Sites-Authorization'],'Bearer '+env.HUB_ACCESS_TOKEN);assert.equal(init.redirect,'error');if(init.body){const body=JSON.parse(init.body);assert.equal(body.clientIp,trusted.trustedClientIp);if('actor'in body)assert.equal(body.actor,'')}}
});
test('missing platform IP fails closed for cost-limited anonymous operations, never trusts HTTP claims',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({ok:true})};
 for(const [path,body] of [['/api/estimate',{clientIp:'192.0.2.1'}],['/api/auth/password-login',{phone:'0500000001',password:'invalid'}],['/api/places?q=test']]){
  const r=await worker.fetch(request(path,body,{'cf-connecting-ip':'192.0.2.1','x-vercel-forwarded-for':'192.0.2.2'}),env);assert.equal(r.status,503);assert.equal((await r.json()).code,'CLIENT_IP_UNAVAILABLE');
 }
 assert.equal(calls,0);
});
test('Cloudflare metadata and private Node context are the only accepted IP sources',async()=>{
 let body;globalThis.fetch=async(_,init)=>{body=JSON.parse(init.body);return Response.json({ok:true})};
 const req=request('/api/estimate',{}, {'cf-connecting-ip':'2001:0db8:0:0:0:0:0:1'});Object.defineProperty(req,'cf',{value:{colo:'local-fixture'}});
 assert.equal((await worker.fetch(req,env)).status,200);assert.equal(body.clientIp,'2001:db8::1');
 assert.equal(canonicalClientIp('192.000.002.005'),'192.0.2.5');
 for(const bad of ['192.0.2.1, 198.51.100.1','999.1.1.1','1.2.3.4:80','fe80::1%eth0','garbage'])assert.equal(canonicalClientIp(bad),'');
});
test('Node ignores spoofed proxy/CF headers and uses Vercel metadata only in its server runtime',async()=>{
 const keys=['HUB_URL','HUB_SERVICE_KEY','HUB_ACCESS_TOKEN','VERCEL'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const calls=[];globalThis.fetch=async(_,init)=>{calls.push(JSON.parse(init.body));return Response.json({ok:true})};
 const run=async(headers,socket)=>{let body;const res={statusCode:0,setHeader(){},end(value){body=value}};await adapter({url:'/api/estimate',method:'POST',headers:{host:'rider.test',origin:'https://rider.test','content-type':'application/json',...headers},socket,body:{clientIp:'forged'}},res);return {status:res.statusCode,body}};
 try{
  Object.assign(process.env,env);delete process.env.VERCEL;
  await run({'cf-connecting-ip':'198.51.100.1','x-vercel-forwarded-for':'198.51.100.2'},{remoteAddress:'192.0.2.10'});assert.equal(calls.at(-1).clientIp,'192.0.2.10');
  process.env.VERCEL='1';await run({'x-vercel-forwarded-for':'192.0.2.20','cf-connecting-ip':'198.51.100.1'},{remoteAddress:'192.0.2.10'});assert.equal(calls.at(-1).clientIp,'192.0.2.20');
  assert.equal((await run({'x-vercel-forwarded-for':'192.0.2.1, 192.0.2.2'},{remoteAddress:'192.0.2.10'})).status,503);
 }finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
test('non-JSON gateway responses cannot become successful API payloads; cross-site mutations never forward',async()=>{
 globalThis.fetch=async()=>new Response('<html>gateway login</html>',{headers:{'content-type':'text/html'}});
 assert.equal((await worker.fetch(request('/api/shared-trip?token=x'),env,trusted)).status,502);
 assert.equal((await worker.fetch(request('/api/auth/session'),env,trusted)).status,502);
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({})};
 assert.equal((await worker.fetch(request('/api/live',{action:'live_book'},{origin:'https://evil.test'}),env,trusted)).status,403);assert.equal(calls,0);
});
test('malformed JSON shapes are rejected and upstream retry budgets are preserved without forwarding arbitrary headers',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'limited'},{status:429,headers:{'Retry-After':'900','x-private-fixture':'must-not-forward'}})};
 for(const body of ['null','[]','7','"text"'])assert.equal((await worker.fetch(new Request('https://rider.test/api/auth/register',{method:'POST',headers:{origin:'https://rider.test'},body}),env,trusted)).status,400);
 assert.equal(calls,0);
 for(const path of ['/api/auth/session','/api/service-status']){const r=await worker.fetch(request(path),env,trusted);assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'900');assert.equal(r.headers.get('x-private-fixture'),null)}
});
