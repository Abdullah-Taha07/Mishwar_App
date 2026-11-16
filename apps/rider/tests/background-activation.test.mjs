import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const file=role=>readFileSync(new URL(role==='rider'?'../public/app-background.js':'../../hub/public/app-background.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve()};
const response=(value,status=200)=>({ok:status>=200&&status<300,status,json:async()=>value});
function harness(role,{permission='default',supported=true}={}){
  const nodes=[],listeners=new Map(),timers=new Map(),calls=[],dialogs=[];
  let sequence=0,now=0;
  const on=(key,fn)=>{if(!listeners.has(key))listeners.set(key,[]);listeners.get(key).push(fn)};
  function node(tag){
    const attributes=new Map(),children=[];
    const item={tag,children,disabled:false,hidden:false,isConnected:true,textContent:'',style:{},attributes,
      setAttribute:(key,value)=>attributes.set(key,String(value)),removeAttribute:key=>attributes.delete(key),
      append(...items){children.push(...items)},insertBefore(item,before){const index=children.indexOf(before);if(index<0)children.push(item);else children.splice(index,0,item)},
      querySelector:selector=>selector==='#notifications-button'?bell:null,
      addEventListener:(key,fn)=>on('node:'+nodes.indexOf(item)+':'+key,fn),
      remove(){this.isConnected=false},close(){for(const fn of listeners.get('node:'+nodes.indexOf(item)+':close')||[])fn()},
      showModal(){dialogs.push(item)},click(){return this.onclick?.()},
    };nodes.push(item);return item;
  }
  const bell=node('bell'),header=node('header'),body=node('body');header.children.push(bell);
  const subscription={toJSON:()=>({endpoint:'https://fcm.googleapis.com/local-fixture'})};
  const state={owner:'a',ready:true,session:{authenticated:true,phoneVerified:true,application:{status:'active'}},handler:null,
    readyPromise:null,permissionHandler:async()=> 'granted',getHandler:async()=>null,subscribeHandler:async()=>subscription,
    permissions:0,subscriptions:0,getSubscriptions:0,registrations:0};
  const registration={pushManager:{getSubscription(){state.getSubscriptions++;return state.getHandler()},subscribe(){state.subscriptions++;return state.subscribeHandler()}}};
  const worker={getRegistration:async()=>registration};
  Object.defineProperty(worker,'ready',{get:()=>state.readyPromise||Promise.resolve(registration)});
  const sandbox={console,AbortController,Uint8Array,atob,Promise,
    setTimeout(fn,delay){const id=++sequence;timers.set(id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id),
    navigator:supported?{serviceWorker:worker}:{},
    document:{hidden:false,body,querySelector(selector){if(selector==='.header-actions')return null;if(selector==='header.topbar')return role==='rider'?header:null;if(selector==='.driver-shell header'||selector==='.driver-shell')return role==='captain'?header:null;return null},createElement:node,addEventListener:(key,fn)=>on('document:'+key,fn)},
    addEventListener:on,
    MishwarAccountContext:{snapshot:()=>({status:state.ready?'ready':'unknown',verified:state.ready}),capture:()=>({owner:state.owner}),isCurrent:ticket=>ticket.owner===state.owner},
    fetch:async(path,options={})=>{
      const data=options.body?JSON.parse(options.body):null;calls.push({path,options,data});
      if(state.handler){const result=state.handler(path,options,data);if(result!==undefined)return result}
      if(path==='/api/auth/session')return response(state.session);
      if(path==='/api/background?action=config')return response({configured:true,publicKey:'AQ'});
      if(data?.action==='register'){state.registrations++;return response({ok:true})}
      throw Error('Unexpected fixture request');
    },
  };
  sandbox.window=sandbox;
  if(supported){sandbox.PushManager=class{};sandbox.Notification={permission,requestPermission:async()=>{state.permissions++;const value=await state.permissionHandler();sandbox.Notification.permission=value;return value}}}
  vm.runInNewContext(file(role),sandbox,{filename:role+'-app-background.js'});
  const button=nodes.find(item=>item.id==='background-notifications-button');
  return {c:sandbox,state,calls,dialogs,button,header,subscription,timers,
    enable:()=>role==='rider'?sandbox.enableMishwarBackground():sandbox.enableMishwarPush(),
    event:(key,event={target:{closest:()=>null}})=>{for(const fn of listeners.get(key)||[])fn(event)},
    message:()=>dialogs.at(-1)?.children[1]?.textContent||'',
    async advance(ms){const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush()}now=end;await flush()},
  };
}

test('rider activation entry is appended before the bell and exempt from the header hiding rule',()=>{
  const h=harness('rider');assert.equal(h.header.children[0],h.button);
  assert.equal(h.button.attributes.get('aria-label'),'تفعيل إشعارات الخلفية');
  const css=readFileSync(new URL('../public/ride-ui.css',import.meta.url),'utf8');
  assert.match(css,/:not\(#background-notifications-button\)/);
});

for(const role of ['rider','captain']){
  test(role+' activation does not automatically ask permission and unsupported browsers explain the alternative',async()=>{
    const h=harness(role,{supported:false});assert.equal(await h.enable(),false);
    assert.match(h.message(),/لا يدعم/);assert.equal(h.calls.length,0);assert.equal(h.button.disabled,false);
    const supported=harness(role);await flush();assert.equal(supported.state.permissions,0);assert.equal(supported.calls.length,0);
  });
  test(role+' successful activation is deduplicated and never acknowledges inbox items',async()=>{
    const h=harness(role),pending=deferred();h.state.permissionHandler=()=>pending.promise;
    const first=h.enable(),second=h.enable();assert.equal(first,second);await flush();assert.equal(h.state.permissions,1);
    pending.resolve('granted');assert.equal(await first,true);assert.equal(h.state.subscriptions,1);assert.equal(h.state.registrations,1);
    assert.equal(h.button.disabled,false);assert.equal(h.button.attributes.get('aria-pressed'),'true');
    assert.equal(h.calls.filter(call=>call.path==='/api/background?action=config').length,1);
    assert.ok(h.calls.every(call=>call.data?.action!=='ack'));
  });
  test(role+' service worker ready has a whole-operation deadline and a late ready cannot register',async()=>{
    const h=harness(role),pending=deferred();h.state.readyPromise=pending.promise;
    const operation=h.enable();await flush();assert.equal(h.button.disabled,true);
    await h.advance(15000);assert.equal(await operation,false);assert.equal(h.button.disabled,false);assert.match(h.message(),/انتهت مهلة/);
    pending.resolve({pushManager:{getSubscription:async()=>null,subscribe:async()=>h.subscription}});await flush();
    assert.equal(h.state.registrations,0);assert.equal(h.button.attributes.get('aria-pressed'),'false');
  });
  test(role+' fetch and JSON hangs are bounded even when transport ignores abort',async()=>{
    for(const bodyHang of [false,true]){
      const h=harness(role),pending=deferred();
      h.state.handler=path=>path==='/api/background?action=config'?(bodyHang?{ok:true,status:200,json:()=>pending.promise}:pending.promise):undefined;
      const operation=h.enable();await flush();await h.advance(15000);
      assert.equal(await operation,false);assert.equal(h.button.disabled,false);assert.equal(h.state.permissions,0);
      const request=h.calls.find(call=>call.path==='/api/background?action=config');assert.equal(request.options.signal.aborted,true);
      pending.resolve(bodyHang?{configured:true,publicKey:'AQ'}:response({configured:true,publicKey:'AQ'}));await flush();
      assert.equal(h.state.registrations,0);
    }
  });
  test(role+' permission and push subscription hangs release the activation button',async()=>{
    for(const phase of ['permission','get','subscribe']){
      const h=harness(role),pending=deferred();
      if(phase==='permission')h.state.permissionHandler=()=>pending.promise;
      if(phase==='get')h.state.getHandler=()=>pending.promise;
      if(phase==='subscribe')h.state.subscribeHandler=()=>pending.promise;
      const operation=h.enable();await flush();await h.advance(15000);assert.equal(await operation,false);assert.equal(h.button.disabled,false);
      pending.resolve(phase==='permission'?'granted':h.subscription);await flush();assert.equal(h.state.registrations,0);
    }
  });
  test(role+' resetting the account cancels pending activation and prevents a late registration',async()=>{
    const h=harness(role),pending=deferred();h.state.readyPromise=pending.promise;
    const operation=h.enable();await flush();h.state.owner='b';h.event(role==='rider'?'mishwar-account-reset':'mishwar-captain-auth-required');
    assert.equal(await operation,false);pending.resolve({pushManager:{getSubscription:async()=>h.subscription}});await flush();
    assert.equal(h.state.registrations,0);assert.equal(h.button.disabled,false);assert.equal(h.dialogs.length,0);
  });
  test(role+' denied permission and failed registration never report activation success',async()=>{
    const denied=harness(role);denied.state.permissionHandler=async()=> 'denied';assert.equal(await denied.enable(),false);
    assert.equal(denied.state.registrations,0);assert.match(denied.message(),/لم يُسمح/);
    const failed=harness(role);failed.state.handler=(_,__,data)=>data?.action==='register'?response({},503):undefined;
    assert.equal(await failed.enable(),false);assert.equal(failed.button.attributes.get('aria-pressed'),'false');assert.equal(failed.button.disabled,false);
    for(const source of ['json','native']){
      const unexpected=harness(role);
      if(source==='json')unexpected.state.handler=path=>path==='/api/background?action=config'?{ok:true,status:200,json:async()=>{throw SyntaxError('Unexpected token in fixture-secret response')}}:undefined;
      else unexpected.state.getHandler=async()=>{throw TypeError('Failed to fetch fixture-secret endpoint')};
      assert.equal(await unexpected.enable(),false);assert.match(unexpected.message(),/تعذر تفعيل الإشعارات/);
      assert.doesNotMatch(unexpected.message(),/Unexpected|SyntaxError|Failed|fixture-secret/);
    }
  });
  test(role+' a hung registration cannot report success after the operation deadline',async()=>{
    const h=harness(role),pending=deferred();h.state.handler=(_,__,data)=>data?.action==='register'?pending.promise:undefined;
    const operation=h.enable();await flush();await h.advance(15000);assert.equal(await operation,false);
    assert.equal(h.button.disabled,false);assert.equal(h.button.attributes.get('aria-pressed'),'false');
    pending.resolve(response({ok:true}));await flush();assert.equal(h.button.attributes.get('aria-pressed'),'false');
    assert.doesNotMatch(h.message(),/تم تسجيل هذا الجهاز/);
  });
  test(role+' automatic sync reuses only an existing subscription and never creates or asks permission',async()=>{
    const h=harness(role,{permission:'granted'});h.state.getHandler=async()=>h.subscription;await flush();
    assert.equal(h.state.registrations,1);assert.equal(h.state.permissions,0);assert.equal(h.state.subscriptions,0);
    const absent=harness(role,{permission:'granted'});await flush();assert.equal(absent.state.registrations,0);assert.equal(absent.state.subscriptions,0);
  });
}

test('captain inactive/anonymous session is checked before permission or subscription work',async()=>{
  const h=harness('captain');h.state.session={authenticated:false,phoneVerified:false};assert.equal(await h.enable(),false);
  assert.deepEqual(h.calls.map(call=>call.path),['/api/auth/session']);assert.equal(h.state.permissions,0);assert.equal(h.state.subscriptions,0);
});

test('captain existing account notification entry invokes the bounded activation flow',async()=>{
  const h=harness('captain');h.event('document:click',{target:{closest:selector=>selector.includes('data-notification-settings')?{}:null}});await flush();
  assert.equal(h.state.permissions,1);assert.equal(h.state.registrations,1);
  assert.match(readFileSync(new URL('../../hub/public/driver.js',import.meta.url),'utf8'),/data-notification-settings/);
});

test('revoked notification permission cannot retain a false enabled state',async()=>{
  const h=harness('rider');assert.equal(await h.enable(),true);h.c.Notification.permission='denied';h.state.permissionHandler=async()=> 'denied';
  assert.equal(await h.enable(),false);assert.equal(h.button.attributes.get('aria-pressed'),'false');assert.match(h.message(),/لم يُسمح/);
});
