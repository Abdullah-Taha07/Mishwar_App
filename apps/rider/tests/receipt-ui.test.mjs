import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const launch=readFileSync(new URL('../public/launch-ui.js',import.meta.url),'utf8');
const start=launch.indexOf('// RDEV-002: keep receipt reads');
const end=launch.indexOf('// End RDEV-002 receipt controller.');
assert.ok(start>=0&&end>start);
const source=launch.slice(start,end);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};

function harness(){
 const listeners=new Map(),timers=new Map(),calls=[],models=[],disposed=[];let timerId=0;
 const state={owner:'A',authenticated:true,dialog:null,handler:null,exportHandler:null,exportCount:0};
 const context={capture:()=>({accountKey:state.owner}),snapshot:()=>({status:'ready',authenticated:state.authenticated}),isCurrent:ticket=>ticket.accountKey===state.owner,
  readController:()=>({controller:new AbortController(),release(){}}),checkResponseOwner:(_,ticket)=>{assert.equal(ticket.accountKey,state.owner)}};
 const helper={normalize(raw,options){assert.equal(raw.tripId,options.tripId);const model={...raw,owner:options.ticket.accountKey};models.push(model);return model},
  renderHtml:model=>'<article class="trip-receipt">'+model.label+'</article>',dispose:model=>disposed.push(model),
  ...Object.fromEntries(['download','print','share'].map(action=>[action,async model=>{state.exportCount++;assert.equal(model.owner,state.owner);return state.exportHandler?state.exportHandler(action):{action:action==='share'?'shared':action}}]))};
 const c={console,Promise,AbortController,Map,Set,
  setTimeout(fn){const id=++timerId;timers.set(id,fn);return id},clearTimeout:id=>timers.delete(id),
  MishwarAccountContext:context,MishwarReceipt:helper,
  addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn)},
  removeEventListener(name,fn){listeners.get(name)?.delete(fn)},
  escape:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),
  call:async(action,body,options)=>{calls.push({action,body,options});return state.handler?state.handler(body):{receipt:{tripId:body.tripId,label:'Synthetic receipt '+body.tripId}}},
  modal(){
   state.dialog?.close();
   const status={textContent:''},body={innerHTML:'',replaceChildren(){this.innerHTML=''}};
   const buttons=Object.fromEntries(['download','print','share','retry'].map(key=>[key,{disabled:false,setAttribute(){}}]));
   const d={open:true,isConnected:true,focus(){this.focused=true},querySelector(selector){
    if(selector==='.launch-body')return body;if(selector==='[data-receipt-status]')return status;
    return buttons[selector.match(/data-receipt-(\w+)/)?.[1]]||null;
   },querySelectorAll:()=>['download','print','share'].map(key=>buttons[key]),
   close(){this.open=false;this.cleanup?.();this.isConnected=false},body,status,buttons};
   state.dialog=d;return d;
  },
 };
 c.window=c;vm.createContext(c);vm.runInContext(source+'\nthis.openReceipt=receipt;',c);
 return {c,state,calls,models,disposed,timers,
  open:id=>c.openReceipt(id),click:action=>state.dialog.buttons[action].onclick(),
  reset(){state.owner='B';for(const fn of listeners.get('mishwar-account-reset')||[])fn()},
 };
}

test('RDEV-002 own receipt is loaded once and its exports do not create another request',async()=>{
 const h=harness();await h.open('completed-A');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].action,'receipt');assert.equal(h.calls[0].body.tripId,'completed-A');
 assert.equal(h.models[0].owner,'A');assert.match(h.state.dialog.body.innerHTML,/Synthetic receipt completed-A/);
 await h.click('download');assert.match(h.state.dialog.status.textContent,/بدأ تنزيل/);assert.doesNotMatch(h.state.dialog.status.textContent,/تم حفظ/);
 await h.click('print');assert.match(h.state.dialog.status.textContent,/نافذة الطباعة/);
 assert.equal(h.calls.length,1);assert.equal(h.state.exportCount,2);
});

test('RDEV-002 duplicate open and export clicks are coalesced while pending',async()=>{
 const h=harness(),read=pending();h.state.handler=()=>read.promise;
 const opening=h.open('completed-A');await h.open('completed-A');assert.equal(h.calls.length,1);assert.equal(h.state.dialog.focused,true);
 read.resolve({receipt:{tripId:'completed-A',label:'A'}});await opening;
 const write=pending();h.state.exportHandler=()=>write.promise;
 const first=h.click('download');await h.click('download');assert.equal(h.state.exportCount,1);assert.equal(h.state.dialog.buttons.share.disabled,true);
 write.resolve({action:'download'});await first;assert.equal(h.state.dialog.buttons.share.disabled,false);
});

test('RDEV-002 an account reset aborts a pending read and discards a noncooperative late reply',async()=>{
 const h=harness(),read=pending();h.state.handler=()=>read.promise;
 const opening=h.open('completed-A'),d=h.state.dialog;h.reset();
 assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(d.open,false);assert.equal(d.body.innerHTML,'');
 read.resolve({receipt:{tripId:'completed-A',label:'PRIVATE A'}});await opening;
 assert.equal(h.models.length,0);assert.equal(d.body.innerHTML,'');
});

test('RDEV-002 closing an old receipt prevents it repainting the next receipt',async()=>{
 const h=harness(),read=pending();h.state.handler=body=>body.tripId==='old'?read.promise:{receipt:{tripId:'new',label:'NEW ONLY'}};
 const opening=h.open('old'),old=h.state.dialog;await h.open('new');
 read.resolve({receipt:{tripId:'old',label:'OLD'}});await opening;
 assert.equal(old.open,false);assert.match(h.state.dialog.body.innerHTML,/NEW ONLY/);assert.doesNotMatch(h.state.dialog.body.innerHTML,/OLD/);
});

test('RDEV-002 failed load and timeout each expose a usable explicit retry',async()=>{
 for(const mode of ['failure','timeout']){
  const h=harness(),read=pending();h.state.handler=()=>mode==='failure'?Promise.reject(Error('Offline fixture')):read.promise;
  const opening=h.open('completed-A');
  if(mode==='timeout'){for(const fn of [...h.timers.values()])fn()}
  await opening;assert.match(h.state.dialog.body.innerHTML,/إعادة تحميل الإيصال/);assert.match(h.state.dialog.body.innerHTML,/بيانات الرحلة محفوظة/);
  h.state.handler=body=>({receipt:{tripId:body.tripId,label:'Recovered'}});await h.click('retry');
  assert.match(h.state.dialog.body.innerHTML,/Recovered/);assert.equal(h.calls.length,2);
  if(mode==='timeout'){read.resolve({receipt:{tripId:'completed-A',label:'STALE'}});await flush();assert.doesNotMatch(h.state.dialog.body.innerHTML,/STALE/)}
 }
});

test('RDEV-002 export failure preserves the loaded receipt and permits another attempt',async()=>{
 const h=harness();await h.open('completed-A');const html=h.state.dialog.body.innerHTML;
 h.state.exportHandler=()=>{throw Error('Download denied')};await h.click('download');
 assert.match(h.state.dialog.status.textContent,/تعذر تجهيز/);assert.equal(h.state.dialog.body.innerHTML,html);assert.equal(h.state.dialog.buttons.download.disabled,false);
 h.state.exportHandler=null;await h.click('download');assert.match(h.state.dialog.status.textContent,/بدأ تنزيل/);assert.equal(h.calls.length,1);
});

test('RDEV-002 cancelled or late exports never claim another account shared a receipt',async()=>{
 const h=harness();await h.open('completed-A');
 h.state.exportHandler=()=>({action:'cancelled'});await h.click('share');assert.match(h.state.dialog.status.textContent,/أُلغيت/);assert.doesNotMatch(h.state.dialog.status.textContent,/اكتملت/);
 const exportResult=pending();h.state.exportHandler=()=>exportResult.promise;const sharing=h.click('share'),d=h.state.dialog;
 h.reset();exportResult.resolve({action:'shared'});await sharing;
 assert.equal(d.open,false);assert.equal(d.body.innerHTML,'');assert.doesNotMatch(d.status.textContent,/اكتملت/);assert.equal(h.disposed.length,1);
});

test('RDEV-002 anonymous users do not request receipts and helper loads before the controller',async()=>{
 const h=harness();h.state.authenticated=false;await h.open('completed-A');assert.equal(h.calls.length,0);assert.match(h.state.dialog.body.innerHTML,/سجّل الدخول/);
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('src="/trip-receipt.js"')<html.indexOf('src="/launch-ui.js"'));
});
