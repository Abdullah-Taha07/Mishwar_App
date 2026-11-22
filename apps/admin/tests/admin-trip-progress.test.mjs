import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/portal.js',import.meta.url),'utf8');
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve()};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function trip(id='trip-A'){
 const at=new Date().toISOString();
 return {id,status:'riding',pickup:{name:'Pickup'},destination:{name:'Destination'},rider_name:'Private rider '+id,driver_name:'Test captain',fare_halalas:2400,commission_bps:1000,payment_status:'cash_due',created_at:at,updated_at:at,events:[{action:'trip_stop_arrived',created_at:at,source:'captain'}],stopProgress:{stops:[{index:0,point:{name:'First <img onerror=attack()>'},status:'departed',arrivedAt:at,departedAt:at,waitSeconds:45},{index:1,point:{name:'Second stop'},status:'departed',waitSeconds:0}]},driverLocation:{lat:24.7,lng:46.6,at,accuracy:5,fresh:true},eta:{status:'available',tripId:id,target:'destination',provider:'TomTom',durationSeconds:182,distanceMeters:1400,locationAt:at,calculatedAt:at,expiresAt:new Date(Date.parse(at)+30000).toISOString(),trafficAware:true}};
}
function harness(){
 const listeners=new Map(),timers=new Map(),intervals=new Map(),calls=[],state={current:trip(),handler:null};let seq=0,root=null,html='';
 const error={textContent:''},refresh={onclick:null},tracking={innerHTML:''};
 function node(){
  let value='',text='';
  return {isConnected:true,querySelector:selector=>selector==='[data-admin-trip-tracking]'?tracking:null,get innerHTML(){return value},set innerHTML(next){value=next;text='';const match=value.match(/<div data-admin-trip-tracking>([\s\S]*?)<\/div>/);tracking.innerHTML=match?.[1]||''},get textContent(){return text},set textContent(next){text=next;value='';tracking.innerHTML=''}};
 }
 const dialog={open:false,addEventListener(name,fn){listeners.set('dialog:'+name,fn)},showModal(){this.open=true},close(){this.open=false;listeners.get('dialog:close')?.()}};
 const content={querySelector:selector=>selector==='[data-admin-trip-view]'?root:selector==='[data-admin-trip-error]'?error:selector==='[data-admin-trip-refresh]'?refresh:null,get innerHTML(){return html},set innerHTML(next){if(root)root.isConnected=false;html=next;root=next.includes('data-admin-trip-view')?node():null}};
 const c={Date,JSON,Promise,AbortController,encodeURIComponent,console,page:'trips',navigator:{onLine:true},document:{hidden:false,addEventListener(name,fn){listeners.set('document:'+name,fn)}},mishwarStaffSession:null,
  addEventListener(name,fn){listeners.set('window:'+name,fn)},setTimeout(fn,ms){const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),setInterval(fn,ms){const id=++seq;intervals.set(id,{fn,ms});return id},clearInterval:id=>intervals.delete(id),
  $:selector=>selector==='#info-dialog'?dialog:selector==='#info-content'?content:null,esc:escape,fmt:String,date:String,money:n=>String(n),states:{riding:'الرحلة جارية',completed:'مكتملة'},destinationChangesHistory:()=>'',events:items=>items.map(e=>'<p>'+escape(c.actions[e.action]||e.action)+'</p>').join(''),
  api:async(path,options={})=>{calls.push({path,options});if(state.handler){const reply=state.handler(path,options);if(reply!==undefined)return reply}return path.startsWith('operations/')?structuredClone(state.current):{ratings:[],context:null}},
 };
 c.window=c;vm.createContext(c);
 vm.runInContext(source.match(/^const actions=.*$/m)[0].replace('const actions=','globalThis.actions='),c);
 const infoStart=source.indexOf('function info('),infoEnd=source.indexOf('\n// Preserve',infoStart);vm.runInContext(source.slice(infoStart,infoEnd),c);
 const start=source.indexOf('// Read-only trip detail owns'),end=source.indexOf('\nfunction exportCsv(',start);vm.runInContext(source.slice(start,end),c);
 return {c,state,calls,timers,intervals,dialog,content,error,tracking,get root(){return root},open:id=>c.showTrip(id||state.current.id),async poll(){const timer=[...timers.entries()].find(([,v])=>v.ms===8000);assert.ok(timer,'detail owns a scheduled read');timers.delete(timer[0]);await timer[1].fn();await flush()},age(){for(const {fn}of [...intervals.values()])fn()},event(name){listeners.get('window:'+name)?.()},close:()=>dialog.close()};
}

test('admin trip detail renders ordered stop evidence, road ETA and translated events with escaped user values',async()=>{
 const h=harness();await h.open();const html=h.root.innerHTML;
 assert.match(html,/محطات التوقف بالترتيب/);assert.ok(html.indexOf('First')<html.indexOf('Second stop'));
 assert.match(html,/&lt;img onerror=attack\(\)&gt;/);assert.doesNotMatch(html,/<img onerror/);
 assert.match(html,/غادر الكابتن المحطة/);assert.match(html,/45 ثانية/);assert.match(html,/الوصول إلى محطة التوقف/);assert.doesNotMatch(html,/>trip_stop_arrived</);
 assert.match(html,/قياس GPS حديث/);assert.match(html,/4 دقيقة/);assert.match(html,/TomTom/);
 assert.ok(h.calls.every(call=>!call.options.method),'detail issues reads only');
});

test('an open admin trip detail polls the same trip without replacing its dialog or unrelated form',async()=>{
 const h=harness();await h.open();const root=h.root,dialog=h.dialog;
 h.state.current.status='completed';h.state.current.driverLocation={lat:99,lng:99,at:new Date().toISOString(),fresh:true};
 await h.poll();assert.equal(h.root,root);assert.equal(h.dialog,dialog);assert.match(root.innerHTML,/مكتملة/);assert.match(root.innerHTML,/التتبع مغلق/);assert.doesNotMatch(root.innerHTML,/قياس GPS حديث|4 دقيقة/);
 assert.equal(h.calls.filter(row=>row.path==='operations/trips?id=trip-A').length,2);
});

test('admin trip tracking ages locally and provider or network failures never retain live ETA',async()=>{
 const h=harness();await h.open();const t=trip();t.driverLocation.at=new Date(Date.now()-31000).toISOString();
 assert.doesNotMatch(h.c.adminTripTracking(t),/قياس GPS حديث|4 دقيقة/);
 t.driverLocation.at=new Date().toISOString();t.eta={status:'unavailable',reason:'route_unavailable'};
 assert.match(h.c.adminTripTracking(t),/تعذر جلب طريق قيادة موثوق/);
 h.state.handler=()=>Promise.reject(Error('local fixture offline'));
 await h.poll();assert.match(h.error.textContent,/تعذر تحديث/);assert.match(h.tracking.innerHTML,/أوقفنا عرض وقت الوصول/);assert.doesNotMatch(h.tracking.innerHTML,/قياس GPS حديث|4 دقيقة/);
 h.state.handler=null;await h.poll();assert.equal(h.error.textContent,'');assert.match(h.tracking.innerHTML,/قياس GPS حديث/);
});

test('a late detail response cannot repaint another trip, a closed dialog or a different admin page',async()=>{
 for(const transition of ['new-trip','close','page']){
  const h=harness(),pending=deferred();h.state.handler=path=>path==='operations/trips?id=trip-A'?pending.promise:undefined;
  const old=h.open();await flush();const oldRoot=h.root;
  if(transition==='new-trip'){h.state.current=trip('trip-B');await h.open('trip-B')}
  else if(transition==='close')h.close();else{h.c.page='finance';h.content.innerHTML='<p>Different page</p>'}
  pending.resolve(trip('trip-A'));await old;
  if(transition==='new-trip'){assert.match(h.root.innerHTML,/Private rider trip-B/);assert.doesNotMatch(h.root.innerHTML,/Private rider trip-A/)}
  else assert.doesNotMatch(oldRoot.innerHTML,/Private rider trip-A/);
 }
});

test('closing or changing the administrator aborts reads and removes prior private detail',async()=>{
 const h=harness();await h.open();h.c.mishwarStaffSession={staff:{id:'other-staff'}};h.age();
 assert.equal(h.dialog.open,false);assert.match(h.root.textContent,/تغير حساب الإدارة/);assert.equal(h.intervals.size,0);
 const next=harness(),pending=deferred();next.state.handler=path=>path.startsWith('operations/')?pending.promise:undefined;
 const loading=next.open();await flush();const signal=next.calls.find(call=>call.path.startsWith('operations/')).options.signal;
 next.close();assert.equal(signal.aborted,true);assert.equal(next.intervals.size,0);
 pending.resolve(trip());await loading;assert.doesNotMatch(next.root.innerHTML,/Private rider/);
});

test('revoked admin access clears private trip facts and stops further polling',async()=>{
 const h=harness();await h.open();h.state.handler=()=>Promise.reject(Object.assign(Error('Session revoked'),{status:403}));
 await h.poll();assert.match(h.root.textContent,/انتهت صلاحية/);assert.doesNotMatch(h.root.innerHTML,/Private rider|GPS/);assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);
});

test('admin arrived and unavailable tracking states use facts rather than a made-up zero or current position',()=>{
 const h=harness(),t=trip();t.status='arrived';t.eta={status:'arrived',tripId:t.id,target:'pickup'};
 assert.match(h.c.adminTripTracking(t),/سجل الكابتن الوصول/);assert.doesNotMatch(h.c.adminTripTracking(t),/0 دقيقة/);
 t.driverLocation=null;t.eta={status:'unavailable',reason:'location_unavailable'};
 assert.match(h.c.adminTripTracking(t),/لم يصل قياس موقع/);assert.doesNotMatch(h.c.adminTripTracking(t),/الإحداثيات المسجلة|قياس GPS حديث/);
 t.status='cancelled';assert.match(h.c.adminTripTracking(t),/التتبع مغلق/);
});

test('an ETA for another trip, old sensor sample, wrong phase, unknown provider or expired lease is never shown as minutes',()=>{
 const h=harness();
 for(const mutate of [
  t=>t.eta.tripId='another-trip',
  t=>t.eta.locationAt=new Date(Date.now()-1000).toISOString(),
  t=>t.eta.target='pickup',
  t=>t.eta.provider='Unknown route',
  t=>t.eta.expiresAt=new Date(Date.now()-1).toISOString(),
  t=>t.eta.durationSeconds=0,
  t=>t.driverLocation.accuracy=151,
  t=>t.stopProgress.stops[1].status='pending',
 ]){
  const t=trip();mutate(t);assert.doesNotMatch(h.c.adminTripTracking(t),/4 دقيقة/);assert.match(h.c.adminTripTracking(t),/وقت الوصول غير متاح/);
 }
});
