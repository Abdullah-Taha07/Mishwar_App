import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundFor} from '../worker/background.js';

const request=(method,action)=>new Request('https://hub.test/background'+(action?'?action='+encodeURIComponent(action):''),{method});

test('captain background read endpoints cannot run notification mutations from cross-site GET navigation',async()=>{
 let calls=0;
 const env={VAPID_PUBLIC_KEY:'test-public-key',DB:{prepare(){calls++;throw Error('No database access permitted for rejected GET')}}};
 for(const action of ['ack','register','register_native','unregister']){
  const response=await backgroundFor(request('GET',action),env,'captain','fixture-captain');
  assert.equal(response.status,405,`GET ${action} is not read-only`);
 }
 assert.equal(calls,0);
 const config=await backgroundFor(request('GET','config'),env,'captain','fixture-captain');
 assert.equal(config.status,200);
 assert.equal((await config.json()).publicKey,'test-public-key');
});

test('background handler rejects unsupported HTTP verbs before touching account storage',async()=>{
 const env={DB:{prepare(){throw Error('No database access permitted')}}};
 const response=await backgroundFor(request('PUT','ack'),env,'captain','fixture-captain');
 assert.equal(response.status,405);
});
