import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';

const source=readFileSync(new URL('../public/destination-change.js',import.meta.url),'utf8');
const point={name:'New destination <safe>',area:'Riyadh',lat:24.72,lng:46.62};
const trip=patch=>({id:'trip-1',driver_id:'captain-1',status:'riding',method:'cash',fare_halalas:1500,cash_due_halalas:1500,discount_halalas:0,pickup:{name:'Pickup',lat:24.7,lng:46.6},destination:{name:'Original destination',lat:24.71,lng:46.61},...patch});
const proposal=patch=>({id:'change-1',status:'quoted',destination:point,oldFare:1500,newFare:2100,fareDifference:600,oldCashDue:1500,newCashDue:2100,route:{provider:'TomTom',distanceMeters:15000,durationSeconds:1500},expiresAt:new Date(Date.now()+60000).toISOString(),...patch});
const flush=async()=>{for(let index=0;index<10;index++)await Promise.resolve()};
function deferred(){let resolve;return {promise:new Promise(value=>{resolve=value}),resolve:value=>resolve(value)}}
function harness(){
 let owner='rider-A',generation=0,language='ar',reply=async payload=>({change:proposal({status:payload.action==='live_destination_request'?'pending':'quoted'})});
 const events=new Map(),timers=new Map(),dialogs=[],calls=[];let timerSequence=0,refreshes=0;
 class Element{
  constructor(tag='div',attrs={}){this.tag=tag;this.attrs=attrs;this.dataset={};for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;this.children=[];this.value='';this.checked=false;this.disabled='disabled'in attrs;this.open=false;this.textContent='';this._html='';this.listeners=new Map()}
  set innerHTML(value){this._html=value;this.children=[];const regex=/<(\w+)\b([^>]*)>/g;let tag;while(tag=regex.exec(value)){const attrs={};for(const attr of tag[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]??'';this.children.push(new Element(tag[1],attrs))}}
  get innerHTML(){return this._html}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  querySelectorAll(selector){const match=node=>selector==='button'?node.tag==='button':selector.startsWith('[')?selector.slice(1,-1)in node.attrs:false;const results=[];for(const child of this.children){if(match(child))results.push(child);results.push(...child.querySelectorAll(selector))}return results}
  addEventListener(name,fn){this.listeners.set(name,fn)}
  showModal(){this.open=true}
  close(){this.open=false}
  remove(){this.removed=true}
 }
 const context={capture:()=>({accountKey:owner,generation}),isCurrent:ticket=>ticket.accountKey===owner&&ticket.generation===generation,snapshot:()=>({verified:!!owner,status:'ready'})};
 const sandbox={console,Date,Number,Object,String,Math,Promise,Set,Map,clearTimeout:id=>timers.delete(id),setTimeout(fn){timers.set(++timerSequence,fn);return timerSequence},document:{body:{append:node=>dialogs.push(node)},createElement:tag=>new Element(tag),addEventListener:(name,fn)=>events.set('document:'+name,fn)},addEventListener:(name,fn)=>events.set(name,fn),MishwarAccountContext:context,MishwarLang:{get:()=>language},searchMishwarPlaces:async()=>[point],mishwarRiderApi:async payload=>{calls.push(payload);return reply(payload)},refreshMishwarTrip:async()=>{refreshes++}};
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const api=sandbox.MishwarDestinationChange,get=selector=>dialogs.at(-1)?.querySelector('[data-destination-'+selector+']');
 return {api,calls,dialogs,get,reply:value=>{reply=value},lang:value=>{language=value},emit:(name,detail)=>events.get(name)?.({detail}),owner:value=>{owner=value;generation++},refreshes:()=>refreshes,async pick(){const input=get('search');input.value='new';input.oninput();for(const[id,fn]of timers){timers.delete(id);await fn()}await flush();get('results').querySelector('button').onclick()},async quote(){await get('quote').onclick();await flush()}};
}

test('destination controls are restricted to assigned supported trips and escape searched destination names',()=>{
 const h=harness();assert.equal(h.api.html(trip({status:'matching',driver_id:null})),'');assert.equal(h.api.html(trip({status:'completed'})),'');
 for(const patch of [{method:'wallet'},{method:'card'},{discount_halalas:200},{coupon:'CODE'},{negotiation:{minimum:1000}},{options:{stops:[point]}}]){assert.doesNotMatch(h.api.html(trip(patch)),/data-destination-open/);h.api.open(trip(patch));assert.equal(h.dialogs.length,0)}
 const html=h.api.html(trip({destinationChange:proposal({status:'pending'})}));assert.match(html,/بانتظار موافقة/);assert.match(html,/&lt;safe&gt;/);assert.doesNotMatch(html,/<safe>/);
});
test('quote review preserves active destination and requires explicit unchecked fare consent before request',async()=>{
 const h=harness(),t=trip();h.api.html(t);h.api.open();await h.pick();await h.quote();assert.equal(t.destination.name,'Original destination');
 assert.equal(h.calls[0].action,'live_destination_quote');assert.equal(h.get('send').disabled,true);assert.equal(h.get('consent').checked,false);
 assert.match(h.get('review').innerHTML,/21\.00/);assert.match(h.get('review').innerHTML,/\+6\.00/);assert.match(h.get('review').innerHTML,/ليست أجرة المسافة المتبقية/);assert.match(h.get('review').innerHTML,/&lt;safe&gt;/);
 await h.get('send').onclick();assert.equal(h.calls.length,1);
 h.get('consent').checked=true;h.get('consent').onchange({target:h.get('consent')});await h.get('send').onclick();
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[1])),{action:'live_destination_request',tripId:t.id,changeId:'change-1',consent:true});assert.equal('destination'in h.calls[1],false);assert.equal(h.refreshes(),1);assert.match(h.get('body').innerHTML,/بانتظار موافقة/);assert.equal(t.destination.name,'Original destination');
});
test('editing search after quote removes review and consent and cannot send the earlier destination',async()=>{
 const h=harness();h.api.html(trip());h.api.open();await h.pick();await h.quote();const input=h.get('search');input.value='different';input.oninput();assert.equal(h.get('review').innerHTML,'');assert.equal(h.get('quote').disabled,true);assert.equal(h.get('send'),null);assert.equal(h.calls.length,1);
});
test('unavailable, expired, malformed and mismatched provider quotes never render fare consent',async()=>{
 for(const patch of [{status:'unavailable',route:null,newFare:null},{expiresAt:'2000-01-01T00:00:00Z'},{newFare:NaN},{fareDifference:1},{route:{provider:'fabricated',distanceMeters:123,durationSeconds:45}},{route:{provider:'TomTom',stale:true,distanceMeters:123,durationSeconds:45}},{destination:{...point,lat:24.99}}]){
  const h=harness();h.reply(async()=>({change:proposal(patch)}));h.api.html(trip());h.api.open();await h.pick();await h.quote();assert.equal(h.get('consent'),null,JSON.stringify(patch));assert.equal(h.get('send'),null);assert.equal(h.calls.length,1);
 }
});
test('late quote responses after account switch, dialog close, completion or destination update are ignored',async()=>{
 for(const boundary of ['account','close','completion','destination']){
  const h=harness(),pending=deferred(),t=trip();h.reply(()=>pending.promise);h.api.html(t);h.api.open();await h.pick();const quoted=h.quote();
  if(boundary==='account'){h.owner('rider-B');h.emit('mishwar-account-reset')}
  if(boundary==='close')h.api.reset();
  if(boundary==='completion')h.emit('mishwar-trip-updated',{...t,status:'completed'});
  if(boundary==='destination')h.emit('mishwar-trip-updated',{...t,destination:point});
  pending.resolve({change:proposal()});await quoted;assert.equal(h.get('consent'),null,boundary);assert.equal(h.dialogs.at(-1).open,false);assert.equal(h.calls.length,1);
 }
});
test('pending request can be withdrawn once while the trip stays on its current destination',async()=>{
 const h=harness(),t=trip({destinationChange:proposal({status:'pending'})}),pending=deferred();h.reply(()=>pending.promise);h.api.html(t);h.api.open();const button=h.get('withdraw'),operation=button.onclick();await button.onclick();assert.equal(h.calls.length,1);assert.equal(button.disabled,true);pending.resolve({change:proposal({status:'withdrawn'})});await operation;assert.equal(h.calls[0].action,'live_destination_withdraw');assert.match(h.get('body').innerHTML,/تم سحب/);assert.equal(t.destination.name,'Original destination');
});
test('English review and policy failures are actionable and consent states fare difference clearly',async()=>{
 const h=harness();h.lang('en');h.api.html(trip());h.api.open();await h.pick();await h.quote();assert.match(h.get('review').innerHTML,/Fare difference/);assert.match(h.get('review').innerHTML,/not a remaining-distance fare/);assert.match(h.get('review').innerHTML,/explicitly agree/);assert.match(h.get('review').innerHTML,/not live arrival time/);
 h.api.reset();h.reply(async()=>{throw Object.assign(Error('رسالة عربية'),{code:'DESTINATION_POLICY_UNSUPPORTED'})});h.api.open(trip());await h.pick();await h.quote();assert.match(h.get('error').textContent,/Cash, discount and paid-booking policies/);
});
test('an old rejection does not replace a fresh proposal editor on a later tracking poll',async()=>{
 const h=harness(),t=trip({destinationChange:proposal({status:'rejected'})});h.api.html(t);h.api.open();await h.pick();h.emit('mishwar-trip-updated',t);assert.ok(h.get('search'));assert.equal(h.get('quote').disabled,false);
});

test('rider gateway forwards destination actions using only its cookie identity and blocks guests and cross-site mutations',async()=>{
 const nativeFetch=globalThis.fetch,calls=[],token='a'.repeat(64),env={HUB_URL:'https://local-hub.test',HUB_SERVICE_KEY:'local-only-key'};
 const request=(action,{cookie=true,origin='https://rider.test'}={})=>new Request('https://rider.test/api/live',{method:'POST',headers:{origin,'content-type':'application/json',...(cookie?{cookie:'__Host-mishwar_sid='+token}:{})},body:JSON.stringify({action,tripId:'trip-1',changeId:'change-1',destination:point,consent:true,sessionToken:'f'.repeat(64),actor:'forged',platformActor:'forged',email:'forged@example.test'})});
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({change:proposal()})};
 try{for(const action of ['live_destination_quote','live_destination_request','live_destination_withdraw']){
   assert.equal((await worker.fetch(request(action,{cookie:false}),env)).status,401);assert.equal((await worker.fetch(request(action,{origin:'https://evil.test'}),env)).status,403);
   assert.equal((await worker.fetch(request(action),env)).status,200);const upstream=calls.at(-1);assert.equal(upstream.url,env.HUB_URL+'/internal/live-rider');assert.equal(upstream.body.action,action);assert.equal(upstream.body.sessionToken,token);assert.equal(upstream.body.actor,'');assert.equal(upstream.body.platformActor,'');assert.equal(upstream.body.email,'');
  }assert.equal(calls.length,3);
 }finally{globalThis.fetch=nativeFetch}
});

function captainHarness(){
 const source=readFileSync(new URL('../../hub/public/driver.js',import.meta.url),'utf8'),changes=[],listeners=new Map();let language='ar';
 const cash={id:'cash-received',checked:false,value:''},online={setAttribute(){}},panel={scrollTop:0,querySelectorAll:selector=>selector==='input[id]'?[cash]:[],querySelector:()=>null,set innerHTML(value){this.html=value;cash.checked=false}};
 const sandbox={Date,Number,Object,String,Math,JSON,data:{current:trip(),available:true,wallet:{balance:0},requests:[],captain:{name:'Captain'}},tab:'trip',busy:false,availabilitySaving:false,by:selector=>selector==='#online'?online:selector==='#driver-panel'?panel:selector==='#cash-received'?cash:null,money:value=>(value/100).toFixed(2),escapeHtml:value=>String(value??'').replaceAll('<','&lt;'),methods:{cash:'cash'},document:{body:{classList:{toggle(){}},dataset:{}},querySelectorAll:()=>[],getElementById:id=>id===cash.id?cash:null,addEventListener:(name,fn)=>listeners.set(name,fn)},window:{MishwarLang:{get:()=>language}},change:async payload=>{changes.push(payload)},walletForm(){},render(){}};
 vm.createContext(sandbox);const begin=source.indexOf('const destinationText='),end=source.indexOf("by('#online').onclick",begin);assert.ok(begin>0&&end>begin);vm.runInContext(source.slice(begin,end),sandbox);
 const listenerBegin=source.indexOf("document.addEventListener('click',e=>{const b="),listenerEnd=source.indexOf('\nfunction walletForm(',listenerBegin);vm.runInContext(source.slice(listenerBegin,listenerEnd),sandbox);
 return {c:sandbox,cash,panel,changes,language:value=>{language=value},render:()=>vm.runInContext('render()',sandbox),card:t=>vm.runInContext('destinationChangeCard('+JSON.stringify(t)+')',sandbox),click:dataset=>listeners.get('click')({target:{closest:()=>({dataset,hasAttribute:()=>false})}})};
}
test('captain gets explicit immutable request decisions and never an accept control for quotes or expired proposals',()=>{
 const h=captainHarness(),t=trip({destinationChange:proposal({status:'pending'})});assert.match(h.card(t),/قبول الوجهة والأجرة/);assert.match(h.card(t),/رفض التغيير/);assert.match(h.card(t),/data-destination-trip="trip-1"/);assert.match(h.card(t),/data-destination-change="change-1"/);assert.doesNotMatch(h.card(trip({destinationChange:proposal()})),/data-destination-decision/);
 assert.match(h.card(trip({destinationChange:proposal({status:'pending',expiresAt:'2000-01-01'})})),/data-destination-decision="accept"[^>]*disabled/);
 h.language('en');assert.match(h.card(t),/not a remaining-distance fare/);assert.match(h.card(t),/Accept destination and fare/);
 for(const decision of ['accept','reject'])h.click({destinationDecision:decision,destinationTrip:'trip-1',destinationChange:'change-1'});
 assert.deepEqual(JSON.parse(JSON.stringify(h.changes)),[{action:'destination_decide',tripId:'trip-1',changeId:'change-1',accept:true},{action:'destination_decide',tripId:'trip-1',changeId:'change-1',accept:false}]);
});
test('a changed cash total clears earlier cash acknowledgement and completion submits the displayed amount and revision',()=>{
 const h=captainHarness();h.render();h.cash.checked=true;h.render();assert.equal(h.cash.checked,true);h.c.data.current.cash_due_halalas=2100;h.c.data.current.destinationRevision='accepted-change';h.render();assert.equal(h.cash.checked,false);h.cash.checked=true;h.click({status:'completed'});assert.equal(h.changes[0].cashReceived,true);assert.equal(h.changes[0].cashAmount,2100);assert.equal(h.changes[0].destinationRevision,'accepted-change');
 h.c.data.current={...h.c.data.current,id:'trip-2'};h.render();assert.equal(h.cash.checked,false);
});
