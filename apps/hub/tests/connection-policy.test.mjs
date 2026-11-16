import test from 'node:test';
import assert from 'node:assert/strict';
import hub from '../dist/server/index.js';
import {makeEnv} from './fixtures.mjs';
import {freeAuth} from '../worker/free-auth.js';
import {routeEstimate} from '../worker/routing.js';
test('CORS allows only exact configured or same origins and rejects identity/service headers in preflight',async()=>{
 const env=makeEnv(true);env.PUBLIC_API_ORIGINS='https://approved.test';
 const preflight=(origin,headers='content-type',method='POST')=>hub.fetch(new Request('https://hub.test/api/auth/session',{method:'OPTIONS',headers:{origin,'access-control-request-method':method,'access-control-request-headers':headers}}),env,{});
 for(const origin of ['https://approved.test','https://mishwar-captain.vercel.app','https://hub.test']){const r=await preflight(origin);assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.match(r.headers.get('vary'),/Origin/)}
 for(const [origin,headers,method] of [['https://evil.test'],['https://approved.test.evil.test'],['https://approved.test','x-mishwar-key'],['https://approved.test','oai-authenticated-user-id'],['https://approved.test','content-type','DELETE']])assert.equal((await preflight(origin,headers,method)).status,403);
 const denied=await hub.fetch(new Request('https://hub.test/api/auth/session',{headers:{origin:'https://evil.test'}}),env,{});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 env.db.close();
});
test('accounts sharing a network have independent login budgets and rotating IP cannot reset account limits',async()=>{
 const env=makeEnv();
 for(let i=0;i<45;i++){const r=await freeAuth(env,'rider',{action:'password-login',phone:'0500'+String(i).padStart(6,'0'),password:'short',clientIp:'192.0.2.1'});assert.equal(r.status,400)}
 for(let i=0;i<40;i++)assert.equal((await freeAuth(env,'rider',{action:'password-login',phone:'0555555555',password:'short',clientIp:'192.0.2.'+(i+1)})).status,400);
 const limited=await freeAuth(env,'rider',{action:'password-login',phone:'0555555555',password:'short',clientIp:'198.51.100.99'});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'900');
 assert.equal((await freeAuth(env,'rider',{action:'password-login',phone:'0566666666',password:'short',clientIp:'192.0.2.1'})).status,400);
 env.db.close();
});
test('verified riders have separate estimate budgets even behind the same network, and forged sessions cannot escape the guest budget',async()=>{
 const env=makeEnv(),previous=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({code:'Ok',routes:[{distance:2400,duration:480}]});
 const body={pickup:{lat:24.7,lng:46.6},destination:{lat:24.71,lng:46.61},clientIp:'192.0.2.1'};
 const estimate=token=>routeEstimate(new Request('https://hub.test/internal/route-estimate',{method:'POST',headers:{'x-mishwar-key':'test-rider-key'},body:JSON.stringify({...body,sessionToken:token})}),env);
 try{
  const a=env.verifiedToken('shared-network-A'),b=env.verifiedToken('shared-network-B');
  for(let i=0;i<30;i++)assert.equal((await estimate(a)).status,200);
  assert.equal((await estimate(a)).status,429);assert.equal((await estimate(b)).status,200);
  for(let i=0;i<30;i++)assert.equal((await estimate(String(i).padStart(64,'a'))).status,200);
  assert.equal((await estimate('b'.repeat(64))).status,429);
 }finally{globalThis.fetch=previous;env.db.close()}
});
test('email login budget follows the chosen identity even when the attacker rotates phone and network claims',async()=>{
 const env=makeEnv();
 for(let i=0;i<40;i++)assert.equal((await freeAuth(env,'rider',{action:'password-login',email:'victim@example.test',phone:'0500'+String(i).padStart(6,'0'),password:'short',clientIp:'192.0.2.'+(i+1)})).status,400);
 assert.equal((await freeAuth(env,'rider',{action:'password-login',email:' VICTIM@example.test ',phone:'0566666666',password:'short',clientIp:'198.51.100.2'})).status,429);
 assert.equal((await freeAuth(env,'rider',{action:'password-login',email:'different@example.test',phone:'0566666666',password:'short',clientIp:'198.51.100.2'})).status,400);
 env.db.close();
});
