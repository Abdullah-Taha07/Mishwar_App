import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
function harness(){
 const elements=[],texts=[],callbacks=[],stored=new Map();let mutation;
 function element(tag='div',attributes={},parent=null){
  const attrs=new Map(Object.entries(attributes));
  const node={tagName:tag.toUpperCase(),dataset:{},parentElement:parent,children:[],textContent:'',value:'',type:'button',isConnected:true,
   hasAttribute:name=>attrs.has(name),getAttribute:name=>attrs.get(name)??null,setAttribute(name,value){attrs.set(name,String(value))},
   append(child){child.parentElement=this;this.children.push(child)},prepend(child){child.parentElement=this;this.children.unshift(child)},
   querySelector:()=>null,
   closest(selector){
    const selectors=selector.split(',');let current=this;
    while(current){for(const part of selectors){const query=part.trim();if(query.toUpperCase()===current.tagName)return current;if(query.startsWith('#')&&current.id===query.slice(1))return current;if(query.startsWith('.')&&current.classes?.includes(query.slice(1)))return current;const attr=query.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(attr&&current.hasAttribute(attr[1])&&(attr[2]===undefined||current.getAttribute(attr[1])===attr[2]))return current}current=current.parentElement}return null;
   },
  };
  for(const [name,value]of attrs)if(name.startsWith('data-'))node.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;
  elements.push(node);return node;
 }
 const body=element('body'),html=element('html');
 function text(value,parent=body){const node={nodeValue:value,parentElement:parent};texts.push(node);return node}
 const document={body,documentElement:html,title:'مشوار | رحلتك تبدأ هنا',createElement:tag=>element(tag),
  createTreeWalker(){let index=0;return{nextNode:()=>texts[index++]||null}},
  querySelector(selector){return selector==='#mishwar-language'?elements.find(el=>el.id==='mishwar-language')||null:null},
  querySelectorAll(selector){
   if(selector==='[placeholder],[title],[aria-label]')return elements.filter(el=>['placeholder','title','aria-label'].some(name=>el.hasAttribute(name)));
   if(selector==='[data-localized-date]')return elements.filter(el=>el.hasAttribute('data-localized-date'));
   if(selector==='dialog[open]'||selector==='[data-inline-language]')return[];return[];
  },
 };
 const sandbox={console,document,WeakMap,Map,Set,Date,JSON,String,Number,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{constructor(fn){mutation=fn}disconnect(){}observe(){}},
  queueMicrotask:fn=>callbacks.push(fn),localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},dispatchEvent(){},
 };
 sandbox.window=sandbox;vm.createContext(sandbox);
 const load=()=>{vm.runInContext(source('i18n-catalog.js'),sandbox);vm.runInContext(source('i18n.js'),sandbox)};
 const flush=()=>{for(const fn of callbacks.splice(0))fn()};
 return{c:sandbox,document,element,text,body,stored,load,flush,mutate(){mutation();flush()}};
}

test('English translates static and dynamic UI text and restores exact Arabic when switched back',()=>{
 const h=harness(),title=h.text('الإعدادات'),cooldown=h.text('إعادة الإرسال بعد ٣٠ ثانية');h.load();
 h.c.MishwarLang.set('en');assert.equal(title.nodeValue,'Settings');assert.equal(cooldown.nodeValue,'Resend in 30 seconds');assert.equal(h.document.documentElement.dir,'ltr');assert.equal(h.document.title,'Mishwar | Your journey starts here');
 h.c.MishwarLang.set('ar');assert.equal(title.nodeValue,'الإعدادات');assert.equal(cooldown.nodeValue,'إعادة الإرسال بعد ٣٠ ثانية');assert.equal(h.document.documentElement.dir,'rtl');assert.equal(h.document.title,'مشوار | رحلتك تبدأ هنا');
});

test('Arabic user text, user attributes and editable values are never translated',()=>{
 const h=harness(),protectedNode=h.element('span',{'data-no-translate':'',title:'اختر أحمد'},h.body),name=h.text('اختر أحمد',protectedNode),field=h.element('input',{placeholder:'كلمة المرور الحالية'},h.body);
 field.value='كلمة مرور شخصية لا تتغير';const textarea=h.element('textarea',{},h.body),message=h.text('اختر هذا العنوان الشخصي',textarea);
 h.load();h.c.MishwarLang.set('en');assert.equal(name.nodeValue,'اختر أحمد');assert.equal(protectedNode.getAttribute('title'),'اختر أحمد');assert.equal(message.nodeValue,'اختر هذا العنوان الشخصي');assert.equal(field.value,'كلمة مرور شخصية لا تتغير');assert.equal(field.getAttribute('placeholder'),'Current password');
 h.c.MishwarLang.set('ar');assert.equal(field.getAttribute('placeholder'),'كلمة المرور الحالية');assert.equal(field.value,'كلمة مرور شخصية لا تتغير');
});

test('new async errors are translated after DOM updates while unknown user text remains original',()=>{
 const h=harness(),error=h.element('p',{role:'alert'},h.body),errorText=h.text('',error),user=h.text('شارع اختر الجديد');h.load();h.c.MishwarLang.set('en');
 errorText.nodeValue='كلمة المرور الحالية غير صحيحة';h.mutate();assert.equal(errorText.nodeValue,'Your current password is incorrect.');assert.equal(user.nodeValue,'شارع اختر الجديد');
 errorText.nodeValue='تفصيل خطأ جديد غير مصنف';h.mutate();assert.equal(errorText.nodeValue,'The request could not be completed. Please try again.');
 h.c.MishwarLang.set('ar');assert.equal(errorText.nodeValue,'تفصيل خطأ جديد غير مصنف');
});

test('localized timestamps switch language directly without replacing account or support forms',()=>{
 const h=harness(),time=h.element('time',{'datetime':'2026-11-16T09:30:00Z','data-localized-date':'','data-date-style':'datetime'},h.body),draft=h.element('textarea',{},h.body);
 draft.value='مسودة طلب دعم لم تُرسل';h.load();assert.match(time.textContent,/[\u0600-\u06ff]/);
 h.c.MishwarLang.set('en');assert.doesNotMatch(time.textContent,/[\u0600-\u06ff]/);assert.equal(draft.value,'مسودة طلب دعم لم تُرسل');
 h.c.MishwarLang.set('ar');assert.match(time.textContent,/[\u0600-\u06ff]/);assert.equal(draft.value,'مسودة طلب دعم لم تُرسل');
});

test('rider and shared tracking entry points load the catalog before the translator',()=>{
 for(const entry of ['index.html','track.html']){const html=source(entry);assert.ok(html.indexOf('/i18n-catalog.js')>=0);assert.ok(html.indexOf('/i18n-catalog.js')<html.indexOf('/i18n.js'));}
});

test('compact help heading translates in live DOM and restores Arabic on language switch',()=>{
 const h=harness(),heading=h.text('كيف نقدر نساعدك؟');h.load();
 h.c.MishwarLang.set('en');assert.equal(heading.nodeValue,'How can we help you?');
 h.c.MishwarLang.set('ar');assert.equal(heading.nodeValue,'كيف نقدر نساعدك؟');
});

test('real profile avatar initials stay as user input while system headings translate',()=>{
 const riderAuth=source('rider-auth.js'),features=source('features.js');
 assert.match(riderAuth, /class="profile-avatar" data-no-translate>\$\{esc\(\(p\.name/);
 assert.match(features, /class="profile-circle" data-no-translate>\$\{esc\(name\.charAt/);
 assert.match(features, /class="profile-circle small" data-no-translate>\$\{esc\(initialName\(\)\.charAt/);
 const h=harness(),avatar=h.element('span',{'data-no-translate':''},h.body),initial=h.text('أ',avatar),heading=h.text('ملفي الشخصي');
 h.load();h.c.MishwarLang.set('en');
 assert.equal(initial.nodeValue,'أ');assert.equal(heading.nodeValue,'My profile');
 h.c.MishwarLang.set('ar');assert.equal(initial.nodeValue,'أ');assert.equal(heading.nodeValue,'ملفي الشخصي');
});
