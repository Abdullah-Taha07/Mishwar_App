import test from 'node:test';
import assert from 'node:assert/strict';
import portal,{portalAdmin} from '../dist/server/index.js';

const env={ADMIN_EMAIL:'owner@example.test',HUB_URL:'https://hub.example',HUB_ACCESS_TOKEN:'token',HUB_SERVICE_KEY:'service-key'};
function forged(){return new Request('https://admin.example.test/api/health',{headers:{'oai-authenticated-user-id':'spoofed-owner','oai-authenticated-user-email':'owner@example.test','cf-access-jwt-assertion':'forged-not-verified'}})}
const context=email=>({access:{async getIdentity(){return {id:'trusted-access-subject',email}}}});
test('public identity headers alone never authorize independent administration Worker',async()=>{
 assert.equal((await portal.fetch(forged(),env)).status,403);
 assert.equal((await portal.fetch(forged(),env,{})).status,403);
 assert.equal(await portalAdmin(forged(),env,{}),null);
});
test('rejects missing, different, failed, or unconfigured trusted Access identity',async()=>{
 assert.equal((await portal.fetch(forged(),env,context('stranger@example.test'))).status,403);
 assert.equal((await portal.fetch(forged(),{},context('owner@example.test'))).status,403);
 assert.equal((await portal.fetch(forged(),env,{access:{async getIdentity(){throw Error('Access unavailable')}}})).status,403);
});
test('verified Cloudflare Access owner succeeds regardless of forged client-side identity headers',async()=>{
 const result=await portal.fetch(forged(),env,context('OWNER@example.test'));
 assert.equal(result.status,200);
 assert.equal((await result.json()).ready,true);
 assert.deepEqual(await portalAdmin(forged(),env,context('OWNER@example.test')),{id:'trusted-access-subject',email:'owner@example.test'});
});
