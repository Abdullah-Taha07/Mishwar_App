import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const point=(name='Pickup')=>({lat:24.7,lng:46.6,name,source:'gps',accuracy:10,observedAt:1000});
function mapHarness(reduced=false){
  const created=[],moves=[],labels=[],removed=[],attributes=[],pans=[],classes=new Set(),preference={matches:reduced};
  const c={pickupPoint:null,state:{destination:null},pickupMarker:null,destinationMarker:null,liveMap:{options:{},fitBounds(points,options){pans.push({kind:'bounds',points,options})},setView(point,zoom,options){pans.push({kind:'view',point,zoom,options})},stop(){pans.push({kind:'stop'})}},
    document:{body:{classList:{contains:name=>classes.has(name)}}},matchMedia:()=>preference,
    validPoint:p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng),
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),mapPin:kind=>kind,
    L:{marker(coords,options){const marker={options,coords,addTo(){created.push(this);return this},bindTooltip(text){this.tooltip=text;return this},setTooltipContent(text){this.tooltip=text;labels.push({marker:this,text});return this},setLatLng(next){this.coords=next;moves.push({marker:this,coords:next});return this},getElement:()=>({setAttribute:(name,value)=>attributes.push({marker,name,value})}),remove(){removed.push(this)}};return marker}},
  };
  const code=source('maps.js'),start=code.indexOf('let mapMotionPreference='),end=code.indexOf('function setPickup(',start);
  assert.ok(start>=0&&end>start,'Execute the actual marker synchronization code');
  vm.createContext(c);vm.runInContext(code.slice(start,end),c);
  return{c,created,moves,labels,removed,attributes,pans,classes,preference,sync:()=>c.syncMapPoints()};
}

test('RIDER-012 renewing GPS metadata does not recreate or move either map marker',()=>{
  const h=mapHarness();h.c.pickupPoint=point();h.c.state.destination={lat:24.71,lng:46.61,name:'Destination'};h.sync();
  const pickup=h.c.pickupMarker,destination=h.c.destinationMarker;
  for(let i=1;i<=20;i++){const latest={...point(),observedAt:1000+i,accuracy:5+i};h.c.pickupPoint=latest;h.sync();assert.equal(h.c.pickupPoint,latest,'GPS sample ownership and freshness remain untouched');}
  assert.equal(h.created.length,2);assert.equal(h.moves.length,0);assert.equal(h.removed.length,0);
  assert.equal(h.c.pickupMarker,pickup);assert.equal(h.c.destinationMarker,destination);
});

test('RIDER-012 coordinate and label updates reuse the current marker and escape tooltip content',()=>{
  const h=mapHarness();h.c.pickupPoint=point();h.c.state.destination={lat:24.71,lng:46.61,name:'Destination'};h.sync();
  const pickup=h.c.pickupMarker,destination=h.c.destinationMarker;
  h.c.pickupPoint={...point(),lat:24.701};h.sync();
  assert.equal(h.created.length,2);assert.equal(h.moves.length,1);assert.equal(h.moves[0].marker,pickup);
  h.c.pickupPoint={...h.c.pickupPoint,name:'<Private & selected>'};h.sync();
  assert.equal(h.moves.length,1);assert.equal(h.labels.length,1);assert.equal(h.labels[0].text,'&lt;Private &amp; selected&gt;');
  assert.equal(pickup.options.title,'<Private & selected>');assert.equal(h.c.destinationMarker,destination);assert.equal(h.removed.length,0);
});

test('RIDER-012 clearing one location removes only its marker and keeps the other location',()=>{
  const h=mapHarness();h.c.pickupPoint=point();h.c.state.destination={lat:24.71,lng:46.61,name:'Destination'};h.sync();
  const pickup=h.c.pickupMarker,destination=h.c.destinationMarker;h.c.pickupPoint=null;h.sync();
  assert.equal(h.removed.length,1);assert.equal(h.removed[0],pickup);assert.equal(h.c.pickupMarker,null);assert.equal(h.c.destinationMarker,destination);
  h.c.pickupPoint=point('Replacement');h.sync();assert.equal(h.created.length,3);assert.equal(h.c.destinationMarker,destination);
});

function trackingHarness(reduced=false){
  let now=Date.parse('2026-11-20T09:00:00Z'),sequence=0;const frames=new Map(),cancelled=[],markers=[],controls=[],pans=[],events=new Map(),nodes=new Map();
  const preference={matches:reduced,addEventListener(type,fn){events.set('media:'+type,fn)}};
  const node=key=>{if(nodes.has(key))return nodes.get(key);const classes=new Set();const value={textContent:'',style:{},classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name)},contains:name=>classes.has(name)},setAttribute(){},querySelector:()=>null};nodes.set(key,value);return value};
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const map={on(){},getSize:()=>({y:600}),invalidateSize(){},fitBounds(bounds,options){pans.push({kind:'fit',bounds,options})},panInside(coords,options){pans.push({kind:'follow',coords,options})},panTo(coords,options){pans.push({kind:'manual',coords,options})},stop(){pans.push({kind:'stop'})}};
  const c={Date:ClockDate,performance:{now:()=>now},Math,Map,Set,navigator:{onLine:true},document:{body:node('body'),querySelector:node,addEventListener(){}},liveMap:map,
    validPoint:p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng),matchMedia:()=>preference,
    requestAnimationFrame(fn){const id=++sequence;frames.set(id,fn);return id},cancelAnimationFrame(id){cancelled.push(id);frames.delete(id)},setInterval:()=>1,clearInterval(){},
    addEventListener(type,fn){events.set(type,fn)},
    L:{divIcon:options=>options,marker(coords){const element=node('marker-'+markers.length);element.querySelector=()=>node('car-body-'+markers.length);const marker={point:{lat:coords[0],lng:coords[1]},moves:[],removed:false,element,addTo(){markers.push(this);return this},bindTooltip(){return this},getLatLng(){return this.point},setLatLng(next){this.point={lat:next[0],lng:next[1]};this.moves.push(this.point);return this},getElement(){return this.element},setOpacity(value){this.opacity=value},remove(){this.removed=true}};return marker},
      control(){return{onAdd:null,addTo(){this.element=this.onAdd();controls.push(this);return this},remove(){this.removed=true}}},
      DomUtil:{create(){const el=node('control');el.querySelector=()=>node('.captain-follow');return el}},DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}}},
  };c.window=c;vm.runInNewContext(source('captain-tracking.js'),c);
  const trip=(extra={})=>({id:'trip-A',driver_id:'captain-A',status:'riding',pickup:{lat:24.7,lng:46.6},destination:{lat:24.71,lng:46.61},driverLocation:{lat:24.705,lng:46.605,at:new ClockDate().toISOString(),fresh:true},...extra});
  return{c,frames,cancelled,markers,controls,pans,preference,node,trip,advance:ms=>{now+=ms},emit:type=>events.get(type)?.({}),reduce(value){preference.matches=value;events.get('media:change')?.({matches:value})}};
}

test('RIDER-012 reduced-motion tracking places measured GPS immediately without animation frames or animated pans',()=>{
  const h=trackingHarness(true);h.c.MishwarTracking.update(h.trip());assert.equal(h.frames.size,0);
  h.advance(1000);h.c.MishwarTracking.update(h.trip({driverLocation:{lat:24.707,lng:46.607,at:new h.c.Date().toISOString(),fresh:true}}));
  assert.equal(h.frames.size,0);assert.equal(h.markers[0].point.lat,24.707);
  h.node('.captain-follow').onclick();
  assert.ok(h.pans.some(p=>p.kind==='fit'));assert.ok(h.pans.some(p=>p.kind==='follow'));assert.ok(h.pans.some(p=>p.kind==='manual'));
  assert.ok(h.pans.every(p=>p.options?.animate===false));
});

test('RIDER-012 enabling reduced motion cancels interpolation and keeps the last measured point',()=>{
  const h=trackingHarness();h.c.MishwarTracking.update(h.trip());h.advance(1000);
  // Keep the motion fixture plausible under the RDEV-003 GPS jump guard.
  h.c.MishwarTracking.update(h.trip({driverLocation:{lat:24.706,lng:46.606,at:new h.c.Date().toISOString(),fresh:true}}));
  const lateFrames=[...h.frames.values()];assert.ok(h.frames.size>0);h.reduce(true);
  assert.equal(h.markers[0].point.lat,24.706);assert.ok(h.cancelled.length>0);
  for(const frame of lateFrames)frame(100000);
  assert.equal(h.markers[0].point.lat,24.706,'A queued interpolation cannot move the reduced-motion marker');
  assert.ok(h.pans.filter(p=>p.kind==='fit').every(p=>p.options.animate===false));
});

test('RIDER-012 reduced motion preserves stale and offline GPS guards and owner reset cleanup',()=>{
  const h=trackingHarness(true);h.c.MishwarTracking.update(h.trip());h.c.navigator.onLine=false;h.emit('offline');
  const pans=h.pans.length;h.node('.captain-follow').onclick();assert.equal(h.pans.length,pans);
  assert.match(h.node('.captain-location-state').textContent,/آخر موقع/);assert.equal(h.markers[0].opacity,.5);
  h.c.navigator.onLine=true;h.emit('online');h.node('.captain-follow').onclick();assert.equal(h.pans.length,pans,'Connectivity does not revalidate old GPS');
  h.emit('mishwar-account-reset');assert.equal(h.markers[0].removed,true);assert.equal(h.controls[0].removed,true);assert.equal(h.frames.size,0);
});

test('RIDER-012 application motion preference stops captain interpolation without requiring an OS setting',()=>{
  const h=trackingHarness();h.c.MishwarTracking.update(h.trip());h.advance(1000);
  h.c.MishwarTracking.update(h.trip({driverLocation:{lat:24.706,lng:46.606,at:new h.c.Date().toISOString(),fresh:true}}));
  h.c.document.body.classList.toggle('no-animation',true);h.emit('mishwar-motion-changed');
  assert.equal(h.markers[0].point.lat,24.706);assert.equal(h.preference.matches,false);
  h.frames.clear();h.advance(1000);
  h.c.MishwarTracking.update(h.trip({driverLocation:{lat:24.707,lng:46.607,at:new h.c.Date().toISOString(),fresh:true}}));
  assert.equal(h.frames.size,0);assert.equal(h.markers[0].point.lat,24.707);
  h.node('.captain-follow').onclick();assert.equal(h.pans.at(-1).options.animate,false);
});

test('RIDER-012 fitLocations respects OS and application motion preferences and updates Leaflet options',()=>{
  for(const setting of ['os','application']){
    const h=mapHarness(setting==='os');if(setting==='application')h.classes.add('no-animation');
    h.c.pickupPoint=point();h.c.fitLocations();assert.equal(h.pans.at(-1).options.animate,false);
    h.c.state.destination={lat:24.71,lng:46.61,name:'Destination'};h.c.fitLocations();assert.equal(h.pans.at(-1).options.animate,false);
    h.c.applyMapMotionPreference();assert.equal(h.c.liveMap.options.zoomAnimation,false);assert.equal(h.c.liveMap.options.markerZoomAnimation,false);assert.equal(h.c.liveMap.options.inertia,false);
    h.classes.clear();h.preference.matches=false;h.c.applyMapMotionPreference();assert.equal(h.c.liveMap.options.zoomAnimation,true);
  }
});

test('RIDER-012 route fitting uses the same reduced-motion camera policy',()=>{
  const h=mapHarness();h.classes.add('no-animation');let boundsCalls=0;
  h.c.roadLayer=null;h.c.L.geoJSON=()=>({addTo(){return this},bringToBack(){},getBounds(){boundsCalls++;return[]},remove(){}});
  h.c.window=h.c;const line=source('rider-experience.js').split(/\r?\n/).find(value=>value.startsWith("let lastRouteShape='';"));assert.ok(line);
  vm.runInContext(line,h.c);h.c.drawMishwarRoute({geometry:{type:'LineString',coordinates:[[46.6,24.7],[46.61,24.71]]}});
  assert.equal(boundsCalls,1);assert.equal(h.pans.at(-1).options.animate,false);
});

test('RIDER-012 applyPrefs publishes the updated motion setting after applying its body class',()=>{
  const classes=new Set(),states=[];const c={riderPrefs:{theme:'light',motion:true},Event:class{constructor(type){this.type=type}},document:{documentElement:{dataset:{}},body:{classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)}}}},dispatchEvent(event){states.push({type:event.type,reduced:classes.has('no-animation')})}};c.window=c;
  const script=source('features.js'),start=script.indexOf('function applyPrefs()'),end=script.indexOf('function showSettings()',start);assert.ok(start>=0&&end>start);vm.runInNewContext(script.slice(start,end),c);
  c.applyPrefs();c.riderPrefs.motion=false;c.applyPrefs();
  assert.deepEqual(states,[{type:'mishwar-motion-changed',reduced:true},{type:'mishwar-motion-changed',reduced:false}]);
});
