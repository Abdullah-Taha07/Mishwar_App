import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const A='a'.repeat(64),B='b'.repeat(64);
const source=readFileSync(new URL('../public/rider-account-settings.js',import.meta.url),'utf8');
const contextSource=readFileSync(new URL('../public/account-context.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<18;i++)await Promise.resolve()};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
const stage=(kind='phone',at='old',mode='sms')=>({id:'local-change',kind,stage:at,mode,phone:'+966500000001',code:'123456',expiresAt:'2030-01-01T10:00:00Z'});
function harness(owner=A){
  const calls=[],notices=[],events=new Map(),timers=new Map();let timerId=0;
  const node=()=>({isConnected:true,disabled:false,value:'',type:'',dataset:{},textContent:'',hidden:false,required:false,controls:[],append(value){this.controls.push(value)},querySelector(selector){return selector==='[data-rider-account-settings]'?this.controls.find(item=>'riderAccountSettings'in item.dataset)||null:null}});
  const modal={open:false,handlers:[],addEventListener(name,fn,options={}){this.handlers.push({name,fn,once:options.once})},close(){this.open=false;for(const row of [...this.handlers])if(row.name==='close'){row.fn();if(row.once)this.handlers.splice(this.handlers.indexOf(row),1)}}};
  const root=node(),container=node(),selectors=new Map();root._html='';
  Object.defineProperty(root,'innerHTML',{get(){return this._html},set(value){
    this._html=value;selectors.clear();
    for(const attr of [...value.matchAll(/\s(data-[\w-]+)(?:=|[\s>])/g)])selectors.set('['+attr[1]+']',node());
    for(const id of [...value.matchAll(/\sid="([^"]+)"/g)])selectors.set('#'+id[1],node());
    if(value.includes('<form')){
      const form=node();form.elements={};
      for(const field of [...value.matchAll(/<(?:input|select)[^>]*\sname="([^"]+)"[^>]*>/g)]){
        const input=node();input.type=field[0].match(/\stype="([^"]+)"/)?.[1]||'text';input.value=field[1]==='kind'?'password':'';form.elements[field[1]]=input;
      }
      const submit=node();submit.type='submit';form.querySelector=selector=>selector==='button'||selector==='[type=submit]'?submit:null;
      selectors.set('form',form);if(value.includes('id="rider-account-code"'))selectors.set('#rider-account-code',form);
    }
  }});
  root.querySelector=selector=>selectors.get(selector)||null;
  root.querySelectorAll=selector=>selector==='input[type=password]'?Object.values(selectors.get('form')?.elements||{}).filter(input=>input.type==='password'):[];
  const sandbox={console,Map,Set,Promise,JSON,Date,Number,String,Error,AbortController,
    Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
    addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn)},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event)},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),
    document:{querySelector(selector){if(selector==='#modal')return modal;if(selector==='[data-rider-security-view]')return root;if(['#modal .dialog-body','#modal-content','.rider-account-card'].includes(selector))return container;return null},createElement:node},
    sectionModal(){modal.open=true;root.isConnected=true},toast:message=>notices.push(message),esc:value=>String(value??'').replace(/[<>&"]/g,'_'),showRiderLogin(){sandbox.loginShown=true},showAccount(){sandbox.accountShown=true},showSettings(){},refreshMishwarRiderAccount:async()=>true,
    localStorage:{setItem(){throw Error('Account change must not persist credentials')}},sessionStorage:{setItem(){throw Error('Account change must not persist credentials')}},
    fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body,signal:options.signal});const result=await sandbox.handler(url.split('/').at(-1),body);return{ok:result.status===undefined||result.status<400,json:async()=>result.data??result}},
    handler:async action=>action==='change-start'?stage():action==='change-status'?stage('phone','new'):action==='change-check'?stage('phone','approved'):{ok:true},
  };
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(contextSource,sandbox);
  const auth=next=>{const context=sandbox.MishwarAccountContext;context.applyAuth(next?{authenticated:true,phoneVerified:true,accountKey:next}:{authenticated:false,accountKey:null},context.beginAuthRead());context.notifyAuth()};
  auth(owner);vm.runInContext(source,sandbox);
  return{c:sandbox,calls,notices,root,modal,container,selectors,timers,auth,get form(){return selectors.get('form')},open(){sandbox.showRiderAccountSettings()},async submit(){selectors.get('form').onsubmit({preventDefault(){}});await flush()},async click(selector){const button=selectors.get(selector);assert.ok(button,selector+' is available');button.onclick({currentTarget:button});await flush()},async expire(){for(const fn of [...timers.values()])fn();await flush()}};
}

test('account security is reachable from profile/settings and unavailable to guest owners',()=>{
  const h=harness();h.c.showAccount();assert.ok(h.container.controls.some(button=>'riderAccountSettings'in button.dataset));
  const guest=harness(null);guest.open();assert.equal(guest.c.loginShown,true);assert.equal(guest.calls.length,0);
});

test('password mismatch makes no request and server failures never claim a saved change',async()=>{
  const h=harness();h.open();Object.assign(h.form.elements.oldPassword,{value:'old-local-password'});h.form.elements.value.value='new-local-password';h.form.elements.confirm.value='different';
  await h.submit();assert.equal(h.calls.length,0);assert.match(h.selectors.get('[data-security-error]').textContent,/متطابقتين/);
  h.form.elements.confirm.value='new-local-password';h.c.handler=async()=>({status:400,data:{error:'كلمة المرور الحالية غير صحيحة'}});
  await h.submit();assert.equal(h.calls.length,1);assert.equal(h.form.elements.oldPassword.value,'');assert.equal(h.form.elements.value.value,'');assert.equal(h.form.elements.confirm.value,'');assert.equal(h.notices.length,0);
  assert.equal(h.selectors.has('[data-finish-account-change]'),false);
});

test('phone changes expose old/new challenge stages and require explicit final save',async()=>{
  const h=harness();h.open();h.form.elements.kind.value='phone';h.form.elements.kind.onchange();h.form.elements.oldPassword.value='old-local-password';h.form.elements.value.value='0500000002';
  let checks=0;h.c.handler=async action=>action==='change-start'?stage():action==='change-check'?stage('phone',++checks===1?'new':'approved'):{ok:true};
  await h.submit();assert.equal(h.calls[0].body.kind,'phone');assert.equal(h.calls[0].body.value,'0500000002');assert.equal(h.calls[0].body.confirm,undefined);
  assert.ok(h.selectors.has('#rider-account-code'));assert.equal(h.selectors.has('[data-finish-account-change]'),false);
  h.form.elements.code.value='123456';await h.submit();assert.equal(h.calls.at(-1).url,'/api/auth/change-check');assert.equal(h.selectors.has('[data-finish-account-change]'),false);
  h.form.elements.code.value='654321';await h.submit();assert.ok(h.selectors.has('[data-finish-account-change]'));assert.equal(h.calls.some(row=>row.url.endsWith('change-finish')),false);
  await h.click('[data-finish-account-change]');assert.equal(h.calls.filter(row=>row.url.endsWith('change-finish')).length,1);assert.equal(h.modal.open,false);assert.equal(h.c.accountShown,true);
});

test('manual changes can resume and cancel but the browser cannot approve phone ownership',async()=>{
  const h=harness();h.open();h.c.handler=async action=>action==='change-status'?stage('phone','old','manual'):{ok:true};
  await h.click('[data-resume-account-change]');assert.equal(h.selectors.has('#rider-account-code'),false);assert.equal(h.selectors.has('[data-finish-account-change]'),false);assert.match(h.root.innerHTML,/مراجعة فريق الدعم/);
  await h.click('[data-cancel-account-change]');assert.equal(h.calls.at(-1).url,'/api/auth/change-cancel');assert.ok(h.form);
});

test('duplicate start submits do not replay a mutation and owner changes discard its late response',async()=>{
  const h=harness(),pending=deferred();h.c.handler=()=>pending.promise;h.open();h.form.elements.oldPassword.value='old-local-password';h.form.elements.value.value='new-local-password';h.form.elements.confirm.value='new-local-password';
  await h.submit();await h.submit();assert.equal(h.calls.length,1);h.auth(B);assert.equal(h.modal.open,false);const html=h.root.innerHTML;
  pending.resolve(stage('password'));await flush();assert.equal(h.root.innerHTML,html);assert.equal(h.selectors.has('[data-finish-account-change]'),false);assert.equal(h.notices.length,0);
});

test('close or replacement before a response cannot paint account change details into a different view',async()=>{
  const h=harness(),pending=deferred();h.c.handler=()=>pending.promise;h.open();await h.click('[data-resume-account-change]');h.root.isConnected=false;h.modal.close();
  const previous=h.root.innerHTML;pending.resolve(stage('phone','old','manual'));await flush();assert.equal(h.root.innerHTML,previous);assert.equal(h.notices.length,0);
});

test('pending status reads have a bounded deadline without replaying account mutations',async()=>{
  const h=harness(),pending=deferred();h.c.handler=()=>pending.promise;h.open();await h.click('[data-resume-account-change]');assert.equal(h.calls.length,1);await h.expire();
  assert.match(h.selectors.get('[data-security-error]').textContent,/مهلة/);assert.equal(h.calls[0].signal.aborted,true);assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
  pending.resolve(stage());await flush();assert.ok(h.form,'late status response cannot replace the recovered form');
});
