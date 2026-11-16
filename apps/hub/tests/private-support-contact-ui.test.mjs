import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const files = {
  settings: '../public/account-settings.js', captainRecovery: '../public/recovery-ui.js',
  riderRecovery: '../../rider/public/recovery-ui.js', riderAuth: '../../rider/public/rider-auth.js',
};
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Small DOM fixture that executes the shipped event handlers and preserves form
// ancestry. Network, navigation and clipboard effects remain under observation.
function harness(path, {captain = false, initialSession = null} = {}) {
  const calls = [], snapshots = [], externalActions = [], notices = [], events = new Map(), stored = new Map();
  const voidTags = new Set(['input','br','img','hr','meta','link']);
  class Node {
    constructor(tag = 'div', attrs = {}) {
      this.tagName = tag; this.attrs = attrs; this.children = []; this.parent = null;
      this.listeners = new Map(); this.isConnected = true; this.disabled = false; this.value = attrs.value || '';
      this.elements = {}; this._text = ''; this._html = ''; this.open = false;
      this.classList = {add: () => {}, remove: () => {}};
    }
    set innerHTML(value) {
      for (const child of this.children) child.disconnect();
      this._html = String(value); this._text = ''; this.children = []; this.elements = {}; snapshots.push(this._html);
      const stack = [this];
      for (const token of this._html.match(/<[^>]*>|[^<]+/g) || []) {
        if (token.startsWith('</')) { const tag = token.slice(2,-1); if (stack.at(-1).tagName === tag) stack.pop(); continue; }
        if (!token.startsWith('<')) { stack.at(-1)._text += token; continue; }
        const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
        const attrs = Object.fromEntries([...token.matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)].slice(1).map(m => [m[1],m[2] ?? m[3] ?? '']));
        const node = new Node(tag, attrs); stack.at(-1).append(node);
        if (attrs.name) {
          const form = [...stack].reverse().find(item => item.tagName === 'form');
          if (form) { form.elements[attrs.name] = node; form[attrs.name] = node; }
        }
        if (tag === 'option') { const select = [...stack].reverse().find(item => item.tagName === 'select'); if (select && !select.value) select.value = attrs.value || ''; }
        if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(node);
      }
    }
    get innerHTML() { return this._html; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(node) { if (typeof node === 'string') { this._text += node; return; } node.parent = this; node.isConnected = this.isConnected; this.children.push(node); }
    disconnect() { this.isConnected = false; for (const child of this.children) child.disconnect(); }
    remove() { this.disconnect(); if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    close() { this.open = false; for (const fn of this.listeners.get('close') || []) fn({target:this}); }
    showModal() { this.open = true; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name,[]); this.listeners.get(name).push(fn); }
    querySelectorAll(selector) {
      const matches = node => {
        if (selector.startsWith('#')) return (node.id || node.attrs.id) === selector.slice(1);
        if (selector.startsWith('.')) return (node.attrs.class || '').split(/\s+/).includes(selector.slice(1));
        const attr = selector.match(/^(\w+)?\[([^=\]]+)(?:=([^\]]+))?\]$/);
        if (attr) return (!attr[1] || node.tagName === attr[1]) && attr[2] in node.attrs && (attr[3] === undefined || node.attrs[attr[2]] === attr[3].replaceAll('"',''));
        return node.tagName === selector;
      };
      const result = []; const walk = node => { for (const child of node.children) { if (matches(child)) result.push(child); walk(child); } }; walk(this); return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const body = new Node('body'), modal = new Node('dialog',{id:'modal'}), app = captain ? new Node('div',{id:'app'}) : null;
  body.append(modal); if (app) body.append(app);
  const get = selector => {
    if (selector.includes(' ')) { const [parent,...rest] = selector.split(' '); return get(parent)?.querySelector(rest.join(' ')) || null; }
    return body.querySelector(selector);
  };
  const auth = {status:'ready',accountKey:'a'.repeat(64)};
  const c = {console,JSON,Date,String,Number,Map,Set,Promise,Error,Response,encodeURIComponent,
    profile: {}, esc:escape, escapeHtml:escape, save() {}, updateIdentity() {},
    navigator:{clipboard:{writeText(){externalActions.push('clipboard');throw Error('Unexpected clipboard access');}}},
    open(){externalActions.push('navigation');throw Error('Unexpected external navigation');},
    location:{pathname:captain?'/dashboard':'/',search:'',hash:'',reload(){notices.push('reload');}},history:{replaceState(){}},
    sessionStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    addEventListener(name, fn) { events.set(name,fn); },dispatchEvent(){},Event:class{constructor(type){this.type=type;}},
    document:{body,hidden:false,createElement:tag=>new Node(tag),querySelector:get,addEventListener(name,fn){events.set(name,fn);}},
    MishwarAccountContext:{snapshot:()=>auth,beginAuthRead:()=>({}),readController:()=>({controller:{signal:{}},release(){}}),isAuthReadCurrent:()=>true,applyAuth:()=>true,notifyAuth(){},ignored:()=>false},
    sectionModal(_title,html){modal.innerHTML=html;modal.open=true;},$:get,toast:message=>notices.push(message),refresh(){notices.push('refresh');},
    captainServiceDialog(_title,html){const dialog=new Node('dialog');dialog.innerHTML=html;body.append(dialog);dialog.showModal();return dialog;},
    FormData:class{constructor(form){this.items=Object.entries(form.elements).map(([name,node])=>[name,node.value]);}[Symbol.iterator](){return this.items[Symbol.iterator]();}},
    handler:async action=>action==='session'?initialSession:{ok:true},
    fetch:async(url,options={})=>{const action=url.split('/').at(-1),payload=options.body?JSON.parse(options.body):{};calls.push({url,action,body:payload});const result=await c.handler(action,payload);return {ok:(result?.statusCode||200)<400,json:async()=>result?.data??result};},
  };
  c.window=c;vm.createContext(c);vm.runInContext(source(path),c);
  const submit = async selector => { const form=get(selector);assert.ok(form,selector+' exists');const event={target:form,currentTarget:form,preventDefault(){}};if(form.onsubmit)await form.onsubmit(event);else for(const fn of form.listeners.get('submit')||[])await fn(event);await flush(); };
  const click = async selector => { const button=get(selector);assert.ok(button,selector+' exists');assert.equal(button.disabled,false);const event={target:button,currentTarget:button};if(button.onclick)await button.onclick(event);else for(const fn of button.listeners.get('click')||[])await fn(event);await flush(); };
  const safe = () => {for(const html of snapshots)assert.doesNotMatch(html,/href\s*=\s*["'](?:https?:|mailto:|tel:)|wa\.me|api\.whatsapp/i);assert.deepEqual(externalActions,[]);assert.ok(calls.every(row=>row.url.startsWith('/api/auth/')));};
  return {c,calls,snapshots,notices,get,submit,click,safe,stored,openSettings(){events.get('click')({target:{closest:selector=>selector==='[data-account-settings]'?{}:null}});}};
}

const change = (stage='old') => ({id:'local-privacy-request',kind:'phone',stage,mode:'manual',phone:'+966500000000',code:'123456',expiresAt:'2030-01-01T10:00:00Z'});

test('captain manual proof shows request/code without a recipient and cannot finish before both approved stages',async()=>{
  const h=harness(files.settings,{captain:true});let state=change();h.c.handler=async action=>action==='change-status'?state:{ok:true};h.openSettings();
  await h.click('#resume-account-change');assert.match(h.get('#account-settings-body').innerHTML,/local-privacy-request/);assert.match(h.get('#account-settings-body').innerHTML,/123456/);assert.equal(h.get('#finish-account-change'),null);assert.equal(h.get('#check-account-code'),null);h.safe();
  state=change('new');await h.click('#refresh-account-change');assert.match(h.get('#account-settings-body').innerHTML,/رقمك الجديد/);assert.equal(h.get('#finish-account-change'),null);
  state=change('approved');await h.click('#refresh-account-change');assert.ok(h.get('#finish-account-change'));assert.equal(h.calls.some(row=>row.action==='change-finish'),false);
  await h.click('#finish-account-change');assert.equal(h.calls.filter(row=>row.action==='change-finish').length,1);h.safe();
});

test('captain manual request references are escaped and cancellation never approves the request',async()=>{
  const h=harness(files.settings,{captain:true});h.c.handler=async action=>action==='change-status'?{...change(),id:'<img src=x onerror=unexpected>'}:{ok:true};h.openSettings();await h.click('#resume-account-change');
  assert.match(h.get('#account-settings-body').innerHTML,/&lt;img/);assert.equal(h.get('#account-settings-body').querySelector('img'),null);await h.click('#cancel-account-change');
  assert.ok(h.get('#account-change-form'));assert.equal(h.calls.some(row=>row.action==='change-finish'),false);h.safe();
});

for(const [name,path,captain] of [['captain',files.captainRecovery,true],['rider',files.riderRecovery,false]]){
  test(`${name} recovery keeps the pending reference and requires server approval plus explicit password submission`,async()=>{
    const h=harness(path,{captain});let approved=false;h.c.handler=async action=>action==='recovery-start'?{id:'local-recovery-reference',code:'654321',phone:'+966500000000',recoveryToken:'local-private-token'}:action==='recovery-status'?{status:approved?'approved':'pending'}:{ok:true};
    h.c.showAccountRecovery();assert.equal(h.calls.length,0);h.get('#start-recovery').phone.value='0500000000';await h.submit('#start-recovery');
    const dialog=h.get('#account-recovery-dialog');assert.match(dialog.innerHTML,/local-recovery-reference/);assert.match(dialog.innerHTML,/654321/);assert.match(dialog.innerHTML,/بانتظار مراجعة الإدارة/);assert.equal(h.get('#finish-recovery'),null);assert.equal(h.calls.some(row=>row.action==='recovery-finish'),false);h.safe();
    approved=true;await h.click('[data-check-recovery]');assert.ok(h.get('#finish-recovery'));assert.equal(h.calls.some(row=>row.action==='recovery-finish'),false);
    h.get('#finish-recovery').password.value='new-test-password';h.get('#finish-recovery').confirm.value='different';await h.submit('#finish-recovery');assert.equal(h.calls.some(row=>row.action==='recovery-finish'),false);
    h.get('#finish-recovery').confirm.value='new-test-password';await h.submit('#finish-recovery');assert.equal(h.calls.filter(row=>row.action==='recovery-finish').length,1);assert.equal(h.calls.at(-1).body.recoveryToken,'local-private-token');assert.equal(h.stored.size,0);h.safe();
  });
}

test('failed recovery request does not claim a saved request or send anything to an external recipient',async()=>{
  const h=harness(files.riderRecovery);h.c.handler=async()=>({statusCode:503,data:{error:'Local unavailable fixture'}});h.c.showAccountRecovery();h.get('#start-recovery').phone.value='0500000000';await h.submit('#start-recovery');
  assert.equal(h.get('#finish-recovery'),null);assert.equal(h.stored.size,0);assert.equal(h.get('#recovery-error').textContent,'Local unavailable fixture');assert.equal(h.calls.length,1);h.safe();
});

test('rider account keeps SMS and email recovery available without automatic proof or external contact',async()=>{
  let verified=false,signedIn=true;const session=()=>signedIn?{authenticated:true,phoneVerified:verified,accountKey:'a'.repeat(64),profile:{name:'Offline fixture',phone:'+966500000000',email:'offline@example.test'}}:{authenticated:false};
  const h=harness(files.riderAuth,{initialSession:session()});h.c.handler=async action=>action==='session'?session():action==='phone-otp-start'?{retryAfter:60}:action==='phone-otp-check'?(verified=true,{ok:true}):{message:'Local email request accepted'};await flush();h.c.showAccount();
  assert.ok(h.get('#rider-otp-form'));assert.equal(h.calls.some(row=>row.action==='phone-otp-start'||row.action==='phone-otp-check'),false);h.safe();
  await h.click('#rider-send-otp');assert.equal(h.calls.filter(row=>row.action==='phone-otp-start').length,1);assert.equal(verified,false);assert.equal(h.calls.some(row=>row.action==='phone-otp-check'),false);
  h.get('#rider-otp-form').code.value='123456';await h.submit('#rider-otp-form');assert.equal(verified,true);assert.equal(h.get('#rider-otp-form'),null);
  await h.click('#rider-email-verify');assert.equal(h.calls.filter(row=>row.action==='email-request-verification').length,1);signedIn=false;await h.c.refreshMishwarRiderAccount();h.c.showRiderLogin();await h.click('#rider-email-recovery');assert.ok(h.get('#email-reset-request'));h.safe();
});

test('privacy support instructions and request reference have English catalog coverage',()=>{
  const sandbox={window:{MishwarLang:{get:()=> 'en'}}};vm.createContext(sandbox);vm.runInContext(source('../../rider/public/i18n-catalog.js'),sandbox);
  const texts=['رقم الطلب:','تواصل مع الدعم عبر قنواته المعتمدة من رقمك المسجل، واذكر رقم الطلب ورمز التحقق. تبقى الاستعادة بانتظار مراجعة الإدارة. بعد الاعتماد لديك ١٠ دقائق لحفظ كلمة المرور الجديدة.','الاستعادة بمراجعة الإدارة عبر قنوات الدعم المعتمدة، دون إرسال SMS تلقائي.'];
  for(const text of texts){const translated=sandbox.window.MishwarEnglish.lookup(text);assert.ok(translated);assert.doesNotMatch(translated,/[\u0600-\u06ff]/);assert.doesNotMatch(translated,/WhatsApp/);}
  const captain=source('../public/i18n.js');for(const text of texts)assert.ok(captain.includes(JSON.stringify(text)));
});

test('active account and recovery sources contain no WhatsApp recipient or address construction',()=>{
  for(const path of Object.values(files))assert.doesNotMatch(source(path),/wa\.me|api\.whatsapp|whatsapp\s*=/i);
});
