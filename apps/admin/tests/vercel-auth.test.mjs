import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/admin-auth/[action].js';
const env = { ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET, ADMIN_LOGIN_PASSWORD: process.env.ADMIN_LOGIN_PASSWORD };
process.env.ADMIN_SESSION_SECRET = 'test-secret-for-mishwar-vercel-auth-123456789';
process.env.ADMIN_LOGIN_PASSWORD = 'test-password-123456';
function invoke(action, {method='GET', cookie='', body}={}) {
  const headers={host:'admin.example',origin:'https://admin.example',cookie};
  const req={method,headers,query:{action},body};
  const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this},setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},end(s){this.body=JSON.parse(s);return this}};
  return Promise.resolve(handler(req,res)).then(()=>res);
}
test('login cookie is accepted by the session endpoint',async()=>{
  const login=await invoke('login',{method:'POST',body:{password:'test-password-123456'}});
  assert.equal(login.body.authenticated,true);
  const cookie=login.headers['set-cookie'].split(';')[0];
  const session=await invoke('session',{cookie});
  assert.deepEqual(session.body,{authenticated:true});
});
test('session diagnostic reveals no secrets or cookie values',async()=>{
  const missing=await invoke('session');
  assert.deepEqual(missing.body,{authenticated:false,reason:'cookie_missing'});
  const bad=await invoke('session',{cookie:'__Host-mishwar_admin=abc.def'});
  assert.deepEqual(bad.body,{authenticated:false,reason:'signature_invalid'});
  assert.doesNotMatch(JSON.stringify(bad.body),/test-secret|abc\.def/);
});
test.after(()=>{for(const [key,value] of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value}});
