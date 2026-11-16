import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
function fields(names,defaults={}){
 const button={disabled:false},result={textContent:''},form={dataset:{},isConnected:true};
 for(const name of names)form[name]={value:defaults[name]||''};
 form.querySelector=selector=>selector==='button'?button:result;
 form.reset=()=>{for(const name of names)form[name].value=defaults[name]||''};
 return form;
}
function portalHarness(){
 let form=null,nextId=0;const calls=[],state={handler:null};
 const box={isConnected:true,contains:value=>value===form};
 Object.defineProperty(box,'innerHTML',{set(){if(form)form.isConnected=false;const fresh=fields(['subject','category','reference','description'],{category:'support'});fresh.replaceWith=retained=>{fresh.isConnected=false;retained.isConnected=true;form=retained};form=fresh}});
 const content={dataset:{page:'support'}},refresh={disabled:false,textContent:''};
 const c={window:{refreshAdminNotifications(){}},document:{querySelectorAll:()=>[]},crypto:{randomUUID:()=> '00000000-0000-4000-8000-'+String(++nextId).padStart(12,'0')},
  page:'support',offset:0,query:'',filter:'all',version:0,currentRows:[],URLSearchParams,
  $:selector=>selector==='#page-data'?box:selector==='#content'?content:selector==='#portal-refresh'?refresh:selector==='#support-form'?form:null,
  panel:(_,body)=>body,empty:()=>'',controls:()=>'',table:()=>'',row:()=>'',esc:String,date:String,states:{},heading:()=>'',bindRecords(){},showError(error){throw error},
  api:async()=>state.handler?state.handler():{items:[],total:0},post:async(path,body)=>{calls.push({path,body});return state.post?state.post(path,body):{ok:true}},
 };
 vm.createContext(c);const code=source('portal.js');vm.runInContext(code.slice(code.indexOf('// Preserve the support form'),code.indexOf('\nfunction connection(')),c);
 return {c,state,calls,get form(){return form},async load(){await c.loadPage()},input(values){for(const [key,value]of Object.entries(values))form[key].value=value;form.oninput()},submit:()=>c.submitSupportDraft(form)};
}

test('admin support draft and its actual form node survive an in-flight refresh after input blur',async()=>{
 const h=portalHarness();await h.load();const original=h.form,pending=deferred();h.state.handler=()=>pending.promise;
 const refresh=h.load();h.input({subject:'Unsent subject',description:'Typed while request pending'});pending.resolve({items:[],total:0});await refresh;
 assert.equal(h.form,original);assert.equal(h.form.subject.value,'Unsent subject');assert.equal(h.form.description.value,'Typed while request pending');
});

test('admin support failed send retains snapshot/key and successful retry clears only that exact draft',async()=>{
 const h=portalHarness();await h.load();h.input({subject:'Network issue',description:'Keep original message'});h.state.post=async()=>{throw Error('network')};await h.submit();
 const id=h.calls[0].body.clientRequestId;assert.equal(h.form.description.value,'Keep original message');await h.submit();assert.equal(h.calls[1].body.clientRequestId,id);
 const pending=deferred();h.state.post=()=>pending.promise;const send=h.submit();await flush();h.input({description:'New typing during send'});pending.resolve({ok:true});await send;
 assert.equal(h.form.description.value,'New typing during send');assert.equal(h.form.querySelector('button').disabled,false);
 await h.submit();assert.equal(h.form.description.value,'');assert.notEqual(h.calls.at(-1).body.clientRequestId,id);
});

function consoleHarness(){
 const calls=[],state={handler:null,page:'service-desk'},timers=new Map();let sequence=0,form=null,items=[],back=null,log=null,html='';
 const item=id=>({id,trip_id:null,kind:'technical',description:'General support without a trip',status:'open',assigned_to:'',updated_at:'2026-11-16'});
 const host={dataset:{get page(){return state.page}}};
 const target={isConnected:true,closest:()=>host,querySelector:selector=>selector==='form'?form:selector==='[data-back-cases]'?back:selector==='.admin-case-log'?log:null,querySelectorAll:selector=>selector==='[data-case]'?items:[]};
 Object.defineProperty(target,'innerHTML',{get:()=>html,set(value){html=value;if(form)form.isConnected=false;form=null;items=[];back=null;log=null;if(value.includes('id="case-reply"')){form=fields(['body','assignedTo','status'],{status:'open'});back={onclick:null,addEventListener(){}};log={innerHTML:''}}else if(value.includes('data-case="')){items=[...value.matchAll(/data-case="([^"]+)"/g)].map(match=>({dataset:{case:match[1]},onclick:null}))}}});
 const c={console,Promise,Map,Set,Date,JSON,AbortController,crypto:{randomUUID:()=> '00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0')},
  setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
  window:{mishwarStaffSession:null},fetch:async(url,options={})=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,body,options});const result=state.handler?.(url,body);if(result!==undefined)return result;return {ok:true,json:async()=>body?{ok:true}:url.includes('?id=')?{item:item(new URL(url,'https://admin.test').searchParams.get('id')),messages:[]}:{items:[item('case-A'),item('case-B')]}}},
 };
 vm.createContext(c);vm.runInContext(source('launch-console.js'),c);
 return {c,target,calls,state,timers,get form(){return form},get html(){return html},async list(){await c.window.renderLaunchConsole('service-desk',target)},async open(index=0){await items[index].onclick();await flush()},input(values){for(const [key,value]of Object.entries(values))form[key].value=value;form.oninput()},submit(){return form.onsubmit({preventDefault(){},target:form})}};
}

test('admin service desk renders general cases safely and restores reply drafts after list refresh',async()=>{
 const h=consoleHarness();await h.list();assert.match(h.html,/طلب عام دون رحلة/);await h.open();h.input({body:'Keep reply',assignedTo:'operator-1'});
 await h.list();await h.open();assert.equal(h.form.body.value,'Keep reply');assert.equal(h.form.assignedTo.value,'operator-1');
});

test('late admin case read cannot replace a newer case and cannot restore another staff draft',async()=>{
 const h=consoleHarness();await h.list();const pending=deferred();h.state.handler=url=>url.includes('id=case-A')?pending.promise:undefined;
 const first=h.open(0);await flush();await h.open(1);pending.resolve({ok:true,json:async()=>({item:{id:'case-A',status:'open',assigned_to:''},messages:[]})});await first;
 assert.match(h.html,/case-B/);assert.doesNotMatch(h.html,/متابعة الطلب case-A/);
 h.input({body:'Owner private draft'});h.c.window.mishwarStaffSession={staff:{id:'different-staff'}};await h.list();await h.open(1);assert.equal(h.form.body.value,'');
});

test('admin reply retry keeps full payload identity and successful send preserves newer typing',async()=>{
 const h=consoleHarness();await h.list();await h.open();h.input({body:'Original reply',assignedTo:'one',status:'in_progress'});
 h.state.handler=(_,body)=>body?Promise.reject(Error('network')):undefined;await h.submit();const first=h.calls.at(-1).body.clientRequestId;await h.submit();assert.equal(h.calls.at(-1).body.clientRequestId,first);
 h.input({assignedTo:'two'});await h.submit();assert.notEqual(h.calls.at(-1).body.clientRequestId,first);
 const pending=deferred();h.state.handler=(_,body)=>body?pending.promise:undefined;const sending=h.submit();await flush();h.input({body:'New reply while sending'});pending.resolve({ok:true,json:async()=>({ok:true})});await sending;
 assert.equal(h.form.body.value,'New reply while sending');assert.equal(h.form.querySelector('button').disabled,false);
});

test('admin case response arriving after navigation cannot repaint a different portal page',async()=>{
 const h=consoleHarness();await h.list();const pending=deferred();h.state.handler=url=>url.includes('?id=')?pending.promise:undefined;
 const open=h.open();await flush();h.state.page='trips';h.target.innerHTML='<p>Current trips view</p>';
 pending.resolve({ok:true,json:async()=>({item:{id:'case-A',status:'open',assigned_to:''},messages:[]})});await open;
 assert.equal(h.html,'<p>Current trips view</p>');
});
