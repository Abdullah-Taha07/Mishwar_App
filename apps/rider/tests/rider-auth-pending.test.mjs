import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const file=process.argv[2]?resolve(process.argv[2]):resolve(dirname(fileURLToPath(import.meta.url)),'..','public','rider-auth.js');
const original=readFileSync(file,'utf8');

function harness(mode){
 const state={status:'ready',authenticated:false,accountKey:null,verified:false,generation:0};
 const begin=()=>{state.status='transitioning';return ++state.generation};
 const finish=id=>{if(state.status!=='transitioning'||id!==state.generation)return false;state.status='unknown';return true};
 const fakeAccountContext={
  snapshot:()=>({...state}),beginTransition:begin,finishTransition:finish,
  isTransitionCurrent:id=>state.status==='transitioning'&&id===state.generation,
  beginAuthRead:()=>({sequence:1,generation:state.generation}),
  isAuthReadCurrent:()=>true,
  readController:()=>({controller:new AbortController(),release(){}}),
  applyAuth:data=>{state.status='ready';state.authenticated=data.authenticated===true;return true},
  notifyAuth(){},ignored(){return false}
 };
 const el=(extra={})=>({disabled:false,isConnected:true,textContent:'',attrs:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},...extra});
 const phone=el({value:'0501112223'}),password=el({value:'test-password'}),email=el({value:''}),toggle=el(),switchMode=el(),submit=el({textContent:'دخول إلى مشوار'}),recover=el(),guest=el();
 const controls=[phone,password,email,toggle,switchMode,submit,recover,guest];
 const scope=el({querySelectorAll:()=>controls});
 const alert=el({append(node){this.child=node}});
 const form=el({
  closest:()=>scope,
  querySelector:sel=>({'[type=submit]':submit,'#rider-auth-error':alert,'[name=phone]':phone}[sel]||null),
  querySelectorAll:()=>[phone,password,email,toggle,submit],
 });
 const others=new Map();
 const $=selector=>{
  if(selector==='#rider-password-form')return form;
  if(selector==='#rider-email-recovery')return recover;
  if(selector==='#toggle-rider-password')return toggle;
  if(selector==='#switch-rider-auth')return switchMode;
  if(selector==='#browse-rider')return guest;
  if(selector==='#modal')return el({close(){}});
  if(selector==='#rider-auth-error')return alert;
  if(!others.has(selector))others.set(selector,el());return others.get(selector)
 };
 let finishFetch;
 const events=[];
 const fetch=(url,options={})=>{
  events.push({url,options});
  if(url==='/api/auth/session')return Promise.resolve(Response.json(mode==='success'?{authenticated:true,accountKey:'a'.repeat(64),phoneVerified:true,profile:{name:'Test Rider',phone:'0501112223',email:''}}:{authenticated:false,accountKey:null,phoneVerified:false}));
  if(url==='/api/auth/password-login'){
   if(mode==='error')return new Promise(done=>finishFetch=()=>done(Response.json({error:'بيانات الدخول غير صحيحة'}, {status:400})));
   if(mode==='success')return Promise.resolve(Response.json({authenticated:true}));
   if(mode==='timeout')return new Promise((_done,reject)=>options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
  }
  throw Error('Unexpected fetch '+url)
 };
 const sandbox={
  window:{MishwarAccountContext:fakeAccountContext,addEventListener(){},dispatchEvent(){}},
  document:{createElement:()=>el()},
  location:{hash:''},history:{},
  fetch,AbortController,AbortSignal,DOMException,Response,
  setTimeout,clearTimeout,setInterval:()=>0,clearInterval:()=>{},
  FormData:class{constructor(){return [['phone',phone.value],['password',password.value],['email',email.value]]}},
  sectionModal(){},$,
  profile:{},save(){},updateIdentity(){},
  console:{warn(){},log(){},error(){}},
 };
 const source=mode==='timeout'?original.replace("action==='session'?15000:35000","action==='session'?20:20"):original;
 vm.runInNewContext(source,sandbox,{filename:file,timeout:2000});
 sandbox.window.showRiderLogin();
 const submitEvent={target:form,preventDefault(){}};
 return {controls,form,scope,alert,submit,phone,password,email,events,post:()=>form.onsubmit(submitEvent),done:()=>finishFetch?.()};
}

test('login freezes every input and button, and restores their prior states on 400',async()=>{
 const h=harness('error');
 h.toggle=h.controls[3];h.controls[3].disabled=true;
 const promise=h.post();
 assert.equal(h.scope.attrs['aria-busy'],'true');
 assert.equal(h.phone.disabled,true);assert.equal(h.password.disabled,true);assert.equal(h.email.disabled,true);
 assert.equal(h.controls.every(c=>c.disabled),true);
 assert.match(h.submit.textContent,/لحظات/);
 assert.ok(h.events.some(x=>x.url==='/api/auth/password-login'));
 await h.post();assert.equal(h.events.filter(x=>x.url==='/api/auth/password-login').length,1,'double-submit must be ignored');h.done();await promise;
 assert.equal(h.phone.disabled,false);assert.equal(h.password.disabled,false);assert.equal(h.email.disabled,false);
 assert.equal(h.controls[3].disabled,true,'restore previously disabled state');
 assert.match(h.alert.textContent,/غير صحيحة/);
 assert.equal(h.submit.textContent,'دخول إلى مشوار');assert.equal(h.scope.attrs['aria-busy'],undefined);
});

test('login timeout is displayed, releases lock, and does not automatically replay password',async()=>{
 const h=harness('timeout');
 await h.post();
 assert.match(h.alert.textContent,/مهلة/);
 assert.equal(h.phone.disabled,false);
 assert.equal(h.submit.disabled,false);
 assert.equal(h.events.filter(x=>x.url==='/api/auth/password-login').length,1,'no replay of credential mutation');
});

test('accepted login verifies authenticated session and unlocks form',async()=>{
 const h=harness('success');
 await h.post();
 assert.equal(h.phone.disabled,false);
 assert.equal(h.password.disabled,false);
 assert.equal(h.submit.disabled,false);
 assert.equal(h.scope.attrs['aria-busy'],undefined);
 assert.equal(h.events.filter(x=>x.url==='/api/auth/password-login').length,1);
 assert.equal(h.events.filter(x=>x.url==='/api/auth/session').length>=1,true);
});
