import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../public/rider-support.js',import.meta.url),'utf8');
const A='a'.repeat(64),B='b'.repeat(64),flush=async()=>{for(let n=0;n<12;n++)await new Promise(setImmediate)};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function harness(){
 let owner=A,generation=0,uuid=0,handler=null;const listeners=new Map(),storage=new Map(),calls=[],dialogs=[],timers=new Map(),reads=new Set();
 const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
 function node(){return {disabled:false,textContent:'',value:'',dataset:{},events:new Map(),addEventListener(name,fn){this.events.set(name,fn)},querySelector(){return null}}}
 function dialog(){
  const d=node();d.open=false;d.nodes=new Map();d.html='';d.form=null;
  function populate(html,body=false){
   if(body)d.bodyHtml=html;else d.html=html;
   for(const match of html.matchAll(/data-support-([a-z-]+)(?:="([^"]*)")?/g)){const key='[data-support-'+match[1]+']';if(!d.nodes.has(key))d.nodes.set(key,node());}
   const formHtml=html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/)?.[1];
   if(formHtml){const f=node();f.elements={};for(const m of formHtml.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))f.elements[m[1]]={value:decode(m[2])};for(const m of formHtml.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){const options=[...m[2].matchAll(/<option value="([^"]+)"([^>]*)>/g)];f.elements[m[1]]={value:(options.find(o=>o[2].includes('selected'))||options[0])[1]};}const button=node();f.querySelector=selector=>selector==='button'?button:null;f.button=button;d.form=f;}
   else d.form=null;
  }
  const body=node();Object.defineProperty(body,'innerHTML',{get:()=>d.bodyHtml||d.html,set:value=>populate(value,true)});
  Object.defineProperty(d,'innerHTML',{get:()=>d.html,set:value=>populate(value)});
  d.querySelector=selector=>selector==='.launch-body'?body:selector==='form'?d.form:d.nodes.get(selector)||null;
  d.querySelectorAll=()=>[];d.showModal=()=>{d.open=true};d.close=()=>{d.open=false;d.events.get('close')?.()};d.remove=()=>{d.removed=true};return d;
 }
 const context={snapshot:()=>({status:'ready',accountKey:owner,verified:!!owner}),capture:()=>({accountKey:owner,generation}),isCurrent:t=>t.accountKey===owner&&t.generation===generation,storageKey:name=>owner?name+':'+owner:null,stale:()=>Object.assign(Error('stale account'),{name:'AccountChangedError'}),ignored:e=>['AbortError','AccountChangedError'].includes(e.name),checkResponseOwner(){},readController(){const item={controller:new AbortController(),release(){reads.delete(item)}};reads.add(item);return item}};
 const sandbox={AbortController,console,Map,Set,Promise,JSON,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`},setTimeout:fn=>{const id=timers.size+1;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},showSupport(){},showSupportHistory(){},showRiderLogin(){sandbox.loginOpened=true},addEventListener:(name,fn)=>listeners.set(name,fn),document:{createElement:()=>dialog(),body:{append:d=>dialogs.push(d)}},MishwarAccountContext:context,fetch:async(path,init)=>{const body=JSON.parse(init.body);calls.push({path,body,signal:init.signal});if(handler)return handler(body,init);if(body.action==='live_case_messages')return response({case:{status:'open'},messages:[]});if(body.action==='live_cases')return response({items:[]});return response({ok:true,id:'case-fixture'})}};
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(script,sandbox);
 return {c:sandbox,calls,storage,timers,dialogs,set handler(value){handler=value},get dialog(){return dialogs.at(-1)},async submit(){return this.dialog.form.onsubmit({preventDefault(){}})},edit(name,value){const form=this.dialog.form;form.elements[name].value=value;form.events.get('input')?.()},change(next){owner=next;generation++;for(const read of reads)read.controller.abort();listeners.get('mishwar-account-reset')?.()},draft(name,account=owner){return JSON.parse(storage.get('mishwar-support:'+name+':'+account)||'{}')}};
}

test('failed support creation retains the exact attempt for safe manual retry and clears only after server confirmation',async()=>{
 const h=harness();h.c.MishwarSupport.open();h.edit('description','A useful account help request');h.handler=body=>body.action==='live_case_create'?Promise.reject(TypeError('offline')):response({case:{status:'open'},messages:[]});
 await h.submit();const first=h.calls[0].body.clientRequestId;assert.ok(first);assert.equal(h.dialog.form.elements.description.value,'A useful account help request');assert.equal(h.dialog.form.button.disabled,false);assert.equal(h.draft('create:account').clientRequestId,first);
 h.handler=body=>body.action==='live_case_create'?response({ok:true,id:'case-fixture'}):response({case:{status:'open'},messages:[]});await h.submit();assert.equal(h.calls[1].body.clientRequestId,first);assert.deepEqual(h.draft('create:account'),{});assert.ok(h.dialog.form.elements.body);
});

test('typing a newer draft while case creation is pending cannot be erased by the older acknowledgement',async()=>{
 const h=harness(),pending=deferred();h.c.MishwarSupport.open();h.edit('description','The original request text');h.handler=()=>pending.promise;const sent=h.submit();h.edit('description','A newer unsent description');pending.resolve(response({ok:true,id:'case-fixture'}));await sent;
 assert.equal(h.dialog.form.elements.description.value,'A newer unsent description');assert.equal(h.draft('create:account').description,'A newer unsent description');assert.equal(h.calls.length,1);assert.match(h.dialog.querySelector('[data-support-error]').textContent,/لم تُرسل/);
});

test('case reply draft and attempt survive failure; edits during acknowledgement remain unsent',async()=>{
 const h=harness();await h.c.MishwarSupport.case('case-fixture');h.edit('body','Initial reply text');h.handler=()=>Promise.reject(TypeError('offline'));await h.submit();const first=h.calls.at(-1).body.clientRequestId;assert.equal(h.draft('reply:case-fixture').body,'Initial reply text');
 const pending=deferred();h.handler=()=>pending.promise;const sent=h.submit();assert.equal(h.calls.at(-1).body.clientRequestId,first);h.edit('body','New reply written while waiting');pending.resolve(response({case:{status:'open'},messages:[]}));await sent;
 assert.equal(h.dialog.form.elements.body.value,'New reply written while waiting');assert.equal(h.draft('reply:case-fixture').body,'New reply written while waiting');
});

test('account changes close support, abort old work and isolate drafts without rendering private replies under another owner',async()=>{
 const h=harness(),pending=deferred();h.c.MishwarSupport.open();h.edit('description','Private account A support draft');h.handler=()=>pending.promise;const old=h.submit();h.change(B);h.c.MishwarSupport.open();assert.equal(h.dialog.form.elements.description.value,'');pending.resolve(response({ok:true,id:'private-case-A'}));await old;
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.dialog.form.elements.description.value,'');assert.equal(h.draft('create:account',A).description,'Private account A support draft');
 h.change(A);h.c.MishwarSupport.open();assert.equal(h.dialog.form.elements.description.value,'Private account A support draft');
});

test('support deadline releases the button and retains the draft without automatically replaying a mutation',async()=>{
 const h=harness();h.c.MishwarSupport.open();h.edit('description','A message whose network request hangs');h.handler=()=>new Promise(()=>{});const sent=h.submit();for(const timer of [...h.timers.values()])timer();await sent;
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.dialog.form.button.disabled,false);assert.equal(h.draft('create:account').description,'A message whose network request hangs');assert.match(h.dialog.querySelector('[data-support-error]').textContent,/لم يصل تأكيد/);
});

test('general support cannot silently use preview trips and anonymous users cannot send account support',()=>{
 const h=harness();h.c.showSupport(0);assert.equal(h.dialog.form.elements.kind.value,'technical');h.edit('description','A general account support draft');assert.equal(h.draft('create:account').tripId,null);
 h.change(null);h.c.MishwarSupport.open();assert.equal(h.dialog.form,null);assert.equal(h.calls.length,0);h.dialog.querySelector('[data-support-login]').onclick();assert.equal(h.c.loginOpened,true);
});
