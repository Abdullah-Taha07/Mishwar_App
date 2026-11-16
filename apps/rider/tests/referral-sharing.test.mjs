import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const launchSource=readFileSync(new URL('../public/launch-ui.js',import.meta.url),'utf8');
const start=launchSource.indexOf('async function referral(){'),end=launchSource.indexOf("\ndocument.addEventListener('click',e=>{const b=e.target.closest('[data-launch]')",start);
assert.ok(start>=0&&end>start);
const source=launchSource.slice(start,end);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
function harness(navigator={},captain=false){
  const button={disabled:false},status={textContent:''},body={innerHTML:''},dialog={open:true,isConnected:true,querySelector:selector=>selector==='[data-copy]'?button:selector==='[data-error]'?status:selector==='.launch-body'?body:null};
  const state={current:true};
  const sandbox={console,navigator,captain,captainAuthBlocked:false,data:{captain:{id:'captain-A'}},location:{origin:'https://rider.local.test'},window:{MishwarAccountContext:captain?undefined:{capture:()=>({}),isCurrent:()=>state.current}},modal:()=>dialog,call:async()=>({notice:'Local fixture',enabled:false,code:'LOCAL123',reward:0,stats:{invited:0,rewards:0},linked:true}),escape:String,price:String,error(_,err){status.textContent=err.message}};
  vm.createContext(sandbox);vm.runInContext(source+';this.open=referral',sandbox);
  return{c:sandbox,button,status,body,dialog,state,async open(){await sandbox.open()},async share(){await button.onclick()}};
}

test('native share cancellation leaves the invite usable without claiming copied or sent',async()=>{
  const h=harness({share:async()=>{const error=Error('cancelled');error.name='AbortError';throw error}});await h.open();await h.share();
  assert.match(h.status.textContent,/أُلغيت/);assert.doesNotMatch(h.status.textContent,/تم نسخ الدعوة|اكتملت/);assert.equal(h.button.disabled,false);
});

test('clipboard denial and unavailable APIs expose a recoverable message, never false success',async()=>{
  for(const navigator of [{clipboard:{writeText:async()=>{throw Error('denied')}}},{}]){
    const h=harness(navigator);await h.open();await h.share();assert.match(h.status.textContent,/تعذرت/);assert.doesNotMatch(h.status.textContent,/تم نسخ الدعوة|اكتملت/);assert.equal(h.button.disabled,false);
  }
});

test('copy success is announced only after the clipboard promise resolves',async()=>{
  const pending=deferred();let text='';const h=harness({clipboard:{writeText:value=>{text=value;return pending.promise}}});await h.open();const sharing=h.share();assert.equal(h.status.textContent,'');assert.equal(h.button.disabled,true);
  pending.resolve();await sharing;assert.equal(h.status.textContent,'تم نسخ الدعوة');assert.match(text,/LOCAL123/);
});

test('late share completion cannot repaint another account or a closed view',async()=>{
  const pending=deferred(),h=harness({share:()=>pending.promise});await h.open();const sharing=h.share();h.state.current=false;h.dialog.open=false;pending.resolve();await sharing;assert.equal(h.status.textContent,'');
});

test('captain share completion is guarded by immutable captain ID rather than a mutable phone',async()=>{
  const pending=deferred(),h=harness({share:()=>pending.promise},true);await h.open();const sharing=h.share();h.c.data.captain.id='captain-B';pending.resolve();await sharing;assert.equal(h.status.textContent,'');
});

test('an unauthenticated captain cannot load a referral and a blocked session cannot claim late success',async()=>{
  const missing=harness({},true);missing.c.data=null;let called=false;missing.c.call=async()=>{called=true};await missing.open();assert.equal(called,false);assert.match(missing.status.textContent,/سجّل الدخول/);
  const pending=deferred(),h=harness({clipboard:{writeText:()=>pending.promise}},true);await h.open();const sharing=h.share();h.c.captainAuthBlocked=true;pending.resolve();await sharing;assert.equal(h.status.textContent,'');
});
