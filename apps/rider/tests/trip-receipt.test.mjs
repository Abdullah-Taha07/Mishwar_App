import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');
const A='a'.repeat(64),B='b'.repeat(64);
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const receipt=(extra={})=>({
  receipt_number:'MW-RECEIPT-TEST',tripId:'trip-receipt-test',tripStatus:'completed',currency:'SAR',
  tripCreatedAt:'2026-11-20T09:00:00.000Z',tripCompletedAt:'2026-11-20T09:25:00.000Z',
  pickup:{name:'شارع الاختبار العربي',area:'الرياض'},destination:{name:'وجهة تجريبية متصلة الحروف',area:'حي الاختبار'},
  fare:2000,discount:250,paid:1750,method:'cash',category:'comfort',paymentStatus:'cash_due',
  merchant:{name:'مشوار',taxNumber:null,license:null},taxInvoice:false,...extra,
});

function harness({language='ar',autoFrame=true,navigator={}}={}){
  const events=new Map(),timers=new Map(),canvases=[],drawn=[],anchors=[],frames=[],urls=new Map(),revoked=[],fontCalls=[],encoded=[];
  let timerId=0,urlId=0,encodeMode='ready',fontMode=null;
  const body={children:[],append(node){this.children.push(node);if(node.tagName==='IFRAME'&&autoFrame)Promise.resolve().then(()=>node.onload?.())}};
  function element(tag){
    const attrs=new Map(),node={tagName:tag.toUpperCase(),style:{},removed:false,setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),remove(){this.removed=true;body.children=body.children.filter(item=>item!==this)}};
    if(tag==='a'){node.click=()=>{node.clicks=(node.clicks||0)+1};anchors.push(node)}
    if(tag==='iframe'){node.contentWindow={addEventListener:(name,fn)=>{node.afterprint=fn},focus(){},print(){node.printCalls=(node.printCalls||0)+1}};frames.push(node)}
    if(tag==='canvas'){
      const ctx={direction:'inherit',textAlign:'start',fillRect(){},measureText:value=>({width:[...String(value)].length*18}),fillText(value,x,y){drawn.push({value:String(value),x,y,direction:this.direction,align:this.textAlign,font:this.font})}};
      node.getContext=()=>ctx;
      // Encoder fixture only. PDF structure is tested below; this does not
      // substitute for visually decoding the browser's actual JPEG/PDF output.
      node.toBlob=(callback,type,quality)=>{encoded.push({callback,type,quality});if(encodeMode==='ready')Promise.resolve().then(()=>callback(new Blob([Uint8Array.of(255,216,255,217)],{type:'image/jpeg'})));else if(encodeMode==='null')Promise.resolve().then(()=>callback(null))};
      canvases.push(node);
    }
    return node;
  }
  class TestURL extends URL {static createObjectURL(blob){const id='blob:receipt-test-'+(++urlId);urls.set(id,blob);return id}static revokeObjectURL(id){revoked.push(id);urls.delete(id)}}
  const c={console,Promise,Map,Set,WeakMap,Blob,File,TextEncoder,URL:TestURL,Intl,Date,AbortController,
    Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
    addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn)},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event)},
    document:{body,createElement:element,fonts:{load(font,text){fontCalls.push({font,text});return fontMode||Promise.resolve([])}}},navigator,
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
    MishwarLang:{get:()=>language},
    fetch(){throw Error('Receipt export must never fetch a provider or CDN')},
  };
  c.window=c;vm.createContext(c);vm.runInContext(source('account-context.js'),c);
  function auth(owner){const context=c.MishwarAccountContext;context.applyAuth(owner?{authenticated:true,phoneVerified:true,accountKey:owner}:{authenticated:false,accountKey:null},context.beginAuthRead());context.notifyAuth()}
  auth(A);vm.runInContext(source('trip-receipt.js'),c);
  const api=c.MishwarReceipt;
  return {c,api,auth,canvases,drawn,anchors,frames,urls,revoked,fontCalls,encoded,timers,
    model(raw=receipt()){return api.normalize(raw,{tripId:'trip-receipt-test',ticket:c.MishwarAccountContext.capture()})},
    encode(value){encodeMode=value},fonts(value){fontMode=value},tick(ms){for(const [id,timer]of [...timers])if(timer.ms===ms){timers.delete(id);timer.fn()}},
  };
}

test('RDEV-002 receipt normalization binds a completed trip to the captured owner and preserves pending payment truth',()=>{
  const h=harness(),model=h.model();
  assert.equal(model.tripStatus,'completed');assert.equal(model.paymentStatus,'cash_due');assert.equal(model.paid,1750);assert.equal(model.taxInvoice,false);
  assert.ok(Object.isFrozen(model));assert.ok(Object.isFrozen(model.pickup));
  const html=h.api.renderHtml(model);assert.match(html,/الإجمالي/);assert.match(html,/مستحق نقدًا/);assert.doesNotMatch(html,/تم الدفع/);
  assert.match(html,/17\.50 ر\.س/);assert.match(html,/dir="rtl"/);assert.match(html,/النص غير قابل للتحديد/);
});

test('RDEV-002 a completed receipt may omit the completion timestamp without substituting the receipt creation date',()=>{
  const h=harness(),model=h.model(receipt({tripCompletedAt:null,created_at:'2030-01-01T00:00:00Z'}));
  assert.equal(model.tripCompletedAt,null);assert.equal(model.tripCreatedAt,'2026-11-20T09:00:00.000Z');
  assert.doesNotMatch(h.api.renderHtml(model),/2030|وقت إتمام المشوار/);
});

test('RDEV-002 incomplete, mismatched and malformed financial receipts are rejected',()=>{
  const h=harness();
  for(const change of [{tripStatus:'riding'},{tripStatus:'cancelled'},{tripId:'other-trip'},{currency:'USD'},{fare:-1},{paid:1751},{discount:2500},{fare:20.5},{tripCreatedAt:'not-a-date'},{tripCompletedAt:'2025-01-01T00:00:00Z'}])assert.throws(()=>h.model(receipt(change)));
  assert.throws(()=>h.api.normalize(receipt(),{tripId:'trip-receipt-test'}),{name:'AccountChangedError'});
});

test('RDEV-002 rendering escapes untrusted merchant and address text and separates text direction',()=>{
  const h=harness(),model=h.model(receipt({merchant:{name:'<img src=x onerror=alert(1)>'},pickup:{name:'<script>private</script>'}}));
  const html=h.api.renderHtml(model);assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<img|<script/);assert.match(html,/<bdi dir="ltr"/);
});

test('RDEV-002 money formatting preserves every stored halala without floating-point rounding',()=>{
  const h=harness({language:'en'}),amount=Number.MAX_SAFE_INTEGER,html=h.api.renderHtml(h.model(receipt({fare:amount,discount:0,paid:amount})));
  assert.match(html,/90071992547409\.91 SAR/);assert.match(html,/lang="en" dir="ltr"/);
});

test('RDEV-002 an old server response cannot be normalized under the next account',()=>{
  const h=harness(),ticket=h.c.MishwarAccountContext.capture();h.auth(B);
  assert.throws(()=>h.api.normalize(receipt(),{tripId:'trip-receipt-test',ticket}),{name:'AccountChangedError'});
});

test('RDEV-002 real account reset prevents rendering or exporting an old normalized receipt',async()=>{
  const h=harness(),model=h.model();h.auth(B);
  for(const operation of ['renderHtml','createPdf','download','share','print'])await assert.rejects(Promise.resolve().then(()=>h.api[operation](model)),{name:'AccountChangedError'});
  assert.equal(h.canvases.length,0);assert.equal(h.anchors.length,0);assert.equal(h.frames.length,0);
});

test('RDEV-002 PDF has independently checked xref offsets, page objects and length-delimited raster streams',async()=>{
  const h=harness(),blob=await h.api.createPdf(h.model()),bytes=Buffer.from(await blob.arrayBuffer()),pdf=bytes.toString('latin1');
  assert.equal(blob.type,'application/pdf');assert.ok(pdf.startsWith('%PDF-1.4\n'));
  const xref=Number(pdf.match(/startxref\n(\d+)\n%%EOF/)?.[1]);assert.equal(pdf.slice(xref,xref+4),'xref');
  const entries=pdf.slice(xref).split('\n'),count=Number(entries[1].split(' ')[1]);
  for(let id=1;id<count;id++){const offset=Number(entries[2+id].slice(0,10));assert.equal(pdf.slice(offset,offset+String(id).length+6),id+' 0 obj')}
  const images=[...pdf.matchAll(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g)];assert.equal(images.length,h.canvases.length);assert.ok(images.length>0);
  for(const match of images){const start=match.index+match[0].length,length=Number(match[1]);assert.equal(bytes[start],255);assert.equal(bytes[start+1],216);assert.equal(pdf.slice(start+length,start+length+10),'\nendstream')}
  assert.equal(Number(pdf.match(/\/Type \/Pages \/Count (\d+)/)[1]),images.length);
  assert.doesNotMatch(pdf,/\/JavaScript|\/OpenAction|https?:|<script/);
});

test('RDEV-002 canvas uses Arabic RTL shaping input and local system fonts, with bounded multipage layout',async()=>{
  const h=harness(),model=h.model(receipt({pickup:{name:'موقع عربي '.repeat(80)},destination:{name:'وجهة عربية '.repeat(80)}}));
  await h.api.createPdf(model);assert.ok(h.canvases.length>1);assert.ok(h.canvases.length<=8);
  const arabic=h.drawn.filter(row=>/[\u0600-\u06ff]/.test(row.value));assert.ok(arabic.some(row=>row.value==='مشوار'));
  assert.ok(arabic.filter(row=>!/[\d]/.test(row.value)).every(row=>row.direction==='rtl'&&row.align==='right'));
  assert.ok(h.drawn.every(row=>row.y<1754));assert.ok(h.fontCalls.every(row=>row.font==='32px Arial'));
});

test('RDEV-002 font loading cannot export after account ownership changes',async()=>{
  const h=harness(),font=deferred(),model=h.model();h.fonts(font.promise);
  const work=h.api.download(model);await flush();h.auth(B);font.resolve([]);
  await assert.rejects(work,{name:'AccountChangedError'});assert.equal(h.anchors.length,0);assert.equal(h.urls.size,0);
});

test('RDEV-002 a late raster callback cannot download another account receipt',async()=>{
  const h=harness(),model=h.model();h.encode('hung');const work=h.api.download(model);await flush();assert.equal(h.encoded.length,1);
  h.auth(B);h.encoded[0].callback(new Blob([Uint8Array.of(255,216,255,217)]));
  await assert.rejects(work,{name:'AccountChangedError'});assert.equal(h.anchors.length,0);assert.equal(h.urls.size,0);
});

test('RDEV-002 a missing raster callback times out and an explicit retry remains possible',async()=>{
  const h=harness(),model=h.model();h.encode('hung');const work=h.api.createPdf(model);await flush();h.tick(10000);
  await assert.rejects(work,/مهلة/);h.encode('ready');assert.equal((await h.api.createPdf(model)).type,'application/pdf');
});

test('RDEV-002 duplicate export clicks create one download and dispose revokes its private URL',async()=>{
  const h=harness(),model=h.model(),first=h.api.download(model),second=h.api.download(model);
  const [a,b]=await Promise.all([first,second]);assert.equal(a.action,'download');assert.equal(b.action,'download');assert.equal(a.started,true);
  assert.equal(h.anchors.length,1);assert.equal(h.anchors[0].clicks,1);assert.match(h.anchors[0].download,/\.pdf$/);assert.equal(h.urls.size,1);
  h.api.dispose(model);assert.equal(h.urls.size,0);assert.equal(h.revoked.length,1);
});

test('RDEV-002 sharing uses a PDF File without a URL and reports user cancellation accurately',async()=>{
  let sent;
  const h=harness({navigator:{canShare:()=>true,share:async data=>{sent=data}}}),model=h.model();
  assert.equal((await h.api.share(model)).action,'shared');assert.equal(sent.files[0].type,'application/pdf');assert.equal('url'in sent,false);assert.equal(h.anchors.length,0);
  h.c.navigator.share=async()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'})};
  assert.equal((await h.api.share(model)).action,'cancelled');assert.equal(h.anchors.length,0);
});

test('RDEV-002 unsupported file sharing falls back to a download without claiming a completed save',async()=>{
  const h=harness({navigator:{canShare(){throw Error('unsupported')},share(){throw Error('must not run')}}});
  const result=await h.api.share(h.model());assert.equal(result.action,'download');assert.equal(result.started,true);assert.equal('saved'in result,false);
});

test('RDEV-002 print is isolated to the receipt and its iframe is removed on account reset',async()=>{
  const h=harness(),model=h.model(),result=await h.api.print(model);
  assert.equal(result.action,'print');assert.equal(result.opened,true);assert.equal(h.frames.length,1);
  const frame=h.frames[0];assert.equal(frame.printCalls,1);assert.match(frame.srcdoc,/trip-receipt/);assert.match(frame.getAttribute('sandbox'),/allow-modals/);assert.doesNotMatch(frame.srcdoc,/https?:|<script/);
  h.auth(B);assert.equal(frame.removed,true);
});

test('RDEV-002 a print frame that does not load times out without leaving its UI behind',async()=>{
  const h=harness({autoFrame:false}),work=h.api.print(h.model());await flush();h.tick(10000);
  await assert.rejects(work,/مهلة/);assert.equal(h.frames[0].removed,true);
});

test('RDEV-002 denied native sharing falls back to a file download without sending a link',async()=>{
  const h=harness({navigator:{canShare:()=>true,share:async()=>{throw Object.assign(Error('Permission denied'),{name:'NotAllowedError'})}}});
  const result=await h.api.share(h.model());assert.equal(result.action,'download');assert.equal(h.anchors.length,1);assert.equal(h.anchors[0].clicks,1);
});

test('RDEV-002 a browser download refusal releases its private URL and permits a clean retry',async()=>{
  const h=harness(),model=h.model(),create=h.c.document.createElement;
  h.c.document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>{throw Error('Browser refused the download')};return node};
  await assert.rejects(h.api.download(model),/refused/);assert.equal(h.urls.size,0);assert.equal(h.revoked.length,1);assert.equal(h.anchors[0].removed,true);
  h.c.document.createElement=create;assert.equal((await h.api.download(model)).action,'download');assert.equal(h.anchors[1].clicks,1);
});

test('RDEV-002 print cleanup waits for afterprint or its bounded fallback',async()=>{
  const printed=harness();await printed.api.print(printed.model());const frame=printed.frames[0];
  assert.equal(frame.removed,false);printed.tick(1000);assert.equal(frame.removed,false);
  frame.afterprint();assert.equal(frame.removed,true);assert.equal([...printed.timers.values()].some(timer=>timer.ms===90000),false);
  const fallback=harness();await fallback.api.print(fallback.model());fallback.tick(90000);assert.equal(fallback.frames[0].removed,true);
});
