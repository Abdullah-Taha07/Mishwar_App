import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the actual map/search browser code with deferred local fetches and a
// small Leaflet/DOM fixture. No provider, API key or production request is used.
const mapsSource=readFileSync(new URL('../public/maps.js',import.meta.url),'utf8');
const searchSource=readFileSync(new URL('../public/search-ui.js',import.meta.url),'utf8');
const policySource=readFileSync(new URL('../public/geo-policy.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve}};
const json=value=>({ok:true,json:async()=>value});
const places=name=>({features:[{geometry:{type:'Point',coordinates:[46.675,24.713]},properties:{name,city:'Riyadh',country:'Saudi Arabia'}}]});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};

function harness({searchUI=true}={}){
 const nodes=new Map(),events=new Map(),timers=new Map(),calls=[],tiles=[],config=deferred();let timerId=0,route=url=>json(places(url.hostname==='photon.komoot.io'?'Photon place':'TomTom place'));
 let sandbox;
 const node=selector=>{if(nodes.has(selector))return nodes.get(selector);const created=createNode();nodes.set(selector,created);return created};
 function createNode(){const handlers=new Map(),children=[];let id='',html='';
  return {hidden:false,open:false,textContent:'',value:'',dataset:{},clientHeight:240,children,handlers,footer:null,
   classList:{add(){},remove(){},toggle(){}},style:{setProperty(){}},
   set id(value){id=value;nodes.set('#'+value,this)},get id(){return id},
   set innerHTML(value){html=value;const text=value.match(/<footer class="search-source">([^<]*)<\/footer>/)?.[1];if(text!==undefined){this.footer=createNode();this.footer.textContent=text}},get innerHTML(){return html},
   setAttribute(){},append(value){children.push(value)},remove(){},addEventListener(type,fn){handlers.set(type,fn)},
   querySelector(selector){return selector==='.search-source'?this.footer:null},querySelectorAll(){return[]},
   closest(){return this},getBoundingClientRect(){return{left:0,right:400,bottom:200,width:400,height:70}},
   focus(){sandbox.document.activeElement=this},select(){},blur(){sandbox.document.activeElement=null},matches(){return false},close(){this.open=false},
  };
 }
 const map={layers:new Set(),handlers:new Map(),setView(){return this},getCenter(){return{lat:24.7136,lng:46.6753}},
  addLayer(layer){this.layers.add(layer);return this},hasLayer(layer){return this.layers.has(layer)},removeLayer(layer){this.layers.delete(layer);return this},
  eachLayer(fn){for(const layer of [...this.layers])fn(layer)},on(type,fn){this.handlers.set(type,fn);return this},fitBounds(){return this},invalidateSize(){},zoomIn(){},zoomOut(){},
 };
 class TileLayer{
  constructor(url,options){this.url=url;this.options=options;this.handlers=new Map();tiles.push(this)}
  on(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn);return this}
  addTo(target){target.addLayer(this);return this}
  fire(type){for(const fn of this.handlers.get(type)||[])fn({type,target:this});return this}
 }
 sandbox={console,Map,Set,Promise,URL,URLSearchParams,AbortController,AbortSignal,JSON,Number,String,Math,
  Event:class{constructor(type){this.type=type}},location:{origin:'https://rider.offline.test'},navigator:{},
  setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout(id){timers.delete(id)},
  fetch:async(input,options={})=>{const url=new URL(String(input),'https://rider.offline.test');calls.push({url,signal:options.signal});if(url.pathname==='/api/map-config')return config.promise;return route(url,options)},
  document:{createElement:createNode,body:node('body'),activeElement:null,querySelector:node,querySelectorAll(){return[]},addEventListener(){}},
  addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn)},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event)},
  $:node,ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>fn(),innerHeight:900,innerWidth:1440,
  L:{map:()=>map,TileLayer,tileLayer:(url,options)=>new TileLayer(url,options),divIcon:options=>options,
   marker:()=>({addTo(){return this},bindTooltip(){return this},remove(){},setLatLng(){return this}})},
  state:{stage:'home',destination:null},render(){},getDemoFare:()=>({}),choose(){},locations(){},icon:()=>'',esc:value=>String(value??''),toast(){},
  read:(key,fallback)=>fallback,localStorage:{setItem(){}},save(){},showSearch(){},
 };
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(policySource,sandbox);vm.runInContext(mapsSource,sandbox);
 if(searchUI)vm.runInContext(searchSource,sandbox);
 const evaluate=expression=>vm.runInContext(expression,sandbox);
 return {c:sandbox,map,tiles,node,calls,timers,evaluate,editor:evaluate('editor'),
  route(fn){route=fn},async configure(value){config.resolve(json(value));await flush()},
  async search(query='coffee'){const editor=evaluate('editor');editor.target='destination';editor.query=query;await sandbox.runAddressSearch(query,editor.sequence)},
 };
}

test('RIDER-008 configured search does not reuse cached Photon results for the same query',async()=>{
 const h=harness();await h.search();assert.equal(h.editor.results[0].name,'Photon place');
 assert.equal(h.evaluate('geoCache.size'),1);
 await h.configure({searchConfigured:true,searchProvider:'TomTom'});assert.equal(h.evaluate('geoCache.size'),0);
 await h.search();assert.equal(h.editor.results[0].name,'TomTom place');
 const calls=h.calls.filter(c=>c.url.pathname!=='/api/map-config');assert.equal(calls.length,2);
 assert.equal(calls[0].url.hostname,'photon.komoot.io');assert.equal(calls[1].url.pathname,'/api/places');
 assert.ok(h.evaluate("[...geoCache.keys()].every(key=>key.startsWith(location.origin+'/api/places|'))"));
});

test('RIDER-008 reverse labels are cached by provider and preserve the GPS measurement',async()=>{
 const h=harness(),point={lat:24.713,lng:46.675,source:'gps',accuracy:12,observedAt:1234567890};
 assert.equal((await h.c.reverseAddress(point)).name,'Photon place');assert.equal(h.evaluate('reverseCache.size'),1);
 await h.configure({searchConfigured:true});const result=await h.c.reverseAddress(point);
 assert.equal(result.name,'TomTom place');for(const key of ['lat','lng','source','accuracy','observedAt'])assert.equal(result[key],point[key]);
 const before=h.calls.length;assert.equal((await h.c.reverseAddress(point)).name,'TomTom place');assert.equal(h.calls.length,before,'Current-provider reverse result should be reused');
 assert.ok(h.evaluate("[...reverseCache.keys()].every(key=>key.startsWith(location.origin+'/api/places/reverse|'))"));
});

test('RIDER-008 a late Photon search cannot fill the new cache or replace configured-provider results',async()=>{
 const h=harness(),old=deferred();h.route(url=>url.hostname==='photon.komoot.io'?old.promise:json(places('TomTom current')));
 const pending=h.search();await flush();const oldRequest=h.calls.find(c=>c.url.hostname==='photon.komoot.io');
 await h.configure({searchConfigured:true});assert.equal(oldRequest.signal.aborted,true);
 old.resolve(json(places('Late Photon private query')));await pending;
 assert.equal(h.evaluate('geoCache.size'),0);assert.equal(h.editor.results.length,0);
 await h.search();assert.equal(h.editor.results[0].name,'TomTom current');
 assert.equal(h.evaluate("[...geoCache.values()].flat().some(p=>p.name.includes('Photon'))"),false);
});

test('RIDER-008 a late reverse request is aborted and resolves only through the current provider',async()=>{
 const h=harness(),old=deferred(),point={lat:24.713,lng:46.675,source:'manual'};
 h.route(url=>url.hostname==='photon.komoot.io'?old.promise:json(places('TomTom current address')));
 const pending=h.c.reverseAddress(point);await flush();const oldRequest=h.calls.find(c=>c.url.hostname==='photon.komoot.io');
 await h.configure({searchConfigured:true});assert.equal(oldRequest.signal.aborted,true);
 // The fake intentionally ignores AbortSignal to exercise the generation guard too.
 old.resolve(json(places('Late Photon address')));const result=await pending;
 assert.equal(result.name,'TomTom current address');assert.equal(result.source,'manual');
 assert.equal(h.evaluate('reverseCache.size'),1);assert.equal(h.evaluate("[...reverseCache.values()].some(p=>p.name.includes('Photon'))"),false);
});

test('RIDER-008 public place searches discard a superseded provider response',async()=>{
 const h=harness(),old=deferred();h.route(url=>url.hostname==='photon.komoot.io'?old.promise:json(places('TomTom helper result')));
 const pending=h.c.searchMishwarPlaces('coffee');await flush();await h.configure({searchConfigured:true});old.resolve(json(places('Photon helper result')));
 const result=await pending;assert.equal(result.length,1);assert.equal(result[0].name,'TomTom helper result');
 assert.equal(h.calls.filter(c=>c.url.pathname==='/api/places').length,1);
});

test('RIDER-008 an open search sheet updates its actual attribution when the search provider changes',async()=>{
 const h=harness();h.c.openSearchSheet('destination');const footer=h.node('#search-sheet').querySelector('.search-source');
 assert.ok(footer);assert.match(footer.textContent,/Photon/);
 await h.configure({searchConfigured:true,searchProvider:'TomTom'});assert.match(footer.textContent,/TomTom/);assert.doesNotMatch(footer.textContent,/Photon|OpenStreetMap/);
 h.c.closeAddressEditor();h.c.openSearchSheet('destination');assert.match(h.node('#search-sheet').querySelector('.search-source').textContent,/TomTom/);
});

test('RIDER-008 commercial tiles do not falsely attribute Photon search to TomTom',async()=>{
 const h=harness();await h.configure({searchConfigured:false,browserKey:'offline-browser-key'});h.c.openSearchSheet('destination');
 assert.match(h.node('#search-sheet').querySelector('.search-source').textContent,/Photon.*OpenStreetMap/);
 assert.equal(h.tiles.at(-1).options.attribution,'© TomTom');
 assert.equal(h.calls.filter(c=>c.url.hostname==='api.tomtom.com').length,0,'Leaflet fixture never contacts TomTom');
});

test('RIDER-008 the original suggestion view also uses the current provider attribution',async()=>{
 const h=harness({searchUI:false});h.editor.target='destination';h.editor.query='';h.c.drawSuggestions();assert.match(h.node('#address-suggestions').innerHTML,/البحث: Photon/);
 await h.configure({searchConfigured:true});assert.match(h.node('#address-suggestions').innerHTML,/البحث: TomTom/);assert.doesNotMatch(h.node('#address-suggestions').innerHTML,/البحث: Photon/);
});

test('RIDER-008 failed TomTom tiles retain the existing map and a visible fallback notice',async()=>{
 const h=harness(),base=h.tiles[0];assert.equal(h.map.hasLayer(base),true);
 await h.configure({searchConfigured:true,browserKey:'offline-browser-key'});const commercial=h.tiles.at(-1);
 assert.notEqual(commercial,base);assert.equal(h.map.hasLayer(base),true,'OSM remains while commercial tiles are still pending');
 commercial.fire('tileerror');assert.equal(h.map.hasLayer(commercial),false);assert.equal(h.map.hasLayer(base),true);
 const notice=h.node('#map-load-error');assert.equal(notice.hidden,false);assert.match(notice.textContent,/TomTom.*OpenStreetMap/);
 base.fire('tileload');commercial.fire('tileload');assert.equal(notice.hidden,false,'Late load events must not erase the fallback warning');assert.equal(h.map.hasLayer(base),true);
});

test('RIDER-008 a later commercial tile failure restores OSM and preserves other map layers',async()=>{
 const h=harness(),base=h.tiles[0],marker={kind:'rider-location-marker'};h.map.addLayer(marker);
 await h.configure({searchConfigured:true,browserKey:'offline-browser-key'});const commercial=h.tiles.at(-1);
 commercial.fire('tileload');assert.equal(h.map.hasLayer(base),false);assert.equal(h.map.hasLayer(commercial),true);assert.equal(h.map.hasLayer(marker),true);
 assert.equal(h.node('#map-load-error').hidden,true);
 commercial.fire('tileerror');assert.equal(h.map.hasLayer(base),true);assert.equal(h.map.hasLayer(marker),true);assert.equal(h.node('#map-load-error').hidden,false);
 base.fire('tileerror');assert.match(h.node('#map-load-error').textContent,/OpenStreetMap/);assert.equal(h.node('#map-load-error').hidden,false);
});
