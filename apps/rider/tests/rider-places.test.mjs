import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const A='a'.repeat(64),B='b'.repeat(64);
const contextSource=readFileSync(new URL('../public/account-context.js',import.meta.url),'utf8');
const source=readFileSync(new URL('../public/rider-speed.js',import.meta.url),'utf8');
const point=(name='Home')=>({name,area:'Local fixture',lat:24.7,lng:46.6});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}};
function harness(owner=A){
  const data=new Map(),reads=[],choices=[],notices=[],events=new Map(),modal={open:false,close(){this.open=false},classList:{add(){},remove(){}}};
  let buttons=[];
  const sandbox={console,Map,Set,Promise,AbortController,JSON,Number,String,Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
    addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn)},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event)},
    document:{querySelector:selector=>selector==='#modal'?modal:null,querySelectorAll:()=>buttons,addEventListener(name,fn){if(!events.has('document:'+name))events.set('document:'+name,[]);events.get('document:'+name).push(fn)}},
    $:selector=>selector==='#modal'?modal:null,location:{reload(){}},profile:{phone:'0500000001',home:'Legacy private address'},state:{stage:'home',destination:null},pickupPoint:point('Current pickup'),mishwarTripActive:false,
    localStorage:{setItem(key,value){if(sandbox.storageFail)throw Error('quota');data.set(key,value)}},
    read(key,fallback){reads.push(key);try{return JSON.parse(data.get(key))??fallback}catch{return fallback}},save(){throw Error('No global profile or legacy key write is permitted')},
    validPoint:p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng),esc:value=>String(value??'').replace(/[<>&"]/g,'_'),
    render(){},choose(value){choices.push(value);sandbox.state.destination=value},showTrips(){},toast:message=>notices.push(message),showRiderLogin(){sandbox.loginShown=true},
    sectionModal(title,html){sandbox.title=title;sandbox.html=html;modal.open=true;buttons=[...html.matchAll(/data-favorite-(use|search|map|current|delete)="(home|work)"/g)].map(match=>({dataset:{['favorite'+match[1][0].toUpperCase()+match[1].slice(1)]:match[2]},onclick:null}))},
    openSearchSheet(target){sandbox.searchTarget=target},startMapPick(target){sandbox.mapTarget=target},setPickup(value){sandbox.pickupPoint=value},setStage(stage){sandbox.state.stage=stage},reverseAddress:async value=>value,
  };
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(contextSource,sandbox);
  const auth=next=>{sandbox.profile={phone:next===A?'0500000001':'0500000002'};const context=sandbox.MishwarAccountContext;context.applyAuth(next?{authenticated:true,phoneVerified:true,accountKey:next}:{authenticated:false,accountKey:null},context.beginAuthRead());context.notifyAuth()};
  auth(owner);vm.runInContext(source,sandbox);
  return{c:sandbox,data,reads,choices,notices,auth,escape(){for(const fn of events.get('document:keydown')||[])fn({key:'Escape'})},open(name='home'){const button={dataset:{action:'saved-'+name},hasAttribute:()=>false};for(const fn of events.get('document:click')||[])fn({target:{closest:()=>button},preventDefault(){},stopImmediatePropagation(){}})},click(kind){const button=buttons.find(button=>button.dataset['favorite'+kind]);assert.ok(button,'favorite '+kind+' control exists');button.onclick({preventDefault(){},stopPropagation(){}})},key:next=>'mishwar-places-v3:'+next};
}

test('saved places use immutable account ownership, never phone/guest legacy keys',()=>{
  const h=harness();h.data.set('mishwar-places-v2:0500000001',JSON.stringify({home:point('Legacy secret')}));
  h.open();h.click('Current');
  assert.equal(JSON.parse(h.data.get(h.key(A))).home.name,'Current pickup');
  assert.ok(!h.reads.some(key=>key.includes('places-v2')||key.includes('guest')));
  h.auth(B);h.open();assert.doesNotMatch(h.c.html,/Current pickup|Legacy secret/);
  h.click('Current');assert.equal(JSON.parse(h.data.get(h.key(B))).home.name,'Current pickup');
  h.auth(A);h.c.profile.phone='0509999999';h.c.render();h.open();assert.match(h.c.html,/Current pickup/);
});

test('existing home and work have explicit use, edit and delete controls',()=>{
  const h=harness();h.open();h.click('Current');h.open();
  h.click('Use');assert.equal(h.choices.at(-1).name,'Current pickup');
  h.open();h.click('Search');assert.equal(h.c.searchTarget,'destination');h.c.choose(point('Updated home'));
  h.open();assert.match(h.c.html,/Updated home/);h.click('Delete');
  assert.equal(JSON.parse(h.data.get(h.key(A))).home,undefined);
  h.open('work');h.click('Map');assert.equal(h.c.mapTarget,'destination');h.c.choose(point('Work address'));
  assert.equal(JSON.parse(h.data.get(h.key(A))).work.name,'Work address');
});

test('a pending favorite selection cannot save into another account or into a guest key',()=>{
  const h=harness();h.open();h.click('Search');h.auth(B);h.c.choose(point('Old account selection'));
  assert.equal(h.data.has(h.key(A)),false);assert.equal(h.data.has(h.key(B)),false);
  h.auth(null);h.open();assert.equal(h.c.loginShown,true);assert.equal(h.data.size,0);
});

test('failed persistence leaves the saved place unchanged and does not claim success',()=>{
  const h=harness();h.open();h.click('Current');const before=h.data.get(h.key(A));h.c.storageFail=true;h.open();h.click('Delete');
  assert.equal(h.data.get(h.key(A)),before);assert.match(h.notices.at(-1),/لم يُحفظ/);
});

test('late reverse-geocoding cannot rewrite the next account destination or pickup',async()=>{
  const h=harness(),pending=deferred();h.c.reverseAddress=()=>pending.promise;
  h.c.onMishwarMapTap({lat:24.8,lng:46.7});h.auth(B);h.c.pickupPoint=point('B pickup');h.c.state.destination=point('B destination');
  pending.resolve(point('A private named address'));await pending.promise;await Promise.resolve();
  assert.equal(h.c.pickupPoint.name,'B pickup');assert.equal(h.c.state.destination.name,'B destination');
});

test('an unresolved place suggestion keeps its owner-bound save intent until a valid point arrives',()=>{
  const h=harness();h.open();h.click('Search');h.c.choose({name:'Unresolved query'});h.c.choose(point('Resolved home'));
  assert.equal(JSON.parse(h.data.get(h.key(A))).home.name,'Resolved home');
});

test('Escape cancels a pending address save rather than attaching it to the next selection',()=>{
  const h=harness();h.open();h.click('Search');h.escape();h.c.choose(point('A different destination'));
  assert.equal(h.data.has(h.key(A)),false);assert.equal(h.choices.at(-1).name,'A different destination');
});

test('RIDER-007 a late map address cannot strip freshness from a newer GPS fix at the same coordinates',async()=>{
  const h=harness(),pending=deferred();h.c.reverseAddress=()=>pending.promise;
  h.c.onMishwarMapTap({lat:24.7,lng:46.6});
  const measured={...point('New GPS fix'),source:'gps',accuracy:10,observedAt:Date.now()};h.c.pickupPoint=measured;
  pending.resolve({...point('Late manual address'),lat:0,lng:0});await pending.promise;await Promise.resolve();
  assert.equal(h.c.pickupPoint,measured);assert.equal(h.c.pickupPoint.source,'gps');
});

test('RIDER-007 resolving a current manual map point changes labels without replacing its source or coordinates',async()=>{
  const h=harness(),pending=deferred();h.c.reverseAddress=()=>pending.promise;
  h.c.setPickup=value=>{h.c.pickupPoint={...value,source:'manual'}};
  h.c.onMishwarMapTap({lat:24.7,lng:46.6});
  pending.resolve({...point('Resolved manual address'),lat:0,lng:0,resolved:true});await pending.promise;await Promise.resolve();
  assert.equal(h.c.pickupPoint.source,'manual');assert.equal(h.c.pickupPoint.lat,24.7);assert.equal(h.c.pickupPoint.lng,46.6);assert.equal(h.c.pickupPoint.name,'Resolved manual address');
});

test('RIDER-014 invalid map taps cannot clear the destination, change stages or start reverse geocoding',()=>{
 const h=harness();h.c.state.destination=point('Existing destination');const destination=h.c.state.destination,pickup=h.c.pickupPoint;let reverseCalls=0;
 h.c.reverseAddress=async value=>{reverseCalls++;return value};
 for(const invalid of [{lat:NaN,lng:46.6},{lat:24.7,lng:Infinity},null])h.c.onMishwarMapTap(invalid);
 assert.equal(h.c.state.destination,destination);assert.equal(h.c.pickupPoint,pickup);assert.equal(h.c.state.stage,'home');assert.equal(reverseCalls,0);
});
