import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/rider-motion.js',import.meta.url),'utf8');
function harness({reduced=false}={}){
  const events=new Map(),effects=[],nodes=new Map();let owner='owner-A',renders=0,cancelled=0;
  const listen=(prefix,name,fn)=>{const key=prefix+name;if(!events.has(key))events.set(key,[]);events.get(key).push(fn)};
  const element=()=>({isConnected:true,scrollTop:0,disabled:false,closest:()=>null,animate(frames,options){effects.push({frames,options});return {cancel(){cancelled++},finished:new Promise(()=>{})}}});
  const panel=element(),dialog=element(),path=element();path.getTotalLength=()=>100;
  dialog.addEventListener=(name,fn)=>listen('modal:',name,fn);
  nodes.set('#panel',panel);nodes.set('#modal',dialog);nodes.set('.panel-content',element());nodes.set('#modal .dialog-body',element());nodes.set('#live-map .leaflet-overlay-pane path',path);
  const preference={matches:reduced,addEventListener:(name,fn)=>listen('media:',name,fn)};
  const sandbox={Map,Set,JSON,Number,String,Promise,matchMedia:()=>preference,state:{stage:'home'},mishwarTripActive:true,
    document:{hidden:false,querySelector:key=>nodes.get(key)||null,addEventListener:(name,fn)=>listen('doc:',name,fn)},
    addEventListener:(name,fn)=>listen('win:',name,fn),MishwarAccountContext:{snapshot:()=>({accountKey:owner})},
    render(){renders++;nodes.set('.panel-content',element());return 'rendered'},modal(){nodes.set('#modal .dialog-body',element())},drawMishwarRoute(){},
  };sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
  return {c:sandbox,effects,nodes,preference,element,owner:value=>{owner=value},emit:(prefix,name,event={})=>{for(const fn of events.get(prefix+name)||[])fn(event)},renders:()=>renders,cancelled:()=>cancelled};
}
test('RIDER-012 animates stage changes once and keeps live data refreshes still',()=>{
  const h=harness();assert.equal(h.c.render(),'rendered');assert.equal(h.effects.length,0);
  h.c.state.stage='select';h.c.render();assert.equal(h.effects.length,1);
  h.c.render();h.c.render();assert.equal(h.effects.length,1);assert.equal(h.renders(),4);
});
test('RIDER-012 pointer and keyboard feedback never submit, suppress or duplicate an action',()=>{
  const h=harness(),button=h.element(),event={button:0,target:{closest:()=>button}};
  h.emit('doc:','pointerup',event);assert.equal(h.effects.length,1);assert.equal(h.renders(),0);
  button.disabled=true;h.emit('doc:','pointerup',event);assert.equal(h.effects.length,1);
  button.disabled=false;h.emit('doc:','keydown',{key:'Enter',repeat:false,target:event.target});assert.equal(h.effects.length,2);
  h.emit('doc:','keydown',{key:'Enter',repeat:true,target:event.target});assert.equal(h.effects.length,2);
});
test('RIDER-012 reduced motion and hidden pages do not start animations and cancel active feedback',()=>{
  const h=harness({reduced:true});h.c.state.stage='select';h.c.render();assert.equal(h.effects.length,0);
  h.preference.matches=false;h.c.state.stage='home';h.c.render();assert.equal(h.effects.length,1);
  h.preference.matches=true;h.emit('media:','change');assert.equal(h.cancelled(),1);
  h.preference.matches=false;h.c.state.stage='select';h.c.render();h.c.document.hidden=true;h.emit('doc:','visibilitychange');assert.equal(h.cancelled(),2);
  h.c.state.stage='home';h.c.render();assert.equal(h.effects.length,2);
});
test('RIDER-012 stage and modal scroll restore only for the same immutable owner',()=>{
  const h=harness();h.nodes.get('.panel-content').scrollTop=75;h.c.render();assert.equal(h.nodes.get('.panel-content').scrollTop,75);
  h.c.state.stage='select';h.c.render();assert.equal(h.nodes.get('.panel-content').scrollTop,0);
  h.c.state.stage='home';h.c.render();assert.equal(h.nodes.get('.panel-content').scrollTop,75);
  h.owner('owner-B');h.c.render();assert.equal(h.nodes.get('.panel-content').scrollTop,0);
  h.c.modal('Wallet');h.nodes.get('#modal .dialog-body').scrollTop=42;h.c.modal('Settings');h.c.modal('Wallet');assert.equal(h.nodes.get('#modal .dialog-body').scrollTop,42);
  h.emit('win:','mishwar-account-reset');h.c.modal('Settings');h.c.modal('Wallet');assert.equal(h.nodes.get('#modal .dialog-body').scrollTop,0);
});
test('RIDER-012 route reveal uses actual geometry only and does not repeat for polling',()=>{
  const h=harness(),route={geometry:{coordinates:[[46.6,24.7],[46.7,24.8]]},calculatedAt:'2026-11-20'};
  h.c.drawMishwarRoute(route);h.c.drawMishwarRoute({...route});assert.equal(h.effects.length,1);
  h.c.drawMishwarRoute(null);assert.equal(h.effects.length,1);h.preference.matches=true;h.c.drawMishwarRoute(route);assert.equal(h.effects.length,1);
});
test('RIDER-012 unavailable optional animation cannot break rendering',()=>{
  const h=harness();h.nodes.get('#panel').animate=()=>{throw Error('animation not supported')};h.c.state.stage='select';assert.equal(h.c.render(),'rendered');
});
test('RIDER-012 the rider motion setting disables and cancels optional feedback too',()=>{
  const h=harness();let disabled=false;h.c.document.body={classList:{contains:()=>disabled}};
  h.c.state.stage='select';h.c.render();assert.equal(h.effects.length,1);
  disabled=true;h.emit('win:','mishwar-motion-changed');assert.equal(h.cancelled(),1);
  h.c.state.stage='home';h.c.render();assert.equal(h.effects.length,1);
});
test('RIDER-012 language direction is resolved before paint with a safe storage fallback',()=>{
  const boot=readFileSync(new URL('../public/language-boot.js',import.meta.url),'utf8');
  for(const [value,language,direction]of [['en','en','ltr'],['ar','ar','rtl'],['tampered','ar','rtl']]){
    const c={localStorage:{getItem:()=>value},document:{documentElement:{}}};vm.runInNewContext(boot,c);assert.equal(c.document.documentElement.lang,language);assert.equal(c.document.documentElement.dir,direction);
  }
  const blocked={localStorage:{getItem(){throw Error('storage denied')}},document:{documentElement:{}}};assert.doesNotThrow(()=>vm.runInNewContext(boot,blocked));assert.equal(blocked.document.documentElement.dir,'rtl');
});
