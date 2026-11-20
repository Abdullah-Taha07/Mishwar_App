import test from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceFetch } from '../worker/maintenance.js';

const provider = 'https://provider.example.test/v1/check';

async function mockFetch(implementation, task) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try { return await task(); } finally { globalThis.fetch = original; }
}

test('Cloudflare-compatible strict redirect handling never passes error to fetch', async () => {
  let calls = 0;
  await mockFetch(async (url, options) => {
    calls++;
    assert.equal(url, provider);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer offline-fixture');
    return Response.json({ok:true});
  }, async () => {
    const response = await maintenanceFetch({}, provider, {redirect:'error',headers:{Authorization:'Bearer offline-fixture'}});
    assert.deepEqual(await response.json(), {ok:true});
  });
  assert.equal(calls, 1);
});

test('all provider HTTP 3xx responses are rejected with no follow-up fetch', async () => {
  let calls = 0;
  await mockFetch(async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response(null, {status: [300,301,302,303,304,307,308,399][calls-1],headers:{Location:'https://untrusted.example.test'}});
  }, async () => {
    for (let i = 0; i < 8; i++) {
      await assert.rejects(maintenanceFetch({}, provider, {redirect:'error'}), {code:'EXTERNAL_PROVIDER_REDIRECT'});
    }
  });
  assert.equal(calls, 8);
});

test('opaqueredirect and unexpectedly followed responses are rejected', async () => {
  let mode = 'opaqueredirect';
  await mockFetch(async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    const response = Response.json({ok:true});
    Object.defineProperty(response, mode === 'opaqueredirect' ? 'type' : 'redirected', {value:mode === 'opaqueredirect' ? 'opaqueredirect' : true});
    return response;
  }, async () => {
    await assert.rejects(maintenanceFetch({}, provider, {redirect:'error'}), {code:'EXTERNAL_PROVIDER_REDIRECT'});
    mode = 'redirected';
    await assert.rejects(maintenanceFetch({}, provider, {redirect:'error'}), {code:'EXTERNAL_PROVIDER_REDIRECT'});
  });
});

test('scoped POST redirect fails *inside* the maintenance effect, preserving uncertain outcome', async () => {
  let calls=0, kind, uncertain=false;
  const env={__maintenance:{effect:async(type,work,options)=>{kind=type;try{return await work()}catch(error){uncertain=options.uncertainOnFailure;throw error}}}};
  await mockFetch(async (_url, init)=>{
    calls++;
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    return Response.redirect('https://untrusted.example.test', 307);
  }, async()=>{
    await assert.rejects(maintenanceFetch(env,provider,{method:'POST',redirect:'error',body:'offline'}), {code:'EXTERNAL_PROVIDER_REDIRECT'});
  });
  assert.equal(calls,1);
  assert.equal(kind,'provider.POST');
  assert.equal(uncertain,true);
});

test('scoped GET redirect rejects without an uncertain mutation outcome', async () => {
  let uncertain=null;
  const env={__maintenance:{effect:async(_kind,work,options)=>{uncertain=options.uncertainOnFailure;return work()}}};
  await mockFetch(async (_url,options)=>{
    assert.equal(options.redirect,'manual');
    return Response.redirect('https://untrusted.example.test',302);
  },async()=>{
    await assert.rejects(maintenanceFetch(env,provider,{method:'GET',redirect:'error'}),{code:'EXTERNAL_PROVIDER_REDIRECT'});
  });
  assert.equal(uncertain,false);
});

test('manual mode without strict rejection keeps its existing behavior', async () => {
  await mockFetch(async (_url,options)=>{
    assert.equal(options.redirect,'manual');
    return Response.redirect('https://provider.example.test/other',302);
  }, async()=>{
    const response=await maintenanceFetch({},provider,{redirect:'manual'});
    assert.equal(response.status,302);
  });
});

test('provider network failures propagate, rather than being treated as success', async () => {
  await mockFetch(async (_url, options)=>{
    assert.equal(options.redirect,'manual');
    throw Object.assign(new Error('Offline transport failure'),{code:'NETWORK_OFFLINE_TEST'});
  },async()=>{
    await assert.rejects(maintenanceFetch({},provider,{redirect:'error'}),{code:'NETWORK_OFFLINE_TEST'});
  });
});
