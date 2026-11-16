import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const file=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const A='a'.repeat(64),B='b'.repeat(64);
const notices=Array.from({length:5},(_,index)=>({id:'server-'+index,title:'Notification '+index,body:'Body '+index}));
const flush=async()=>{for(let index=0;index<6;index++)await new Promise(setImmediate)};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const response=notifications=>({ok:true,json:async()=>({notifications})});

function inbox({notifications=notices,latest,ack}={}){
 const listeners=new Map(),frames=new Map(),calls=[];let frameId=0,marker=null,scroll=0;
 const eventTarget=()=>({addEventListener(name,handler){if(!this.events)this.events=new Map();if(!this.events.has(name))this.events.set(name,new Set());this.events.get(name).add(handler)},removeEventListener(name,handler){this.events?.get(name)?.delete(handler)},emit(name){for(const handler of this.events?.get(name)||[])handler()}});
 const node=()=>Object.assign(eventTarget(),{isConnected:true,open:false,dataset:{},style:{setProperty(){}},classList:{toggle(){},add(){},remove(){}},querySelector:()=>null});
 const modal=node(),root=node(),heading=node(),badge=node(),bell=node(),sheet=node(),body=node();
 const viewport={getBoundingClientRect:()=>({top:0,bottom:250,left:0,right:400,width:400,height:250})};
 modal.getBoundingClientRect=viewport.getBoundingClientRect;modal.close=()=>{modal.open=false;modal.emit('close')};
 root.querySelector=selector=>marker&&selector===`[data-notifications-view="${marker.sequence}"]`?marker:null;
 const nodes=new Map([['#modal',modal],['#modal-content',root],['#modal .modal-head h2',heading],['#notification-count',badge],['#notifications-button',bell],['.booking',sheet]]);
 const document=Object.assign(eventTarget(),{hidden:false,body,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[]});
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const sandbox={console,AbortController,CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},document,innerHeight:600,innerWidth:400,
  sessionStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false}),state:{stage:'home'},$:selector=>nodes.get(selector)||null,esc,
  liveMap:null,render(){},fitDialog(){},showSettings(){},openSearchSheet(){},setTimeout,clearTimeout,
  requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId},cancelAnimationFrame:id=>frames.delete(id),
  addEventListener(name,handler){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(handler)},removeEventListener(name,handler){listeners.get(name)?.delete(handler)},
  dispatchEvent(event){for(const handler of listeners.get(event.type)||[])handler(event)},
  sectionModal(title,html){
   if(marker)marker.isConnected=false;
   modal.open=true;heading.textContent=title;
   const sequence=html.match(/data-notifications-view="(\d+)"/)?.[1];
   marker=Object.assign(node(),{sequence,cards:[],closest:()=>viewport,querySelectorAll(){return this.cards}});
   Object.defineProperty(marker,'innerHTML',{get(){return this.html||''},set(value){this.html=value;this.cards=[...value.matchAll(/<article data-notification-index="(\d+)" data-notification-id="([^"]+)"/g)].map(match=>{
    const index=Number(match[1]);return Object.assign(node(),{dataset:{notificationIndex:match[1],notificationId:match[2]},shown:true,checkVisibility(){return this.shown},getBoundingClientRect:()=>({top:index*100-scroll,bottom:(index+1)*100-scroll,left:0,right:400,width:400,height:100})});
   })}});
  },
  fetch:async(path,options={})=>{
   const body=options.body?JSON.parse(options.body):null;calls.push({path,body,signal:options.signal,rendered:marker?.innerHTML,open:modal.open,hidden:document.hidden});
   return body?.action==='ack'?(ack?ack(body,options):{ok:true}):(latest?latest():response(notifications));
  },
 };
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(file('account-context.js'),sandbox);
 const context=sandbox.MishwarAccountContext;context.applyAuth({authenticated:true,accountKey:A,phoneVerified:true},context.beginAuthRead());
 vm.runInContext(file('ride-ui.js'),sandbox);
 async function frame(){const work=[...frames.values()];frames.clear();for(const callback of work)callback();await flush()}
 return {sandbox,modal,document,badge,calls,context,get marker(){return marker},acks:()=>calls.filter(call=>call.body?.action==='ack'),open:()=>bell.onclick(),frame,async paint(){await frame();await frame()},scroll(value){scroll=value;document.emit('scroll')},hide(value){document.hidden=value;document.emit('visibilitychange')},change(){context.applyAuth({authenticated:true,accountKey:B,phoneVerified:true},context.beginAuthRead())},trip(id='local-trip'){sandbox.dispatchEvent({type:'mishwar-trip-updated',detail:{id,status:'arriving',payment_status:'cash_due'}})}};
}

test('inbox acknowledges only cards painted fully inside its viewport, then follows scrolling',async()=>{
 const h=inbox();await h.open();assert.equal(h.acks().length,0);
 await h.frame();assert.equal(h.acks().length,0,'insertion alone is not display');
 await h.frame();assert.deepEqual(h.acks().map(call=>call.body.ids),[['server-0','server-1']]);
 assert.match(h.acks()[0].rendered,/Notification 0/);
 h.scroll(200);await h.paint();assert.deepEqual(h.acks().map(call=>call.body.ids),[['server-0','server-1'],['server-2','server-3']]);
 h.scroll(400);await h.paint();assert.deepEqual(h.acks().map(call=>call.body.ids),[['server-0','server-1'],['server-2','server-3'],['server-4']]);
});

test('closed or replaced inbox cannot consume a delayed notification response',async()=>{
 for(const replaced of [false,true]){
  const pending=deferred(),h=inbox({latest:()=>pending.promise});const work=h.open();
  if(replaced)h.sandbox.sectionModal('Other view','<p>Different content</p>');else h.modal.close();
  pending.resolve(response(notices));await work;await h.paint();assert.equal(h.acks().length,0);
  assert.doesNotMatch(h.marker.innerHTML,/Notification 0/);
 }
});

test('hidden document and close-before-paint leave server notices unread',async()=>{
 const hidden=inbox();await hidden.open();hidden.hide(true);await hidden.paint();assert.equal(hidden.acks().length,0);
 hidden.hide(false);await hidden.paint();assert.equal(hidden.acks().length,1);
 const closed=inbox();await closed.open();closed.modal.close();await closed.paint();assert.equal(closed.acks().length,0);
});

test('account changes before paint prevent acknowledgement and abort an in-flight acknowledgement',async()=>{
 const before=inbox();await before.open();before.change();await before.paint();assert.equal(before.acks().length,0);
 const pending=deferred(),during=inbox({ack:()=>pending.promise});await during.open();await during.paint();
 assert.equal(during.acks().length,1);const signal=during.acks()[0].signal;assert.equal(signal.aborted,false);
 during.change();assert.equal(signal.aborted,true);pending.resolve({ok:true});await flush();await during.paint();assert.equal(during.acks().length,1);
});

test('local fallback rows and CSS-hidden server cards cannot be acknowledged as displayed server notices',async()=>{
 const local=inbox({notifications:[]});local.trip();assert.equal(local.badge.hidden,false);await local.open();await local.paint();
 assert.equal(local.acks().length,0);assert.equal(local.badge.hidden,true,'local badge clears after its row is exposed');
 const hidden=inbox();await hidden.open();hidden.marker.cards[0].shown=false;await hidden.paint();assert.deepEqual(hidden.acks()[0].body.ids,['server-1']);
 hidden.marker.cards[0].shown=true;hidden.document.emit('scroll');await hidden.paint();assert.deepEqual(hidden.acks()[1].body.ids,['server-0']);
});

test('an older inbox response cannot replace or acknowledge a newer opening',async()=>{
 const pending=deferred();let reads=0;
 const h=inbox({latest:()=>++reads===1?pending.promise:response([{id:'new-notice',title:'Newest opening',body:'New body'}])});
 const first=h.open();await h.open();await h.paint();pending.resolve(response(notices));await first;await h.paint();
 assert.match(h.marker.innerHTML,/Newest opening/);assert.doesNotMatch(h.marker.innerHTML,/Notification 0/);
 assert.deepEqual(h.acks().flatMap(call=>call.body.ids),['new-notice']);
});

test('new trip notifications arriving during inbox loading and acknowledgement remain unread',async()=>{
 const loading=deferred(),h=inbox({latest:()=>loading.promise});
 h.trip('before-opening');const open=h.open();h.trip('while-loading');
 loading.resolve(response([]));await open;await h.paint();assert.equal(h.acks().length,0);
 assert.equal(h.badge.textContent,'1','the opening cannot clear a later arrival');
 assert.doesNotMatch(h.marker.innerHTML,/while-loading/,'the local list is a snapshot');
 const acknowledging=deferred(),duringAck=inbox({notifications:[notices[0]],ack:()=>acknowledging.promise});
 await duringAck.open();await duringAck.paint();assert.equal(duringAck.acks().length,1);
 duringAck.trip('while-acknowledging');acknowledging.resolve({ok:true});await flush();await duringAck.paint();
 assert.equal(duringAck.badge.hidden,false);assert.equal(duringAck.badge.textContent,'1','another paint cannot clear newer unseen trips');
});

test('displaying unrelated server notices preserves the badge for an unshown local trip event',async()=>{
 let reads=0;const h=inbox({latest:()=>response(++reads===1?[notices[0]]:[])});
 h.trip('local-unseen-trip');await h.open();await h.paint();
 assert.deepEqual(h.acks().flatMap(call=>call.body.ids),['server-0']);
 assert.doesNotMatch(h.marker.innerHTML,/local-unseen-trip/);
 assert.equal(h.badge.hidden,false);assert.equal(h.badge.textContent,'1','server display cannot consume local unread IDs');
 h.modal.close();await h.open();await h.paint();
 assert.match(h.marker.innerHTML,/local-unseen-trip/);assert.equal(h.badge.hidden,true,'the local badge clears only when that local row is shown');
});

test('acknowledgements respect the endpoint batch limit even with a larger inbox response',async()=>{
 const h=inbox({notifications:Array.from({length:18},(_,index)=>({id:'many-'+index,title:'Notice',body:'Body'}))});
 await h.open();h.sandbox.innerHeight=4000;h.marker.closest=()=>({getBoundingClientRect:()=>({top:0,bottom:4000,left:0,right:400,width:400,height:4000})});
 for(let index=0;index<6;index++)await h.paint();
 assert.ok(h.acks().every(call=>call.body.ids.length<=5));assert.equal(new Set(h.acks().flatMap(call=>call.body.ids)).size,18);
});

function pushWorker(app,{windows=[],notifications=notices,display}={}){
 const handlers={},calls=[],shown=[],messages=[];
 const source=readFileSync(new URL('../../'+app+'/scripts/sw.template.js',import.meta.url),'utf8').replace('__MISHWAR_VERSION__','test-build').replace('const SHELL=__MISHWAR_ASSETS__','const SHELL=[]');
 const sandbox={URL,console,self:{addEventListener:(name,handler)=>{handlers[name]=handler},clients:{matchAll:async()=>windows.map(visibilityState=>({visibilityState,postMessage:message=>messages.push(message)}))},registration:{showNotification:async(title,options)=>{shown.push(options.tag);if(display)await display(title,options)}}},
  fetch:async(path,options={})=>{calls.push(options.body?JSON.parse(options.body):{action:'latest'});return options.body?{ok:true}:new Response(JSON.stringify({notifications}),{headers:{'Content-Type':'application/json'}})},
 };
 vm.runInNewContext(source,sandbox);
 return {calls,shown,messages,push(){let promise;handlers.push({waitUntil:value=>{promise=value}});return promise}};
}

for(const app of ['rider','hub']){
 test(app+' push with a visible window refreshes without consuming notifications',async()=>{
  const h=pushWorker(app,{windows:['visible','hidden']});await h.push();assert.equal(h.calls.length,0);assert.equal(h.shown.length,0);
  assert.equal(h.messages.length,2);assert.ok(h.messages.every(message=>message.type===(app==='rider'?'REFRESH_TRIP':'REFRESH_DRIVER')));
 });
 test(app+' push acknowledges only the successful displays among the first three rows',async()=>{
  const pending=deferred(),h=pushWorker(app,{display:async(_,options)=>{if(options.tag==='mishwar-server-0')await pending.promise;if(options.tag==='mishwar-server-1')throw Error('Display denied')}});
  const work=h.push();await flush();assert.equal(h.calls.filter(call=>call.action==='ack').length,0,'showNotification must fulfill before acknowledgement');
  pending.resolve();await work;
  assert.deepEqual(h.shown,['mishwar-server-0','mishwar-server-1','mishwar-server-2']);
  assert.deepEqual(h.calls.filter(call=>call.action==='ack').map(call=>call.ids),[['server-0','server-2']]);
 });
 test(app+' push leaves every row unread if all actual displays fail',async()=>{
  const h=pushWorker(app,{display:async()=>{throw Error('Display denied')}});await h.push();assert.equal(h.calls.filter(call=>call.action==='ack').length,0);
  const empty=pushWorker(app,{notifications:[]});await empty.push();assert.deepEqual(empty.shown,['mishwar-update']);assert.equal(empty.calls.filter(call=>call.action==='ack').length,0);
 });
}
