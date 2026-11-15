import {createHmac} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import bridge from '../api/admin-auth/staff.js';
import proxy from '../api/admin/[...path].js';
const saved={ADMIN_LOGIN_PASSWORD:process.env.ADMIN_LOGIN_PASSWORD,HUB_URL:process.env.HUB_URL,ADMIN_SERVICE_KEY:process.env.ADMIN_SERVICE_KEY,ADMIN_SESSION_SECRET:process.env.ADMIN_SESSION_SECRET};
process.env.HUB_URL='https://offline.invalid';process.env.ADMIN_SERVICE_KEY='local-service-key';process.env.ADMIN_SESSION_SECRET='local-test-secret-abcdefghijklmnopqrstuvwxyz';
process.env.ADMIN_LOGIN_PASSWORD='local-owner-password-123456';
const session='a'.repeat(64),device='b'.repeat(64);
function invoke(handler,{url='/api/admin/operations/support',method='POST',origin='https://admin.local',cookie='',body={},extraHeaders={}}={}){
 const req={url,method,body,headers:{host:'admin.local',origin,cookie,...extraHeaders}};
 const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this},setHeader(k,v){this.headers[k.toLowerCase()]=v;return this},end(s){this.raw=s;this.body=s&&JSON.parse(String(s));return this}};
 return Promise.resolve(handler(req,res)).then(()=>res);
}
test('staff bridge rejects foreign origin before calling the Worker',async()=>{let called=false;const old=globalThis.fetch;globalThis.fetch=async()=>{called=true;throw Error()};try{assert.equal((await invoke(bridge,{origin:'https://attacker.local',body:{action:'login'}})).statusCode,403);assert.equal(called,false);}finally{globalThis.fetch=old;}});
test('session and device credentials become secure HttpOnly cookies and never JSON',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({authenticated:true,sessionToken:session,deviceToken:device});try{const r=await invoke(bridge,{body:{action:'login',email:'x@local.test',password:'private'}});assert.equal(r.body.authenticated,true);assert.equal(r.body.sessionToken,undefined);assert.equal(r.body.deviceToken,undefined);assert.equal(r.headers['set-cookie'].length,3);for(const cookie of r.headers['set-cookie'])assert.match(cookie,/Path=\/; HttpOnly; Secure; SameSite=Strict/);assert.match(r.headers['set-cookie'][0],/__Host-mishwar_admin=;.*Max-Age=0/);}finally{globalThis.fetch=old;}});
test('bridge ignores browser-supplied session/device credentials and uses cookies',async()=>{const old=globalThis.fetch;let sent;globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return Response.json({authenticated:true});};try{await invoke(bridge,{cookie:`__Host-mishwar_staff=${session}; __Host-mishwar_device=${device}`,body:{action:'session',sessionToken:'attacker',deviceToken:'attacker'}});assert.equal(sent.sessionToken,session);assert.equal(sent.deviceToken,device);}finally{globalThis.fetch=old;}});
test('proxy forwards staff identity from cookie and never browser role or email',async()=>{const old=globalThis.fetch;let sent;globalThis.fetch=async(url,options)=>{sent=options.headers;return Response.json({ok:true});};try{const r=await invoke(proxy,{cookie:`__Host-mishwar_staff=${session}`,body:{subject:'test'},extraHeaders:{'x-mishwar-staff-session':'forged','oai-authenticated-user-email':'owner@local','x-staff-approval':'approval-1'}});assert.equal(r.statusCode,200);assert.equal(sent.get('x-mishwar-staff-session'),session);assert.equal(sent.get('oai-authenticated-user-email'),null);assert.equal(sent.get('x-staff-approval'),'approval-1');assert.equal(sent.get('x-mishwar-key'),'local-service-key');}finally{globalThis.fetch=old;}});
test('anonymous, malformed cookie, and cross-site proxy calls never reach the Worker',async()=>{const old=globalThis.fetch;let called=false;globalThis.fetch=async()=>{called=true;throw Error()};try{for(const cookie of ['', '__Host-mishwar_staff=invalid'])assert.equal((await invoke(proxy,{cookie})).statusCode,401);assert.equal((await invoke(proxy,{cookie:`__Host-mishwar_staff=${session}`,origin:'https://attacker.local'})).statusCode,403);assert.equal(called,false);}finally{globalThis.fetch=old;}});

test('owner security changes require password reconfirmation, which is never forwarded upstream',async()=>{
 const payload=Buffer.from(JSON.stringify({role:'admin',exp:Date.now()+60000})).toString('base64url');const signature=createHmac('sha256',process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');const cookie=`__Host-mishwar_admin=${payload}.${signature}`;
 const old=globalThis.fetch;let calls=0,headers;globalThis.fetch=async(url,options)=>{calls++;headers=options.headers;return Response.json({ok:true});};
 try{assert.equal((await invoke(proxy,{url:'/api/admin/security/accounts',cookie,body:{name:'Employee'}})).statusCode,403);assert.equal(calls,0);assert.equal((await invoke(proxy,{url:'/api/admin/security/accounts',cookie,body:{name:'Employee'},extraHeaders:{'x-mishwar-owner-proof':Buffer.from(process.env.ADMIN_LOGIN_PASSWORD).toString('base64')}})).statusCode,200);assert.equal(calls,1);assert.equal(headers.get('x-mishwar-owner-proof'),null);}finally{globalThis.fetch=old;}
});
test.after(()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
