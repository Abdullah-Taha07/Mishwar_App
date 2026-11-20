import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const response=value=>({ok:true,json:async()=>value});
function harness(role){
 const events=new Map(),storage=new Map(),requests=[],timers=new Map();let nextId=0,timerId=0;
 const state={owner:'A',handler:null,dialog:null};
 const on=(key,fn)=>{if(!events.has(key))events.set(key,[]);events.get(key).push(fn)};
 const off=(key,fn)=>{events.set(key,(events.get(key)||[]).filter(x=>x!==fn))};
 function node(){const attributes=new Map();const value={value:'',textContent:'',innerHTML:'',disabled:false,isConnected:true,dataset:{},scrollHeight:0,scrollTop:0,setAttribute:(name,text)=>attributes.set(name,String(text)),getAttribute:name=>attributes.get(name)??null,addEventListener:(name,fn)=>on(value.key+':'+name,fn),removeEventListener:(name,fn)=>off(value.key+':'+name,fn),key:'node'+(++nextId)};return value}
 function dialog(){
  const d=node(),fields={body:node(),kind:node(),description:node()},button=node(),error=node(),log=node(),back=node(),body=node();d.open=false;
  const form=node();Object.assign(form,fields);form.querySelector=selector=>selector==='button'?button:null;form.reset=()=>{fields.body.value='';fields.description.value=''};
  for(const field of Object.values(fields))field.parentForm=form;
  d.querySelector=selector=>({'[data-launch-back]':back,'form':form,'[data-error]':error,'.chat-log':log,'.launch-body':body}[selector]||null);
  const caseButton={dataset:{case:'case-A'},onclick:null};d.querySelectorAll=selector=>selector==='[data-case]'?[caseButton]:[];d.caseButton=caseButton;d.showModal=()=>{d.open=true;state.dialog=d};d.close=()=>{d.open=false;for(const fn of events.get(d.key+':close')||[])fn()};d.remove=()=>{d.isConnected=false};
  return Object.assign(d,{form,fields,button,error,log,content:body});
 }
 const c={console:{warn(){},error(){}},Promise,Map,Set,Date,JSON,AbortController,crypto:{randomUUID:()=> '00000000-0000-4000-8000-'+String(++nextId).padStart(12,'0')},
  setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval(){},
  sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  document:{hidden:false,querySelector:selector=>selector==='.driver-shell'?(role==='captain'?{}:null):selector==='#launch-dialog'?state.dialog:null,createElement:tag=>tag==='dialog'?dialog():node(),body:{append(){}},addEventListener:(name,fn)=>on('document:'+name,fn)},
  addEventListener:on,removeEventListener:off,
  MishwarAccountContext:{capture:()=>({accountKey:state.owner}),snapshot:()=>({status:'ready'}),isCurrent:ticket=>ticket.accountKey===state.owner},
  data:{captain:{id:'A'}},location:{origin:'https://local.test'},
  fetch:async(_,options)=>{const body=JSON.parse(options.body);requests.push({body,options});if(state.handler){const result=state.handler(body);if(result!==undefined)return result}return response(body.action.endsWith('case_messages')?{case:{status:'open'},messages:[]}:{messages:[]})},
 };
 c.window=c;vm.createContext(c);
 const file=readFileSync(new URL(role==='rider'?'../public/launch-ui.js':'../../hub/public/launch-ui.js',import.meta.url),'utf8');
 // Execute the real component, leaving the unrelated legacy text-normalizer out.
 vm.runInContext(file.split('/* MISHWAR_RIDER_V9_ERRORS */')[0],c);
 const launch=async(type='chat',tripId='trip-A')=>{const button={dataset:{launch:type,tripId}};for(const fn of events.get('document:click')||[])fn({target:{closest:selector=>selector==='[data-launch]'?button:null},preventDefault(){}});await flush();return state.dialog};
 return {c,state,requests,storage,timers,launch,async openCase(){await c.MishwarLaunch.cases();state.dialog.caseButton.onclick();await flush();return state.dialog},async type(input,value){input.value=value;for(const fn of events.get(input.key+':input')||[])fn();for(const fn of events.get(input.parentForm?.key+':input')||[])fn();await flush()},async submit(d){await d.form.onsubmit({preventDefault(){},target:d.form});await flush()},async reset(owner){state.owner=owner;c.data.captain.id=owner;for(const fn of events.get(role==='rider'?'mishwar-account-reset':'mishwar-captain-auth-required')||[])fn();await flush()}};
}

test('rider launch dialog names its open conversation with the rendered heading',async()=>{
 const h=harness('rider'),d=await h.launch();
 assert.equal(d.open,true);
 assert.equal(d.getAttribute('aria-labelledby'),'launch-dialog-title');
 assert.match(d.innerHTML,/<h2 id="launch-dialog-title">محادثة المشوار<\/h2>/);
});

for(const role of ['rider','captain']){
 test(role+' send is not discarded while a chat poll is pending and late poll cannot duplicate or erase messages',async()=>{
  const h=harness(role),poll=deferred();h.state.handler=body=>!body.body?poll.promise:response({messages:[{id:2,role,body:body.body,created_at:'2026-11-16'}]});
  const d=await h.launch();await h.type(d.fields.body,'first message');await h.submit(d);
  assert.equal(h.requests.filter(x=>x.body.body==='first message').length,1);assert.equal(d.fields.body.value,'');assert.match(d.log.innerHTML,/first message/);
  poll.resolve(response({messages:[{id:1,role:'other',body:'earlier',created_at:'2026-11-16'},{id:2,role,body:'first message',created_at:'2026-11-16'}]}));await flush();
  assert.equal((d.log.innerHTML.match(/first message/g)||[]).length,1);assert.match(d.log.innerHTML,/earlier/);
 });
 test(role+' network failure retains draft and exact retry key, while edits rotate that key',async()=>{
  const h=harness(role);let fail=true;h.state.handler=body=>body.body?(fail?Promise.reject(Error('network fixture')):response({messages:[]})):response({messages:[]});
  const d=await h.launch();await h.type(d.fields.body,'keep draft');await h.submit(d);
  assert.equal(d.fields.body.value,'keep draft');const key=h.requests.at(-1).body.clientRequestId;assert.match(key,/^[0-9a-f-]{36}$/);
  await h.submit(d);assert.equal(h.requests.at(-1).body.clientRequestId,key);
  await h.type(d.fields.body,'edited draft');await h.submit(d);assert.notEqual(h.requests.at(-1).body.clientRequestId,key);
  fail=false;await h.submit(d);assert.equal(d.fields.body.value,'');
 });
 test(role+' typing during send survives success, and closing/reopening restores the current owner draft',async()=>{
  const h=harness(role),pending=deferred();h.state.handler=body=>body.body?pending.promise:response({messages:[]});
  const d=await h.launch();await h.type(d.fields.body,'sent snapshot');const sending=h.submit(d);await flush();
  await h.type(d.fields.body,'new unsent text');pending.resolve(response({messages:[]}));await sending;assert.equal(d.fields.body.value,'new unsent text');
  d.close();const reopened=await h.launch();assert.equal(reopened.fields.body.value,'new unsent text');
 });
 test(role+' owner reset aborts pending send and cannot expose or clear another owner draft',async()=>{
  const h=harness(role),pending=deferred();h.state.handler=body=>body.body?pending.promise:response({messages:[]});
  const d=await h.launch();await h.type(d.fields.body,'private A');const sending=h.submit(d);await flush();await h.reset('B');await sending;
  pending.resolve(response({messages:[{id:99,body:'private server A',role,created_at:'2026-11-16'}]}));await flush();assert.doesNotMatch(d.log.innerHTML,/private server A/);
  const b=await h.launch();assert.equal(b.fields.body.value,'');await h.type(b.fields.body,'private B');await h.reset('A');const a=await h.launch();assert.equal(a.fields.body.value,'private A');
 });
 test(role+' a hung send releases its lock after deadline without clearing the draft or auto replaying',async()=>{
  const h=harness(role),pending=deferred();h.state.handler=body=>body.body?pending.promise:response({messages:[]});
  const d=await h.launch();await h.type(d.fields.body,'pending text');const sending=h.submit(d);await flush();
  for(const [id,timer]of [...h.timers])if(timer.ms===15000){h.timers.delete(id);timer.fn()}
  await sending;assert.equal(d.button.disabled,false);assert.equal(d.fields.body.value,'pending text');assert.equal(h.requests.filter(x=>x.body.body).length,1);
  pending.resolve(response({messages:[]}));await flush();assert.equal(d.fields.body.value,'pending text');
 });
 test(role+' case creation drafts survive close, failed retries, and changed text during confirmed send',async()=>{
  const h=harness(role),pending=deferred();let fail=true;
  h.state.handler=body=>body.action.endsWith('case_create')?(fail?Promise.reject(Error('network fixture')):pending.promise):response({case:{status:'open'},messages:[]});
  const d=await h.launch('case');await h.type(d.fields.description,'Support case description');await h.submit(d);
  const firstId=h.requests.at(-1).body.clientRequestId;assert.equal(d.fields.description.value,'Support case description');
  d.close();const reopened=await h.launch('case');assert.equal(reopened.fields.description.value,'Support case description');await h.submit(reopened);
  assert.equal(h.requests.at(-1).body.clientRequestId,firstId);fail=false;
  const sending=h.submit(reopened);await flush();await h.type(reopened.fields.description,'New unsent support draft');pending.resolve(response({id:'case-A'}));await sending;
  assert.equal(reopened.open,true);assert.equal(reopened.fields.description.value,'New unsent support draft');assert.match(reopened.error.textContent,/احتفظنا/);
 });
 test(role+' case reply keeps its failed retry ID and does not replace newly typed text on success',async()=>{
  const h=harness(role),pending=deferred();let fail=true;
  h.state.handler=body=>body.action.endsWith('_cases')||body.action==='cases'?response({items:[{id:'case-A',kind:'technical',status:'open',description:'Support message'}]}):body.body?(fail?Promise.reject(Error('network fixture')):pending.promise):response({case:{status:'open'},messages:[]});
  const d=await h.openCase();await h.type(d.fields.body,'Reply snapshot');await h.submit(d);const id=h.requests.at(-1).body.clientRequestId;
  d.close();const reopened=await h.openCase();assert.equal(reopened.fields.body.value,'Reply snapshot');await h.submit(reopened);assert.equal(h.requests.at(-1).body.clientRequestId,id);
  fail=false;const sending=h.submit(reopened);await flush();await h.type(reopened.fields.body,'New reply draft');pending.resolve(response({case:{status:'open'},messages:[{role,body:'Reply snapshot'}]}));await sending;
  assert.equal(reopened.fields.body.value,'New reply draft');assert.match(reopened.log.innerHTML,/Reply snapshot/);
 });
}
