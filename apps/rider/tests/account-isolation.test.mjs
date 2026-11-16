import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const A='a'.repeat(64),B='b'.repeat(64);
const file=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate)};
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const trip=(id='trip-A')=>({id,status:'riding',driver_id:'captain-A',pickup:{name:'Private pickup '+id,lat:24.7,lng:46.6},destination:{name:'Private destination '+id,lat:24.71,lng:46.61},fare_halalas:2400,discount_halalas:0,method:'cash',payment_status:'cash_due'});
const live=(owner,ride=null)=>({accountKey:owner,verified:!!owner,trip:ride,recentTrip:null,wallet:{balance:owner===A?43210:0,entries:[]},payments:{cash:true,wallet:true,card:false,applepay:false},ratings:{average:4.5,receivedCount:1}});

function harness({owner=A,ride=trip(),auth=true,extra=[],htmlOrder=false}={}){
  const listeners=new Map(),elements=new Map(),calls=[],events=[],notices=[],storage=new Map(),intervals=[];
  const node=selector=>{
    if(elements.has(selector))return elements.get(selector);
    const handlers=new Map();
    const value={selector,open:false,isConnected:true,textContent:'',innerHTML:'',disabled:false,style:{setProperty(){}},classList:{add(){},remove(){},toggle(){}},querySelector:()=>null,querySelectorAll:()=>[],insertAdjacentHTML(_,html){this.innerHTML+=html},append(){},prepend(){},remove(){this.isConnected=false},setAttribute(){},removeAttribute(){},scrollTo(){},addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn)},close(){this.open=false;for(const fn of handlers.get('close')||[])fn()},showModal(){this.open=true}};
    elements.set(selector,value);return value;
  };
  for(const selector of ['#panel','#modal','#modal-content','#modal .modal-head h2','#map-status-text','.workspace','.booking','#toast','#rider-email-verify','#refresh-verification','#rider-logout','#notifications-button','#notification-count'])node(selector);
  const query=selector=>elements.get(selector)||null;
  const state={owner,ride,handler:null,profileWrites:0,mapClears:0,routeClears:0};
  const sandbox={console:{warn(){},error(){}},AbortController,URLSearchParams,Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},navigator:{onLine:true},location:{origin:'https://offline.test',pathname:'/',search:'',hash:''},history:{replaceState(){}},Date,JSON,Math,Map,Set,Promise,setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval(){},setTimeout:()=>1,clearTimeout(){},queueMicrotask,requestAnimationFrame:()=>1,cancelAnimationFrame(){},matchMedia:()=>({matches:false,addEventListener(){}}),
    sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    document:{hidden:false,body:node('body'),querySelector:query,querySelectorAll:()=>[],createElement:()=>node('created-'+elements.size),addEventListener(name,fn){if(!listeners.has('document:'+name))listeners.set('document:'+name,[]);listeners.get('document:'+name).push(fn)}},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)},
    dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);return true},
    fetch:async(path,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({path,body,signal:options.signal});if(state.handler){const result=state.handler(path,body,options);if(result!==undefined)return result}if(path==='/api/auth/session')return response(state.owner?{authenticated:true,phoneVerified:true,accountKey:state.owner,profile:{name:'Account '+state.owner[0],phone:state.owner===A?'+966500000001':'+966500000002',email:state.owner[0]+'@example.test'}}:{authenticated:false,accountKey:null});if(path==='/api/auth/logout'){state.owner=null;return response({ok:true})}if(path==='/api/live'&&['live_session','live_watch'].includes(body?.action))return response(live(state.owner,state.owner===A?state.ride:null));if(path==='/api/live'&&body?.action==='live_quote')return response({id:'quote-'+state.owner[0],accountKey:state.owner,payable:2400,expiresAt:'2030-01-01T00:00:00Z',offers:[],route:null});if(path==='/api/live'&&body?.action==='live_book')return response({trip:trip('booked-A')});if(path==='/api/live'&&body?.action==='live_history')return response({trips:[],nextOffset:null,ratings:{average:4.5,receivedCount:1}});throw Error('Unexpected offline request '+path+' '+body?.action)},
    $:query,esc:value=>String(value??''),icon:()=>'',profile:{name:'Cached private account',phone:'+966599999999'},state:{stage:'home',destination:null,tier:'economy',rating:0},pickupPoint:null,searchNote:'',timer:null,validPoint:p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng),render(){},setStage(stage){sandbox.state.stage=stage;sandbox.render()},getDemoFare:()=>({price:24}),fitLocations(){},fitDialog(){},showSettings(){},openSearchSheet(){},closeAddressEditor(){},toast:text=>notices.push(text),sectionModal(title,html){node('#modal').open=true;node('#modal-content').innerHTML=html;node('#modal .modal-head h2').textContent=title},showAccount(){},showWallet(){},showPayment(){},showPromo(){},showTrips(){},save(k,v){state.profileWrites++;sandbox.dispatchEvent(new sandbox.Event('mishwar-profile-saved'))},updateIdentity(){},MishwarTracking:{clear(){state.mapClears++}},drawMishwarRoute(route){if(route===null)state.routeClears++},setRiderRatings(value){sandbox.mishwarRiderRatings=value},paintRiderRatings(){},
  };
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  if(htmlOrder){
    // Follow the real entry point: manually supplying the context hid a broken boot.
    const required=['account-context.js','live-booking.js','rider-auth.js'];
    const scripts=[...file('index.html').matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
      .map(match=>new URL(match[1],'https://offline.test').pathname.slice(1))
      .filter(name=>required.includes(name));
    assert.equal(scripts.length,required.length,'entry point must include each account bootstrap script');
    for(const name of scripts)vm.runInContext(file(name),sandbox,{filename:name});
  }else{
    vm.runInContext(file('account-context.js'),sandbox,{filename:'account-context.js'});
    vm.runInContext(file('live-booking.js'),sandbox,{filename:'live-booking.js'});
    for(const name of extra)vm.runInContext(file(name),sandbox,{filename:name});
    if(auth)vm.runInContext(file('rider-auth.js'),sandbox,{filename:'rider-auth.js'});
  }
  return {c:sandbox,state,calls,events,notices,storage,elements,node,intervals,listeners,load:name=>vm.runInContext(file(name),sandbox,{filename:name}),async click(attribute){const button={dataset:{},hasAttribute:key=>key===attribute};const event={target:{closest:()=>button}};await Promise.all((listeners.get('document:click')||[]).map(fn=>fn(event)))},async change(next){state.owner=next;const context=sandbox.MishwarAccountContext,ticket=context.beginAuthRead();context.applyAuth(next?{authenticated:true,accountKey:next,phoneVerified:true}:{authenticated:false,accountKey:null},ticket);context.notifyAuth();await flush()}};
}

test('HTML bootstrap initializes account ownership and restores its signed-in trip',async()=>{
  const h=harness({htmlOrder:true});
  await flush();
  assert.equal(h.c.MishwarAccountContext.snapshot().accountKey,A);
  assert.equal(h.c.mishwarTripActive,true);
  assert.ok(h.calls.some(call=>call.body?.action==='live_session'));
  assert.match(h.node('#panel').innerHTML,/trip-A/);
});

test('bootstrap waits for account ownership and restores the signed-in current trip',async()=>{
  const h=harness({auth:false});
  assert.equal(h.calls.length,0);
  assert.equal(h.c.mishwarTripActive,false);
  h.load('rider-auth.js');await flush();
  assert.equal(h.c.MishwarAccountContext.snapshot().accountKey,A);
  assert.equal(h.c.mishwarCurrentTripId,'trip-A');
  assert.equal(h.c.mishwarTripActive,true);
  assert.equal(h.storage.get('mishwar-live-trip:'+A),'trip-A');
  assert.equal(h.storage.has('mishwar-live-trip'),false);
});

test('logout immediately clears private trip state, routes, wallet view and scoped tracking',async()=>{
  const h=harness();await flush();
  h.storage.set('mishwar-checkout:'+A,JSON.stringify({id:'paid-A',accountKey:A}));
  await h.node('#rider-logout').onclick?.();
  // Open the actual account screen to obtain its actual logout handler.
  if(h.state.owner){h.c.showAccount();await h.node('#rider-logout').onclick()}
  await flush();
  assert.equal(h.c.mishwarTripActive,false);
  assert.equal(h.c.mishwarCurrentTripId,'');
  assert.equal(h.c.state.stage,'home');
  assert.equal(h.c.pickupPoint,null);
  assert.equal(h.c.state.destination,null);
  assert.ok(h.state.mapClears>0&&h.state.routeClears>0);
  assert.ok(h.storage.has('mishwar-checkout:'+A),'pending payment must remain available to its owner');
  h.c.showWallet();assert.doesNotMatch(h.node('#modal-content').innerHTML,/432\.10/);
});

test('a delayed account A watch cannot repopulate account B or publish A trip events',async()=>{
  const h=harness();await flush();
  const old=deferred();h.state.handler=(_,body)=>body?.action==='live_watch'?old.promise:undefined;
  const request=h.c.refreshMishwarTrip();
  const before=h.events.filter(e=>e.type==='mishwar-trip-updated').length;
  await h.change(B);
  old.resolve(response(live(A,trip('late-A'))));await request;await flush();
  assert.equal(h.c.MishwarAccountContext.snapshot().accountKey,B);
  assert.equal(h.c.mishwarCurrentTripId,'');
  assert.equal(h.c.mishwarTripActive,false);
  assert.equal(h.events.filter(e=>e.type==='mishwar-trip-updated').length,before);
});

test('authoritative no-trip clears an old trip while temporary network failure preserves it',async()=>{
  const h=harness();await flush();
  h.state.handler=(_,body)=>body?.action==='live_watch'?Promise.reject(Error('Offline')):undefined;
  await h.c.refreshMishwarTrip();assert.equal(h.c.mishwarCurrentTripId,'trip-A');
  h.state.handler=(_,body)=>body?.action==='live_watch'?response(live(A,null)):undefined;
  await h.c.refreshMishwarTrip();
  assert.equal(h.c.mishwarCurrentTripId,'');assert.equal(h.c.state.stage,'home');
});

test('same-owner profile refresh preserves the trip and does not publish an account reset',async()=>{
  const h=harness();await flush();
  const resets=h.events.filter(e=>e.type==='mishwar-account-reset').length;
  const before=h.c.MishwarAccountContext.snapshot().generation;
  await h.change(A);
  assert.equal(h.c.mishwarCurrentTripId,'trip-A');
  assert.equal(h.c.MishwarAccountContext.snapshot().generation,before);
  assert.equal(h.events.filter(e=>e.type==='mishwar-account-reset').length,resets);
});

test('late quote and booking responses are discarded without retrying server mutations',async()=>{
  const h=harness({ride:null});await flush();
  h.c.pickupPoint={name:'From A',lat:24.7,lng:46.6};h.c.state.destination={name:'To A',lat:24.71,lng:46.61};
  await h.c.getMishwarBookingQuote();
  const booked=deferred();h.state.handler=(_,body)=>body?.action==='live_book'?booked.promise:undefined;
  const pending=h.c.requestLocalRide();await flush();
  await h.change(B);booked.resolve(response({trip:trip('late-book-A')}));await pending;await flush();
  assert.equal(h.c.mishwarCurrentTripId,'');assert.equal(h.c.state.stage,'home');
  assert.equal(h.calls.filter(x=>x.body?.action==='live_book').length,1);
  assert.equal(h.calls.find(x=>x.body?.action==='live_book').signal,undefined,'do not abort a submitted mutation');
  const quote=deferred();h.state.handler=(_,body)=>body?.action==='live_quote'?quote.promise:undefined;
  h.c.pickupPoint={name:'From B',lat:24.7,lng:46.6};h.c.state.destination={name:'To B',lat:24.71,lng:46.61};
  const waiting=h.c.getMishwarBookingQuote();const rejected=assert.rejects(waiting,{name:'AccountChangedError'});await h.change(null);quote.resolve(response({id:'late-quote-B',payable:2400}));await rejected;
});

test('old auth-session response cannot restore an account after a logout transition',async()=>{
  const h=harness({auth:false});const old=deferred();
  h.state.handler=path=>path==='/api/auth/session'?old.promise:undefined;
  h.load('rider-auth.js');
  const generation=h.c.MishwarAccountContext.beginTransition('logout');
  old.resolve(response({authenticated:true,accountKey:A,phoneVerified:true,profile:{name:'Old account',phone:'+966500000001'}}));await flush();
  assert.equal(h.c.MishwarAccountContext.snapshot().status,'transitioning');
  assert.equal(h.c.MishwarAccountContext.snapshot().accountKey,null);
  assert.equal(h.c.mishwarTripActive,false);
  assert.equal(h.c.MishwarAccountContext.isTransitionCurrent(generation),true);
});

test('failed logout revalidates the server session and reports failure without duplicate booking',async()=>{
  const h=harness();await flush();h.c.showAccount();
  h.state.handler=path=>path==='/api/auth/logout'?response({error:'Offline logout failure'},503):undefined;
  await h.node('#rider-logout').onclick();await flush();
  assert.equal(h.c.MishwarAccountContext.snapshot().accountKey,A);
  assert.equal(h.c.mishwarCurrentTripId,'trip-A');
  assert.ok(h.notices.includes('Offline logout failure'));
  assert.equal(h.calls.filter(x=>x.body?.action==='live_book').length,0);
});

test('same-owner OTP verification invalidates old requests without resetting the account',async()=>{
  const h=harness({auth:false,ride:null});const context=h.c.MishwarAccountContext;
  context.applyAuth({authenticated:true,accountKey:A,phoneVerified:false},context.beginAuthRead());await flush();
  const resets=h.events.filter(e=>e.type==='mishwar-account-reset').length,ticket=context.capture();
  context.applyAuth({authenticated:true,accountKey:A,phoneVerified:true},context.beginAuthRead());await flush();
  assert.equal(context.isCurrent(ticket),false);
  assert.equal(context.snapshot().verified,true);
  assert.equal(h.events.filter(e=>e.type==='mishwar-account-reset').length,resets);
});

test('checkout belonging to A is preserved and never verified or booked under B',async()=>{
  const h=harness({owner:B,ride:null,auth:false});
  const saved={id:'intent-A',accountKey:A,purpose:'trip',quote:{id:'quote-A'}};
  h.storage.set('mishwar-checkout:'+A,JSON.stringify(saved));
  h.storage.set('mishwar-checkout',JSON.stringify({id:'legacy-unknown-owner'}));
  h.c.location.search='?id=provider-payment-A&payment_intent=intent-A';h.load('rider-auth.js');await flush();
  assert.equal(h.calls.filter(x=>['live_payment_verify','live_book'].includes(x.body?.action)).length,0);
  assert.deepEqual(JSON.parse(h.storage.get('mishwar-checkout:'+A)),saved);
  assert.ok(h.storage.has('mishwar-checkout'),'legacy payment metadata must not be erased');
});

test('late notification response is neither rendered nor acknowledged after an owner change',async()=>{
  const h=harness({extra:['ride-ui.js']});await flush();const pending=deferred();
  h.state.handler=path=>path==='/api/background'?pending.promise:undefined;
  const request=h.node('#notifications-button').onclick();await h.change(B);
  pending.resolve(response({notifications:[{id:'private-A',title:'Private A message',body:'Private A body'}]}));await request;
  assert.doesNotMatch(h.node('#modal-content').innerHTML,/Private A/);
  assert.equal(h.calls.filter(x=>x.body?.action==='ack').length,0);
});

test('late history cannot repaint account A trips or ratings after switching to B',async()=>{
  const h=harness();await flush();h.node('#journey-result');h.node('#journey-more');h.load('rider-history.js');
  const pending=deferred();h.state.handler=(_,body)=>body?.action==='live_history'?pending.promise:undefined;
  const request=h.c.showTrips();await h.change(B);pending.resolve(response({trips:[trip('private-history-A')],nextOffset:null,ratings:{average:1,receivedCount:99}}));await request;
  assert.doesNotMatch(h.node('#journey-result').innerHTML,/private-history-A/);
  assert.notEqual(h.c.mishwarRiderRatings?.receivedCount,99);
});

test('old realtime credentials cannot create an account A channel after switching to B',async()=>{
  const h=harness();await flush();const pending=deferred();let first=true,constructed=0;
  h.c.Ably={Realtime:class{constructor(){constructed++}}};
  h.state.handler=(_,body)=>body?.action==='live_realtime_token'?(first?(first=false,pending.promise):response({configured:false})):undefined;
  h.load('realtime-client.js');await h.change(B);pending.resolve(response({configured:true,channel:'private-A',tokenRequest:{token:'offline'}}));await flush();
  assert.equal(constructed,0);assert.equal(h.c.mishwarRealtimeConnected,false);
});

test('payment UI initialization arriving late does not mount a form under a different account',async()=>{
  const h=harness({ride:null});await flush();const pending=deferred();let form,initialized=0;
  h.c.walletFundingForm=()=>'';h.c.bindWalletFunding=(_,options)=>form=options;h.c.Moyasar={init(){initialized++}};
  h.state.handler=(_,body)=>body?.action==='live_payment_init'?pending.promise:undefined;
  await h.click('data-live-topup');const request=form.pay({amount:1000,method:'card'});await h.change(B);
  pending.resolve(response({id:'intent-A',amount:1000,method:'card'}));await request;
  assert.equal(initialized,0);assert.equal(h.storage.has('mishwar-checkout:'+B),false);
});

test('a completed old payment preserves its provider reference without verifying or booking as B',async()=>{
  const h=harness({ride:null});await flush();let form,payment;
  h.c.walletFundingForm=()=>'';h.c.bindWalletFunding=(_,options)=>form=options;h.c.Moyasar={init(options){payment=options}};
  h.state.handler=(_,body)=>body?.action==='live_payment_init'?response({id:'intent-A',amount:1000,method:'card'}):undefined;
  await h.click('data-live-topup');await form.pay({amount:1000,method:'card'});await h.change(B);
  await payment.on_completed({id:'provider-A',status:'paid'});
  assert.equal(JSON.parse(h.storage.get('mishwar-checkout:'+A)).paymentId,'provider-A');
  assert.equal(h.calls.filter(x=>['live_payment_verify','live_book'].includes(x.body?.action)).length,0);
});

test('late payment verification preserves owner A recovery metadata and never books as B',async()=>{
  const h=harness({auth:false,ride:null});const pending=deferred();
  h.storage.set('mishwar-checkout:'+A,JSON.stringify({id:'intent-A',accountKey:A,purpose:'trip',quote:{id:'quote-A'}}));
  h.c.location.search='?id=provider-A&payment_intent=intent-A';h.state.handler=(_,body)=>body?.action==='live_payment_verify'?pending.promise:undefined;
  h.load('rider-auth.js');await flush();assert.equal(h.calls.filter(x=>x.body?.action==='live_payment_verify').length,1);
  await h.change(B);pending.resolve(response({ok:true}));await flush();
  assert.ok(h.storage.has('mishwar-checkout:'+A));assert.equal(h.calls.filter(x=>x.body?.action==='live_book').length,0);
});

test('paid trip checkout is retained on booking failure and cleared only after retry succeeds',async()=>{
  const h=harness({ride:null});await flush();let payment,bookAttempts=0;
  h.c.pickupPoint={name:'Pickup',lat:24.7,lng:46.6};h.c.state.destination={name:'Destination',lat:24.71,lng:46.61};
  h.c.Moyasar={init(options){payment=options}};
  h.state.handler=(_,body)=>{
    if(body?.action==='live_payment_init')return response({id:'intent-paid-retry',amount:2400,method:'card',publishableKey:'pk_test_offline_only',metadata:{intent_id:'intent-paid-retry'}});
    if(body?.action==='live_payment_verify')return response({verified:true});
    if(body?.action==='live_book'){bookAttempts++;return bookAttempts===1?response({error:'Temporary booking error'},400):response({trip:trip('booked-retry')},201)}
  };
  await h.c.getMishwarBookingQuote();
  const selected={dataset:{method:'card'},hasAttribute:()=>false};
  await Promise.all((h.listeners.get('document:click')||[]).map(fn=>fn({target:{closest:()=>selected}})));
  await h.c.requestLocalRide();assert.ok(payment);
  await payment.on_completed({id:'provider-paid-001',status:'paid'});
  const key='mishwar-checkout:'+A;
  assert.ok(h.storage.has(key),'payment metadata stays until booking succeeds');
  assert.equal(JSON.parse(h.storage.get(key)).paymentId,'provider-paid-001');
  assert.match(h.node('#modal-content').innerHTML,/إنشاء الرحلة لم ينجح/);
  assert.equal(h.c.mishwarTripActive,false);
  const retry={dataset:{},hasAttribute:key=>key==='data-resume-paid-book'};
  for(const fn of h.listeners.get('document:click')||[])await fn({target:{closest:()=>retry},preventDefault(){}});
  await flush();
  assert.equal(bookAttempts,2);
  assert.equal(h.storage.has(key),false);
  assert.equal(h.storage.get('mishwar-live-trip:'+A),'booked-retry');
});

test('webhook-confirmed payment without browser callback offers explicit recovery after login',async()=>{
  const h=harness({ride:null,auth:false});
  const key='mishwar-checkout:'+A;
  h.storage.set(key,JSON.stringify({id:'intent-webhook-paid',accountKey:A,purpose:'trip',quote:{id:'quote-webhook-paid',payable:2400},method:'card',arrivalNote:'Pickup gate'}));
  h.state.handler=(_,body)=>{
    if(body?.action==='live_payment_status')return response({status:'paid',usedTripId:null});
    if(body?.action==='live_book')return response({trip:trip('after-webhook')},201);
  };
  h.load('rider-auth.js');await flush();
  assert.match(h.node('#modal-content').innerHTML,/متابعة الدفع والحجز/);
  assert.equal(h.calls.filter(x=>x.body?.action==='live_book').length,0,'no automatic booking without rider consent');
  const retry={dataset:{},hasAttribute:key=>key==='data-resume-paid-book'};
  for(const fn of h.listeners.get('document:click')||[])await fn({target:{closest:()=>retry},preventDefault(){}});
  await flush();
  assert.equal(h.calls.filter(x=>x.body?.action==='live_book').length,1);
  assert.equal(h.storage.has(key),false);
  assert.equal(h.storage.get('mishwar-live-trip:'+A),'after-webhook');
});
