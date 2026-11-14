import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = name => readFileSync(new URL('../'+name, import.meta.url),'utf8');
test('worker maps verified captain cookie to background notification API without trusting caller identity',()=>{
 const code=read('worker/index.js');
 assert.match(code,/\['\/api\/driver','\/api\/application','\/api\/login','\/api\/captain-presence','\/api\/background'\]/);
 assert.match(code,/const authenticated=token\?await publicSession\(env,token,'captain'\):null/);
 assert.match(code,/headers\.delete\('oai-authenticated-user-id'\)/);
 assert.match(code,/if\(authenticated\?\.phoneVerified\)headers\.set/);
});
test('driver blocks further requests after 401 or 403 and displays login CTA',()=>{
 const code=read('public/driver.js');
 assert.match(code,/if\(r.status===401\|\|r.status===403\)\{haltDriverForAuthorization\(r.status\)/);
 assert.match(code,/if\(captainAuthBlocked\)throw Error/);
 assert.match(code,/async function refresh\(force=false\)\{if\(captainAuthBlocked\)return/);
 assert.match(code,/if\(!captainAuthBlocked&&!document.hidden&&navigator.onLine/);
 assert.ok(code.includes('href="/launch?login=1#login"'));
});
test('a 401 stops subsequent network calls in the client, without a reload loop',async()=>{
 const source=read('public/driver.js');
 const begin=source.indexOf('let captainAuthBlocked=false;');
 const end=source.indexOf('let lastFullSync=',begin);
 assert.ok(begin>0 && end>begin);
 const nodes=Object.fromEntries(['#online','.local-pill','.driver-nav','#driver-panel'].map(x=>[x, {innerHTML:'',textContent:'',disabled:false,hidden:false,setAttribute(){}}]));
 let requests=0;
 const context={data:null,lastView:'',by:key=>nodes[key]||null,window:{dispatchEvent(){}},Event:class Event{},fetch:async()=>{requests++;return {status:401}}};
 vm.createContext(context);
 vm.runInContext(source.slice(begin,end),context);
 await assert.rejects(vm.runInContext("api({action:'session'})",context));
 await assert.rejects(vm.runInContext("api({action:'session'})",context));
 assert.equal(requests,1);
 assert.equal(nodes['#online'].disabled,true);
 assert.match(nodes['#driver-panel'].innerHTML,/تسجيل الدخول/);
});
test('background avoids unauthorized subscription calls when captain session is absent/inactive',()=>{
 const code=read('public/app-background.js');
 assert.match(code,/fetch\('\/api\/auth\/session'/);
 assert.match(code,/!session.authenticated\|\|!session.phoneVerified\|\|session.application\?\.status!=='active'/);
});
