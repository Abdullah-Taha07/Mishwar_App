import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/launch-ui.js',import.meta.url),'utf8');
const callSource=source.slice(source.indexOf('async function call('),source.indexOf('\nfunction modal('));
const receiptSource=source.slice(source.indexOf('let receiptView=null;'),source.indexOf('\nasync function reservations('));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {resolve,promise}};
function harness(){
 const state={owner:'A',body:'',fetcher:null};
 const c={captain:false,JSON,Promise,Error,
  window:{MishwarAccountContext:{capture:()=>({accountKey:state.owner}),isCurrent:ticket=>ticket.accountKey===state.owner}},
  fetch:(...args)=>state.fetcher(...args),
 };
 vm.createContext(c);vm.runInContext(callSource+'\nthis.request=call;',c);
 return {c,state};
}
const response=data=>({ok:true,json:async()=>data});

test('launch reads reject a previous account response that arrives after switching owner',async()=>{
 const h=harness(),pending=deferred();h.state.fetcher=()=>pending.promise;
 const request=h.c.request('contacts');h.state.owner='B';pending.resolve(response({items:[{name:'PRIVATE_A'}]}));
 await assert.rejects(request,error=>error.name==='AccountChangedError');
});

test('launch reads guard account ownership across asynchronous JSON parsing',async()=>{
 const h=harness(),body=deferred();h.state.fetcher=async()=>({ok:true,json:()=>body.promise});
 const request=h.c.request('reservations');await Promise.resolve();h.state.owner='B';body.resolve({items:[{destination:'PRIVATE_A'}]});
 await assert.rejects(request,error=>error.name==='AccountChangedError');
});

test('current owner reads remain usable and the server error stays readable',async()=>{
 const h=harness();h.state.fetcher=async()=>response({items:[{name:'Own contact'}]});
 assert.equal((await h.c.request('contacts')).items[0].name,'Own contact');
 h.state.fetcher=async()=>({ok:false,json:async()=>({error:'Local server refusal'})});
 await assert.rejects(h.c.request('contacts'),/Local server refusal/);
});

test('a late receipt cannot populate a closed previous-owner view',async()=>{
 for(const scenario of ['account-changed','dialog-closed']){
  const h=harness(),pending=deferred(),events=new Map();
  const body={innerHTML:'',replaceChildren(){this.innerHTML=''}};
  let normalized=0,rendered=0,released=0;
  h.state.fetcher=()=>pending.promise;
  const dialog={open:true,isConnected:true,querySelector:selector=>selector==='.launch-body'?body:null,querySelectorAll:()=>[],focus(){},close(){this.open=false;this.isConnected=false;this.cleanup?.()}};
  h.c.modal=()=>dialog;h.c.escape=String;h.c.price=String;h.c.error=()=>{};
  h.c.setTimeout=setTimeout;h.c.clearTimeout=clearTimeout;
  h.c.window.addEventListener=(name,fn)=>events.set(name,fn);
  h.c.window.removeEventListener=name=>events.delete(name);
  h.c.window.MishwarReceipt={normalize(){normalized++;return{}},renderHtml(){rendered++;return '<p>PRIVATE_A</p>'},dispose(){}};
  Object.assign(h.c.window.MishwarAccountContext,{
   snapshot:()=>({status:'ready',authenticated:true}),
   readController:()=>{const controller=new AbortController();let active=true;return {controller,release(){if(active){active=false;released++}}}},
   checkResponseOwner:(_data,ticket)=>assert.equal(ticket.accountKey,h.state.owner)
  });
  vm.runInContext(receiptSource+'\nthis.showReceipt=receipt;',h.c);
  const opening=h.c.showReceipt('trip-A');
  assert.match(body.innerHTML,/<p role="status">/);
  assert.match(body.innerHTML,/\u062c\u0627\u0631\u064d \u062a\u062c\u0647\u064a\u0632/);
  if(scenario==='account-changed'){
   h.state.owner='B';
   assert.ok(events.has('mishwar-account-reset'));
   events.get('mishwar-account-reset')();
  }else{
   dialog.close();
  }
  pending.resolve(response({receipt:{merchant:{name:'PRIVATE_A'},receipt_number:'A',pickup:{name:'PRIVATE PICKUP'},destination:{name:'PRIVATE DESTINATION'},fare:100,discount:0,paid:100,method:'cash',note:'Receipt'}}));
  await opening;
  assert.equal(normalized,0,'late reply must not normalize private receipt');
  assert.equal(rendered,0,'late reply must not render private receipt');
  assert.doesNotMatch(body.innerHTML,/PRIVATE_A|PRIVATE PICKUP|PRIVATE DESTINATION/);
  assert.equal(released,1,'request resources must be released');
  assert.equal(dialog.open,false,'stale dialog must stay closed');
  assert.equal(events.has('mishwar-account-reset'),false,'event handlers must be removed');
 }
});
