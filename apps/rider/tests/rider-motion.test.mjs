import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/rider-motion.js',import.meta.url),'utf8');
function harness({reduced=false,animation=true}={}){
  const events=new Map(),effects=[],nodes=new Map();let owner='owner-A',renders=0,cancelled=0;
  const listen=(prefix,name,fn)=>{const key=prefix+name;if(!events.has(key))events.set(key,[]);events.get(key).push(fn)};
  const element=()=>({isConnected:true,scrollTop:0,disabled:false,closest:()=>null,animate:animation?function(frames,options){let finish;const finished=new Promise(done=>{finish=done});effects.push({frames,options,node:this,finish});return {cancel(){cancelled++},finished}}:undefined});
  const panel=element(),dialog=element(),path=element(),drawer=element();path.getTotalLength=()=>100;
  dialog.addEventListener=(name,fn)=>listen('modal:',name,fn);
  drawer.addEventListener=(name,fn)=>listen('drawer:',name,fn);
  nodes.set('#panel',panel);nodes.set('#modal',dialog);nodes.set('.panel-content',element());nodes.set('#modal .dialog-body',element());nodes.set('#live-map .leaflet-overlay-pane path',path);nodes.set('#drawer',drawer);nodes.set('#drawer-content',element());nodes.set('.ride-category.selected',element());nodes.set('.live-trip h2',element());
  const preference={matches:reduced,addEventListener:(name,fn)=>listen('media:',name,fn)};
  const sandbox={Map,Set,JSON,Number,String,Promise,matchMedia:()=>preference,state:{stage:'home',tier:'economy'},mishwarTripActive:true,
    document:{hidden:false,querySelector:key=>nodes.get(key)||null,addEventListener:(name,fn)=>listen('doc:',name,fn)},
    addEventListener:(name,fn)=>listen('win:',name,fn),MishwarAccountContext:{snapshot:()=>({accountKey:owner})},
    render(){renders++;nodes.set('.panel-content',element());return 'rendered'},modal(){dialog.open=true;nodes.set('#modal .dialog-body',element())},openDrawer(){drawer.open=true;return 'drawer-opened'},drawMishwarRoute(){},
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

test('UX batch2 rapid feedback replaces one effect per element and retains at most12 active effects',()=>{
  const h=harness(),button=h.element(),event={button:0,target:{closest:()=>button}};
  for(let i=0;i<25;i++)h.emit('doc:','pointerup',event);
  assert.equal(h.effects.length,25);assert.equal(h.cancelled(),24);
  h.emit('win:','pagehide');assert.equal(h.cancelled(),25);
  const bounded=harness();
  for(let i=0;i<20;i++)bounded.emit('doc:','pointerup',{button:0,target:{closest:()=>bounded.element()}});
  assert.equal(bounded.cancelled(),8);bounded.emit('win:','pagehide');assert.equal(bounded.cancelled(),20);
});

test('UX batch2 a detached button is released and an old completion cannot remove its replacement',async()=>{
  const h=harness(),button=h.element(),event={button:0,target:{closest:()=>button}};
  h.emit('doc:','pointerup',event);h.emit('doc:','pointerup',event);
  h.effects[0].finish();await Promise.resolve();h.emit('win:','pagehide');assert.equal(h.cancelled(),2);
  h.emit('doc:','pointerup',event);button.isConnected=false;
  h.emit('doc:','pointerup',{button:0,target:{closest:()=>h.element()}});assert.equal(h.cancelled(),3);
});

test('UX batch2 selection feedback occurs only for a changed category without submitting or replaying render',()=>{
  const h=harness();h.c.state.stage='select';h.c.render();const effects=h.effects.length;
  h.c.state.tier='comfort';h.c.render();assert.equal(h.effects.length,effects+1);assert.equal(h.effects.at(-1).node,h.nodes.get('.ride-category.selected'));
  h.c.render();h.c.render();assert.equal(h.effects.length,effects+1);assert.equal(h.renders(),4);
});

test('UX batch2 dialog content and drawer enter once without delaying close or changing return values',()=>{
  const h=harness();h.c.modal('Wallet');assert.equal(h.effects.length,1);
  h.c.modal('Wallet');assert.equal(h.effects.length,1);h.c.modal('Settings');assert.equal(h.effects.length,2);
  assert.equal(h.c.openDrawer(),'drawer-opened');assert.equal(h.effects.length,3);h.c.openDrawer();assert.equal(h.effects.length,3);
  h.emit('drawer:','close');assert.equal(h.cancelled(),1);h.nodes.get('#drawer').open=false;
  h.c.openDrawer();assert.equal(h.effects.length,4);
});

test('UX batch2 actual route geometry fades once despite newer timestamps and detects changed internal geometry',()=>{
  const h=harness(),route={geometry:{coordinates:[[46.6,24.7],[46.65,24.75],[46.7,24.8]]},calculatedAt:'first'};
  h.c.drawMishwarRoute(route);h.c.drawMishwarRoute({...route,calculatedAt:'newer'});assert.equal(h.effects.length,1);
  assert.deepEqual(Object.keys(h.effects[0].frames[0]),['opacity']);
  h.c.drawMishwarRoute({...route,geometry:{coordinates:[[46.6,24.7],[46.66,24.76],[46.7,24.8]]}});assert.equal(h.effects.length,2);
});

test('UX batch2 trip status feedback ignores polling and cancels queued work on account reset',async()=>{
  const h=harness();h.c.state.stage='arriving';h.c.render();const count=h.effects.length;
  const emit=detail=>h.emit('win:','mishwar-trip-updated',{detail});
  emit({id:'trip-A',status:'arriving'});emit({id:'trip-A',status:'arriving',driverLocation:{at:'newer'}});await Promise.resolve();assert.equal(h.effects.length,count);
  emit({id:'trip-A',status:'arrived'});await Promise.resolve();assert.equal(h.effects.length,count+1);assert.equal(h.effects.at(-1).node,h.nodes.get('.live-trip h2'));
  emit({id:'trip-A',status:'arrived',eta:{minutes:4}});await Promise.resolve();assert.equal(h.effects.length,count+1);
  emit({id:'trip-A',status:'riding'});h.emit('win:','mishwar-account-reset');await Promise.resolve();assert.equal(h.effects.length,count+1);
});

test('UX batch2 reduced-motion disables drawer, selection and queued trip feedback',async()=>{
  const h=harness({reduced:true});h.c.openDrawer();h.c.modal('Wallet');h.c.state.stage='select';h.c.render();h.c.state.tier='comfort';h.c.render();
  h.emit('win:','mishwar-trip-updated',{detail:{id:'trip-A',status:'arriving'}});h.emit('win:','mishwar-trip-updated',{detail:{id:'trip-A',status:'arrived'}});await Promise.resolve();assert.equal(h.effects.length,0);
});

test('UX batch2 a newer trip stage invalidates a queued same-stage status effect',async()=>{
  const h=harness();h.c.state.stage='arriving';h.c.render();const count=h.effects.length;
  h.emit('win:','mishwar-trip-updated',{detail:{id:'trip-A',status:'arriving'}});
  h.emit('win:','mishwar-trip-updated',{detail:{id:'trip-A',status:'arrived'}});
  h.c.state.stage='riding';h.emit('win:','mishwar-trip-updated',{detail:{id:'trip-A',status:'riding'}});h.c.render();
  await Promise.resolve();assert.equal(h.effects.length,count+1);assert.equal(h.effects.at(-1).node,h.nodes.get('#panel'));
});

test('UX batch2 missing optional animation support does not block navigation or route rendering',()=>{
  const h=harness({animation:false});
  assert.equal(h.c.openDrawer(),'drawer-opened');assert.doesNotThrow(()=>h.c.modal('Wallet'));
  h.c.state.stage='select';assert.equal(h.c.render(),'rendered');
  assert.doesNotThrow(()=>h.c.drawMishwarRoute({geometry:{coordinates:[[46.6,24.7],[46.7,24.8]]}}));assert.equal(h.effects.length,0);
});

test('UX batch2 first matching confirmation animates once when booking keeps the selection stage',async()=>{
  const h=harness();h.c.state.stage='select';h.c.render();const count=h.effects.length;
  h.emit('win:','mishwar-trip-updated',{detail:{id:'trip-A',status:'matching'}});await Promise.resolve();
  assert.equal(h.effects.length,count+1);assert.equal(h.effects.at(-1).node,h.nodes.get('.live-trip h2'));
  h.emit('win:','mishwar-trip-updated',{detail:{id:'trip-A',status:'matching',driverLocation:null}});await Promise.resolve();
  assert.equal(h.effects.length,count+1);assert.equal(h.renders(),1);
});
