import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/tracking-eta.js',import.meta.url),'utf8');
const start=Date.parse('2026-11-21T12:00:00.000Z');
const instant=offset=>new Date(start+offset).toISOString();
function trip(patch={}){return {id:'trip-local',driver_id:'captain-local',status:'arriving',driverLocation:{lat:24.7,lng:46.6,accuracy:5,at:instant(0),fresh:true,tripId:'trip-local'},eta:{status:'available',tripId:'trip-local',target:'pickup',durationSeconds:240,minutes:4,distanceMeters:1800,trafficAware:true,trafficDelaySeconds:20,provider:'TomTom',calculatedAt:instant(0),expiresAt:instant(30000),locationAt:instant(0)},...patch}}
function harness(){
 let now=start,owner='A',generation=1,lang='ar';const events=new Map(),timers=new Map(),fields=new Map(),attrs=new Map();let sequence=0;
 const root={hidden:false,textContent:'',setAttribute:(key,value)=>attrs.set(key,value),querySelector(selector){if(!fields.has(selector))fields.set(selector,{textContent:'',setAttribute:(key,value)=>attrs.set(key,value)});return fields.get(selector)}};
 class Clock extends Date{static now(){return now}}
 const c={Date:Clock,Math,Number,Object,String,Set,Map,navigator:{onLine:true},
   document:{hidden:false,querySelector:()=>root,addEventListener(name,fn){events.set('document:'+name,fn)}},
   addEventListener:(name,fn)=>events.set(name,fn),setInterval(fn){timers.set(++sequence,fn);return sequence},clearInterval:id=>timers.delete(id),
   MishwarAccountContext:{snapshot:()=>({status:'ready',verified:!!owner,authenticated:!!owner}),capture:()=>({accountKey:owner,generation}),isCurrent:t=>t.accountKey===owner&&t.generation===generation},MishwarLang:{get:()=>lang}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);
 return {c,api:c.MishwarEta,root,fields,attrs,timers,advance(ms){now+=ms;for(const fn of timers.values())fn()},emit:name=>events.get(name)?.(),owner(value){owner=value;generation++},language:value=>{lang=value},value:name=>fields.get('[data-eta-'+name+']')?.textContent};
}

test('RDEV-003 ETA shows provider minutes for the authenticated active trip without adding traffic delay',()=>{
 const h=harness(),t=trip();h.api.update(t);assert.equal(h.value('minutes'),'4');assert.equal(h.attrs.get('data-state'),'available');assert.match(h.value('target'),/الكابتن/);assert.match(h.value('note'),/المرور/);
 assert.match(h.api.html(t),/data-eta-minutes/);assert.equal(h.timers.size,1);
});
test('RDEV-003 riding uses destination ETA, while arrived never invents zero minutes',()=>{
 const h=harness();h.api.update(trip({status:'riding',eta:{...trip().eta,target:'destination'}}));assert.match(h.value('target'),/الوجهة/);
 const a=harness();a.api.update(trip({status:'arrived',eta:{status:'arrived',tripId:'trip-local',target:'pickup'}}));assert.equal(a.value('minutes'),'وصل الكابتن');assert.equal(a.value('unit'),'');
});
test('RDEV-003 malformed, mismatched, unknown-provider and expired ETA facts are not displayed as minutes',()=>{
 for(const patch of [{tripId:'another-trip'},{target:'destination'},{durationSeconds:-1},{durationSeconds:NaN},{distanceMeters:0},{minutes:5},{provider:'straight-line'},{expiresAt:instant(0)},{expiresAt:instant(60000)},{calculatedAt:instant(10000)},{trafficDelaySeconds:241},{locationAt:instant(1000)}]){
  const h=harness();h.api.update(trip({eta:{...trip().eta,...patch}}));assert.equal(h.value('minutes'),'—',JSON.stringify(patch));
 }
});
test('RDEV-003 invalid, inaccurate, stale or future GPS cannot support live ETA',()=>{
 for(const patch of [{lat:91},{lng:181},{accuracy:NaN},{accuracy:151},{fresh:false},{at:instant(-30001)},{at:instant(6000)},{tripId:'other-trip'}]){
  const h=harness();h.api.update(trip({driverLocation:{...trip().driverLocation,...patch}}));assert.equal(h.value('minutes'),'—');assert.equal(h.attrs.get('data-state'),'stale');
 }
});
test('RDEV-003 repeated polls do not extend fixed ETA expiry or relabel old coordinates as fresh',()=>{
 const h=harness(),t=trip();h.api.update(t);h.advance(29000);h.api.update(t);assert.equal(h.value('minutes'),'4');h.advance(1001);assert.equal(h.value('minutes'),'—');assert.equal(h.attrs.get('data-state'),'stale');
});
test('RDEV-003 ETA expiry is evaluated independently of a newer GPS observation',()=>{
 const h=harness(),t=trip();h.advance(15000);t.driverLocation.at=instant(15000);h.api.update(t);assert.equal(h.value('minutes'),'4');h.advance(15001);assert.equal(h.value('minutes'),'—');
});
test('RDEV-003 reconnect and repeated same GPS remain stale until a newer measurement and valid estimate',()=>{
 const h=harness(),t=trip();h.api.update(t);h.c.navigator.onLine=false;h.emit('offline');assert.equal(h.value('minutes'),'—');assert.match(h.value('connection'),/منقطع/);
 h.c.navigator.onLine=true;h.emit('online');h.api.update(t);assert.equal(h.value('minutes'),'—');h.advance(1000);
 const newer=trip({driverLocation:{...t.driverLocation,at:instant(1000)},eta:{...t.eta,locationAt:instant(1000),calculatedAt:instant(1000),expiresAt:instant(31000)}});h.api.update(newer);assert.equal(h.value('minutes'),'4');
});
test('RDEV-003 a failed tracking read hides ETA and does not regain live state from its old cached measurement',()=>{
 const h=harness(),t=trip();h.api.update(t);h.api.markStale();h.api.update(t);assert.equal(h.value('minutes'),'—');
});
test('RDEV-003 an older/conflicting sample or backwards phase cannot replace the latest ETA',()=>{
 const h=harness();h.advance(1000);const t=trip({status:'riding',driverLocation:{...trip().driverLocation,at:instant(1000)},eta:{...trip().eta,target:'destination',locationAt:instant(1000),calculatedAt:instant(1000),expiresAt:instant(31000)}});h.api.update(t);
 h.api.update(trip());assert.match(h.value('target'),/الوجهة/);h.api.update({...t,driverLocation:{...t.driverLocation,lat:24.9},eta:{...t.eta,minutes:8,durationSeconds:480}});assert.equal(h.value('minutes'),'4');
});
test('RDEV-003 end/cancel stops the timer, clears private ETA and ignores a late reply for that trip',()=>{
 for(const status of ['completed','cancelled']){const h=harness(),t=trip();h.api.update(t);h.api.update({...t,status});assert.equal(h.root.hidden,true);assert.equal(h.root.textContent,'');assert.equal(h.timers.size,0);h.api.update(t);assert.equal(h.root.hidden,true)}
});
test('RDEV-003 account reset clears ETA immediately and changes cannot repaint another account',()=>{
 const h=harness();h.api.update(trip());h.owner('B');h.advance(1000);assert.equal(h.root.hidden,true);h.emit('mishwar-account-reset');assert.equal(h.timers.size,0);assert.equal(h.root.textContent,'');
});
test('RDEV-003 hidden/pagehide views pause resources and need fresh data after returning',()=>{
 const h=harness(),t=trip();h.api.update(t);h.emit('pagehide');assert.equal(h.timers.size,0);h.emit('pageshow');assert.equal(h.timers.size,1);assert.equal(h.value('minutes'),'—');h.api.clear();assert.equal(h.timers.size,0);
});
test('RDEV-003 unavailable/stop-progress and nontraffic route labels are honest in both languages',()=>{
 const h=harness();h.api.update(trip({eta:{status:'unavailable',reason:'stops_progress_unavailable'}}));assert.match(h.value('note'),/المحطات/);assert.equal(h.value('minutes'),'—');
 h.language('en');h.api.update(trip({eta:{...trip().eta,provider:'OSRM',trafficAware:false,trafficDelaySeconds:0}}));assert.match(h.value('note'),/without live traffic/);assert.equal(h.value('minutes'),'4');
});
test('RDEV-003 polling metadata bypasses full rider panel rendering and read failures mark ETA stale',()=>{
 const live=readFileSync(new URL('../public/live-booking.js',import.meta.url),'utf8'),html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(live,/\['driverLocation','driver_lat','driver_lng','driver_accuracy','driver_location_at','eta'\]/);assert.match(live,/MishwarEta\?\.markStale/);assert.match(live,/MishwarEta\?\.html\(t\)/);
 assert.ok(html.indexOf('src="/tracking-eta.js"')<html.indexOf('src="/live-booking.js'));
});
