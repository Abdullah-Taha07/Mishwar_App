import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const A='a'.repeat(64),B='b'.repeat(64);
const source=readFileSync(new URL('../public/search-ui.js',import.meta.url),'utf8');
const contextSource=readFileSync(new URL('../public/account-context.js',import.meta.url),'utf8');
function harness(){
  const storage=new Map(),listeners=new Map(),nodes=new Map(),notices=[];
  const node=selector=>{if(nodes.has(selector))return nodes.get(selector);const handlers=new Map(),value={hidden:false,innerHTML:'',value:'',dataset:{},isConnected:true,clientHeight:220,classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(name,fn){handlers.set(name,fn)},append(){},querySelectorAll:()=>[],querySelector:()=>null,focus(){},select(){},close(){this.open=false},matches:()=>false,handlers};nodes.set(selector,value);return value};
  const context={console,Map,Set,Promise,AbortController,JSON,Number,String,
    Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
    addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)},
    document:{createElement:()=>node('search-sheet'),body:node('body'),activeElement:null,querySelectorAll:()=>[]},ResizeObserver:class{observe(){}},
    localStorage:{setItem(key,value){storage.set(key,value)}},read(key,fallback){return storage.has(key)?JSON.parse(storage.get(key)):fallback},save(){throw Error('Legacy unscoped save must not be used')},
    validPoint:point=>!!point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng),$:node,icon:()=>'',esc:String,toast:message=>notices.push(message),
    choose(){},openSearchSheet(){},startAddressEditor(){},focusAddress(){},showSearch(){},closeAddressEditor(){},positionSuggestions(){},drawSuggestions(){},
    editor:{target:null,query:'',results:[],visibleResults:[],sequence:0,loading:false,error:''},suggestionBox:node('suggestions'),stopAddressSearch(){context.editor.sequence++},scheduleAddressSearch(){},runAddressSearch(){},searchFocus:()=>({lat:24.7,lng:46.6}),
    state:{stage:'home',destination:null},pickupPoint:null,startMapPick(){},locatePickup(){},modal(){},setPickup(){},fitLocations(){},requestAnimationFrame:()=>1,clearTimeout(){},
  };context.window=context;context.MishwarGeoPolicy={rank:value=>value};vm.createContext(context);vm.runInContext(contextSource,context);vm.runInContext(source,context);
  const auth=next=>{const account=context.MishwarAccountContext;account.applyAuth(next?{authenticated:true,phoneVerified:true,accountKey:next}:{authenticated:false,accountKey:null},account.beginAuthRead());account.notifyAuth()};
  return{c:context,storage,notices,node,auth,clickFavorite(){node('search-sheet').handlers.get('click')({target:{closest:()=>({dataset:{searchFavorite:'0'},hasAttribute:()=>false})},preventDefault(){},stopPropagation(){}})},ticket:()=>context.MishwarAccountContext.capture()};
}
const point={name:'Private location',lat:24.7,lng:46.6};

test('search favorites and recents ignore legacy guest data and separate immutable owners',()=>{
  const h=harness();h.storage.set('mishwar-favorites',JSON.stringify([point]));h.storage.set('mishwar-recent-addresses',JSON.stringify([point]));h.auth(A);
  assert.equal(h.c.savedAddresses().length,0);assert.equal(h.c.recentAddresses().length,0);
  assert.equal(h.c.saveAddressList('mishwar-favorites',[point],h.ticket()),true);h.c.rememberAddress(point);assert.equal(h.c.savedAddresses()[0].name,point.name);
  h.auth(B);assert.equal(h.c.savedAddresses().length,0);assert.equal(h.c.recentAddresses().length,0);h.c.rememberAddress({...point,name:'B location'});
  h.auth(A);assert.equal(h.c.savedAddresses()[0].name,'Private location');assert.equal(h.c.recentAddresses()[0].name,'Private location');
});

test('guest searches do not persist favorites or recent locations',()=>{
  const h=harness();h.auth(null);h.c.rememberAddress(point);assert.equal(h.storage.size,0);h.c.editor.visibleResults=[point];h.clickFavorite();assert.equal(h.storage.size,0);assert.match(h.notices.at(-1),/سجّل الدخول/);
});

test('old owner tickets cannot save and an account reset clears pending search results',()=>{
  const h=harness();h.auth(A);const old=h.ticket();h.c.editor.results=[point];h.c.editor.visibleResults=[point];h.c.editor.query='Private query';h.c.editor.target='destination';const sequence=h.c.editor.sequence;
  h.auth(B);assert.equal(h.c.editor.sequence>sequence,true);assert.equal(h.c.editor.results.length,0);assert.equal(h.c.editor.visibleResults.length,0);assert.equal(h.c.editor.query,'');assert.equal(h.node('search-sheet').hidden,true);
  assert.equal(h.c.saveAddressList('mishwar-favorites',[point],old),false);assert.equal(h.storage.size,0);
});
