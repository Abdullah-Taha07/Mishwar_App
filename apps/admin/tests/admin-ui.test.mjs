import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
const source = name => readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

test('all admin text assets are valid UTF-8 without damaged Arabic placeholders',()=>{
  for(const file of readdirSync(new URL('../public/',import.meta.url)).filter(f=>/\.(js|css|html|webmanifest|svg)$/.test(f))){
    const bytes=readFileSync(new URL('../public/'+file,import.meta.url));
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    assert.doesNotMatch(text,/\?{3,}|\uFFFD/,file);
  }
  assert.match(source('index.html'),/<meta charset="utf-8">/);
  assert.match(source('index.html'),/id="install" hidden/);
});

test('install is exposed only for a fresh browser prompt and consumed once',async()=>{
  const button={hidden:false,disabled:false},events={},display={matches:false,addEventListener(name,fn){this.change=fn;}};
  vm.runInNewContext(source('install.js'),{document:{querySelector:()=>button},window:{addEventListener:(name,fn)=>events[name]=fn},navigator:{},matchMedia:()=>display});
  assert.equal(button.hidden,true);
  let calls=0,prevented=false;
  const prompt={preventDefault(){prevented=true;},async prompt(){calls++;},userChoice:Promise.resolve({outcome:'dismissed'})};
  events.beforeinstallprompt(prompt);
  assert.equal(prevented,true);assert.equal(button.hidden,false);
  await button.onclick();assert.equal(calls,1);assert.equal(button.hidden,true);assert.equal(button.disabled,false);
  await button.onclick();assert.equal(calls,1);
  events.beforeinstallprompt(prompt);events.appinstalled();assert.equal(button.hidden,true);
  display.matches=true;events.beforeinstallprompt(prompt);assert.equal(button.hidden,true);
});

function mount(data,forms=[]){
  const elements=new Map();
  const list={innerHTML:'',querySelectorAll(selector){return selector==='[data-renewal]'?forms:[];}};
  for(const name of ['[data-doc-search]','[data-doc-filter]','[data-doc-result]','[data-doc-message]','.document-counters','[data-doc-reset]'])elements.set(name,{value:name==='[data-doc-filter]'?'all':'',innerHTML:'',textContent:'',focus(){}});
  elements.set('.captain-document-list',list);
  const target={isConnected:true,innerHTML:'',querySelector:name=>elements.get(name)};
  const window={};const calls=[];
  vm.runInNewContext(source('document-console.js'),{window,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/documents')?data:{ok:true}};}});
  window.renderDocuments(data,target);
  return {elements,list,calls};
}
const captain=()=>({id:'sample',name:'<img onerror=alert(1)>',phone:'+966 512345678',reference:'KM-SAMPLE',states:['pending','expired'],documents:Array.from({length:9},(_,i)=>({kind:'doc'+i,title:'مستند '+i,state:i?'present':'expired',date:i?null:'2020-01-01',present:true,pending:!i})),renewals:[{id:'renewal',kind:'insurance',expires_at:'2030-01-01',status:'pending',created_at:'2026-11-15'}],history:[{kind:'insurance',decision:'rejected',reviewer_id:'reviewer',previous_expiry:'2020-01-01',replacement_expiry:'2030-01-01',reason:'ملف غير واضح'}]});
const data=()=>({counters:{total:1,pending:1,expired:1},items:[captain()],asOf:'2026-11-15'});
test('document cards include nine documents, protected previews, requests and audit; search handles Arabic digits',()=>{
  const {elements,list}=mount(data());
  assert.equal((list.innerHTML.match(/class="document-tile"/g)||[]).length,9);
  assert.match(list.innerHTML,/&lt;img onerror=alert\(1\)&gt;/);assert.doesNotMatch(list.innerHTML,/<img/);
  assert.match(list.innerHTML,/سجل المراجعات/);assert.match(list.innerHTML,/reviewer/);assert.match(list.innerHTML,/renewals\?file=renewal/);
  const search=elements.get('[data-doc-search]');search.value='٥١٢٣٤٥٦٧٨';search.oninput();assert.match(list.innerHTML,/data-captain="sample"/);
  elements.get('[data-doc-filter]').value='valid';elements.get('[data-doc-filter]').onchange();assert.match(list.innerHTML,/لا توجد نتائج/);
  elements.get('[data-doc-reset]').onclick();assert.match(list.innerHTML,/data-captain="sample"/);
});
test('review confirmation and rejection reason prevent invalid POST; valid decisions keep API contract',async()=>{
  const error={textContent:''},buttons=[{disabled:false},{disabled:false}];
  const form={dataset:{renewal:'renewal'},elements:{reason:{value:'',focus(){}},reviewed:{checked:false}},querySelector:()=>error,querySelectorAll:()=>buttons};
  const {calls}=mount(data(),[form]);
  const submit=decision=>form.onsubmit({preventDefault(){},submitter:{value:decision}});
  await submit('approved');assert.equal(calls.length,0);assert.match(error.textContent,/أكد/);
  await submit('rejected');assert.equal(calls.length,0);assert.match(error.textContent,/سبب الرفض/);
  form.elements.reviewed.checked=true;
  await submit('approved');assert.equal(calls.length,2);
  assert.deepEqual(JSON.parse(calls[0].options.body),{id:'renewal',decision:'approved',reason:'',confirmReviewed:true});
  assert.equal(calls[0].url,'/api/admin/launch/renewals');
});
