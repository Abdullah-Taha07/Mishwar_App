import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/search-ui.js',import.meta.url),'utf8');
function harness(){
 const nodes=new Map(),listeners=new Map(),selected=[],winEvents=new Map();let sandbox;
 class Element{
  constructor(name){this.name=name;this.id=name.startsWith('#')?name.slice(1):'';this.tagName='DIV';this.hidden=false;this.inert=false;this.disabled=false;this.value='';this.dataset={};this.isConnected=true;this.attrs=new Map();this.handlers=new Map();this.clientHeight=220;this.options=[];this.favorites=[];this.classList={add(){},remove(){},toggle(){}};}
  set innerHTML(value){this.html=value;if(this.id==='search-results-list'){
   this.options=[...value.matchAll(/data-search-select="(\d+)"/g)].map(match=>{const node=new Element('option-'+match[1]);node.dataset.searchSelect=match[1];node.tagName='BUTTON';return node});
   this.favorites=[...value.matchAll(/data-search-favorite="(\d+)"/g)].map(match=>{const node=new Element('favorite-'+match[1]);node.dataset.searchFavorite=match[1];node.tagName='BUTTON';return node});
  }}
  get innerHTML(){return this.html||''}
  setAttribute(name,value){this.attrs.set(name,String(value))}
  getAttribute(name){return this.attrs.get(name)??null}
  focus(){sandbox.document.activeElement=this}
  select(){}
  blur(){if(sandbox.document.activeElement===this)sandbox.document.activeElement=null}
  close(){this.open=false}
  scrollIntoView(){this.scrolled=true}
  addEventListener(name,fn){if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(fn)}
  append(node){this.children??=[];this.children.push(node)}
  matches(selector){return selector==='[data-search-address]'?this.dataset.searchAddress!==undefined:selector==='[data-address]'?this.dataset.address!==undefined:false}
  contains(node){return this===sheet&&controls().includes(node)}
  querySelectorAll(selector){
   if(this!==sheet)return [];
   if(selector==='.search-route-row')return rows;
   if(selector==='[data-search-select]')return list.options;
   if(selector.startsWith('button:not'))return controls();
   return [];
  }
  querySelector(selector){return node(selector)}
 }
 function node(name){if(!nodes.has(name))nodes.set(name,new Element(name));return nodes.get(name)}
 const sheet=node('#search-sheet'),list=node('#search-results-list'),pickup=node('#search-pickup'),destination=node('#search-destination'),close=node('#close'),base=node('#app'),alreadyInert=node('#already-inert'),toast=node('#toast'),trigger=node('#trigger');
 pickup.tagName=destination.tagName='INPUT';pickup.dataset.searchAddress='pickup';destination.dataset.searchAddress='destination';alreadyInert.inert=true;
 const controls=()=>[close,pickup,destination,...list.options.flatMap((option,index)=>[option,list.favorites[index]])].filter(Boolean);
 const rows=[{querySelector:()=>pickup,classList:{toggle(){}},contains:value=>value===pickup},{querySelector:()=>destination,classList:{toggle(){}},contains:value=>value===destination}];
 const body=node('#body');body.children=[base,alreadyInert,toast];
 sandbox={console,Map,Set,Promise,AbortController,JSON,Number,String,Event,CustomEvent:class{constructor(type,{detail}={}){this.type=type;this.detail=detail}},
  document:{createElement:()=>sheet,body,activeElement:trigger,querySelectorAll:()=>[]},
  addEventListener(name,fn){if(!winEvents.has(name))winEvents.set(name,[]);winEvents.get(name).push(fn)},
  ResizeObserver:class{observe(){}},
  $:node,esc:String,icon:()=>'',read:(_,fallback)=>fallback,localStorage:{setItem(){}},validPoint:p=>!!p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng),
  editor:{target:null,query:'',results:[],visibleResults:[],sequence:0,loading:false,error:''},suggestionBox:node('#suggestions'),
  stopAddressSearch(){sandbox.editor.sequence++},scheduleAddressSearch(query){sandbox.editor.query=query},runAddressSearch(){sandbox.searches=(sandbox.searches||0)+1},searchFocus:()=>({lat:24.7,lng:46.6}),
  closeAddressEditor(){},startAddressEditor(){},focusAddress(){},showSearch(){},positionSuggestions(){},drawSuggestions(){},openSearchSheet(){},
  state:{stage:'home',destination:null},pickupPoint:null,choose:point=>selected.push(point),setPickup:point=>selected.push(point),fitLocations(){},startMapPick(){},locatePickup(){},modal(){},toast(){},
  requestAnimationFrame:fn=>fn(),clearTimeout(){},
 };
 sandbox.window=sandbox;sandbox.MishwarGeoPolicy={rank:points=>points.map((point,index)=>({...point,distanceKm:index}))};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 return {c:sandbox,node,sheet,list,pickup,destination,close,base,alreadyInert,toast,trigger,selected,
  key(key,target=sandbox.document.activeElement,shiftKey=false){const event={key,target,shiftKey,prevented:false,preventDefault(){this.prevented=true}};for(const fn of sheet.handlers.get('keydown')||[])fn(event);return event},
  clickResult(index){const option=list.options[index],button={dataset:option.dataset,hasAttribute:()=>false};for(const fn of sheet.handlers.get('click')||[])fn({target:{closest:()=>button},preventDefault(){},stopPropagation(){}})},
  clickFavorite(index){const button={dataset:{searchFavorite:String(index)},hasAttribute:()=>false};for(const fn of sheet.handlers.get('click')||[])fn({target:{closest:()=>button},preventDefault(){},stopPropagation(){}})},
 };
}

test('RIDER-012 address dialog isolates the background and restores focus and preexisting inert state',()=>{
 const h=harness();h.c.openSearchSheet('destination');
 assert.equal(h.base.inert,true);assert.equal(h.alreadyInert.inert,true);assert.equal(h.toast.inert,false);
 assert.equal(h.c.document.activeElement,h.destination);
 const event=h.key('Escape');assert.equal(event.prevented,true);assert.equal(h.sheet.hidden,true);
 assert.equal(h.base.inert,false);assert.equal(h.alreadyInert.inert,true);assert.equal(h.c.document.activeElement,h.trigger);
});

test('RIDER-012 keyboard focus wraps in both directions without reaching the background',()=>{
 const h=harness();h.c.openSearchSheet('destination');
 h.close.focus();assert.equal(h.key('Tab',h.close,true).prevented,true);assert.equal(h.c.document.activeElement,h.destination);
 assert.equal(h.key('Tab').prevented,true);assert.equal(h.c.document.activeElement,h.close);
 h.trigger.focus();assert.equal(h.key('Tab').prevented,true);assert.equal(h.c.document.activeElement,h.close);
});

test('RIDER-012 every address result remains reachable and arrow navigation scrolls to it',()=>{
 const h=harness();h.c.openSearchSheet('destination');h.c.editor.query='Address';h.c.editor.results=Array.from({length:30},(_,index)=>({lat:24.7+index/10000,lng:46.6,name:'Address '+index}));h.c.drawSuggestions();
 assert.equal(h.c.editor.visibleResults.length,30);assert.equal(h.list.options.length,30);
 assert.equal(h.key('ArrowDown',h.destination).prevented,true);assert.equal(h.c.document.activeElement,h.list.options[0]);
 h.key('End');assert.equal(h.c.document.activeElement,h.list.options[29]);assert.equal(h.list.options[29].scrolled,true);
 assert.equal(h.list.options[29].getAttribute('aria-selected'),'true');h.clickResult(29);
 assert.equal(h.selected[0].name,'Address 29');assert.equal(h.sheet.hidden,true);
});

test('RIDER-012 Home and End retain text editing in inputs and ordinary closes do not steal focus',()=>{
 const h=harness();h.c.openSearchSheet('destination');
 assert.equal(h.key('Home',h.destination).prevented,false);assert.equal(h.key('End',h.destination).prevented,false);
 h.c.closeAddressEditor();assert.equal(h.base.inert,false);assert.notEqual(h.c.document.activeElement,h.trigger);
});

test('RIDER-012 search loading exposes status and three inert skeleton rows without fake options',()=>{
 const h=harness();h.c.openSearchSheet('destination');h.c.editor.query='Pending';h.c.editor.loading=true;h.c.drawSuggestions();
 assert.equal(h.list.getAttribute('aria-busy'),'true');assert.equal(h.node('#search-result-heading').getAttribute('role'),'status');
 assert.equal((h.list.innerHTML.match(/class="mw-skeleton"/g)||[]).length,3);assert.match(h.list.innerHTML,/aria-hidden="true"/);
 assert.equal(h.list.options.length,0);assert.equal(h.c.editor.visibleResults.length,0);
 h.c.editor.loading=false;h.c.drawSuggestions();assert.equal(h.list.getAttribute('aria-busy'),'false');
});

test('search favorites keep same-name same-latitude places with different longitudes independent',()=>{
 const h=harness(),storage=new Map();
 h.c.MishwarAccountContext={snapshot:()=>({status:'ready',authenticated:true}),storageKey:key=>key+':A',capture:()=>({owner:'A'}),isCurrent:ticket=>ticket?.owner==='A'};
 h.c.read=(key,fallback)=>storage.has(key)?JSON.parse(storage.get(key)):fallback;
 h.c.localStorage.setItem=(key,value)=>storage.set(key,value);
 const a={name:'Same business',lat:24.7,lng:46.6},b={...a,lng:46.7};
 h.c.openSearchSheet('destination');h.c.editor.query='business';h.c.editor.results=[a,b];h.c.drawSuggestions();
 h.clickFavorite(0);h.clickFavorite(1);
 const saved=()=>JSON.parse(storage.get('mishwar-favorites-v3:A'));
 assert.equal(saved().length,2);assert.deepEqual(saved().map(point=>point.lng).sort(),[46.6,46.7]);
 h.clickFavorite(0);assert.equal(saved().length,1);assert.equal(saved()[0].lng,46.7);
});

test('recent places do not evict a same-name branch at a different longitude',()=>{
 const h=harness(),storage=new Map();
 h.c.MishwarAccountContext={snapshot:()=>({status:'ready',authenticated:true}),storageKey:key=>key+':A',capture:()=>({owner:'A'}),isCurrent:ticket=>ticket?.owner==='A'};
 h.c.read=(key,fallback)=>storage.has(key)?JSON.parse(storage.get(key)):fallback;
 h.c.localStorage.setItem=(key,value)=>storage.set(key,value);
 h.c.rememberAddress({name:'Branch',lat:24.7,lng:46.6});h.c.rememberAddress({name:'Branch',lat:24.7,lng:46.7});
 assert.equal(JSON.parse(storage.get('mishwar-recent-addresses-v3:A')).length,2);
});

test('nearby distinct search results are not discarded by decimal coordinate rounding',()=>{
 const h=harness();h.c.openSearchSheet('destination');h.c.editor.query='branch';
 h.c.editor.results=[{name:'Branch',lat:24.7001,lng:46.6001},{name:'Branch',lat:24.7002,lng:46.6002}];h.c.drawSuggestions();
 assert.equal(h.c.editor.visibleResults.length,2);assert.equal(h.list.options.length,2);
});
