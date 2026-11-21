/* Local receipt export: browser-shaped Arabic raster pages inside a real PDF.
 * No provider, CDN, persistent storage, or embedded script is used. */
(() => {
  'use strict';
  const records = new WeakMap(), active = new Set();
  const FONT = 'Arial, Tahoma, sans-serif', WIDTH = 1240, HEIGHT = 1754, MAX_PAGES = 8;
  const labels = {
    ar: {title:'إيصال المشوار',brand:'مشوار',number:'رقم الإيصال',trip:'رقم المشوار',date:'تاريخ المشوار',end:'وقت إتمام المشوار',pickup:'الانطلاق',destination:'الوجهة',category:'فئة المركبة',fare:'أجرة المشوار',discount:'الخصم',total:'الإجمالي',method:'وسيلة الدفع',status:'حالة الدفع',tax:'الرقم الضريبي للمنشأة',license:'رقم الترخيص',note:'إيصال مشوار، وليس فاتورة ضريبية إلكترونية معتمدة.',hint:'ملف PDF يحافظ على شكل العربية كصورة؛ النص غير قابل للتحديد أو البحث.',cash:'نقدًا',wallet:'المحفظة',card:'بطاقة',applepay:'Apple Pay',economy:'اقتصادية',comfort:'مريحة',vip:'VIP',unknown:'غير محدد',paid:'تم الدفع',cash_collected:'تم تحصيل النقد',cash_due:'مستحق نقدًا',held:'مبلغ محجوز',pending:'قيد التحقق',failed:'فشل الدفع',refunded:'مسترد',wallet_returned:'أعيد إلى المحفظة',cancelled:'ملغى'},
    en: {title:'Trip receipt',brand:'Mishwar',number:'Receipt number',trip:'Trip ID',date:'Trip date',end:'Trip completed at',pickup:'Pickup',destination:'Destination',category:'Vehicle category',fare:'Trip fare',discount:'Discount',total:'Total',method:'Payment method',status:'Payment status',tax:'Merchant tax number',license:'License number',note:'Trip receipt. This is not a certified electronic tax invoice.',hint:'This PDF preserves Arabic as an image. Its text cannot be selected or searched.',cash:'Cash',wallet:'Wallet',card:'Card',applepay:'Apple Pay',economy:'Economy',comfort:'Comfort',vip:'VIP',unknown:'Not specified',paid:'Paid',cash_collected:'Cash collected',cash_due:'Cash due',held:'Funds held',pending:'Pending verification',failed:'Payment failed',refunded:'Refunded',wallet_returned:'Returned to wallet',cancelled:'Cancelled'},
  };
  const lang = () => window.MishwarLang?.get() === 'en' ? 'en' : 'ar';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text = (value, limit = 600) => typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, ' ').trim().slice(0, limit) : '';
  const accountError = () => Object.assign(Error('تغير الحساب. افتح الإيصال مجددًا.'), {name:'AccountChangedError'});
  const error = message => Error(message);
  function current(model) {
    const record = records.get(model), state = record?.context.snapshot();
    if (!record || record.disposed || !record.context.isCurrent(record.ticket) || state.status !== 'ready' || !state.authenticated || !state.verified) throw accountError();
    return record;
  }
  function timestamp(value, optional = false) {
    if (optional && (value === undefined || value === null || value === '')) return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw error('بيانات تاريخ المشوار غير صحيحة.');
    return new Date(value).toISOString();
  }
  function normalize(raw, {tripId, ticket} = {}) {
    const context = window.MishwarAccountContext, state = context?.snapshot();
    if (!ticket || !context?.isCurrent(ticket) || state.status !== 'ready' || !state.authenticated || !state.verified) throw accountError();
    if (!raw || typeof raw !== 'object' || raw.tripStatus !== 'completed') throw error('الإيصال متاح للمشاوير المكتملة فقط.');
    if (typeof tripId !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(tripId) || raw.tripId !== tripId) throw error('الإيصال لا يطابق المشوار المطلوب.');
    const number = text(raw.receipt_number, 80);
    if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(number) || raw.currency !== 'SAR') throw error('بيانات الإيصال غير صحيحة.');
    const amounts = [raw.fare, raw.discount, raw.paid];
    if (amounts.some(value => !Number.isSafeInteger(value) || value < 0) || raw.discount > raw.fare || raw.paid !== raw.fare - raw.discount) throw error('مبالغ الإيصال غير متطابقة.');
    const tripCreatedAt = timestamp(raw.tripCreatedAt), tripCompletedAt = timestamp(raw.tripCompletedAt, true);
    if (tripCompletedAt && Date.parse(tripCompletedAt) < Date.parse(tripCreatedAt)) throw error('بيانات تاريخ المشوار غير صحيحة.');
    const point = value => {const name=text(value?.name);if(!name)throw error('عنوان المشوار غير صحيح.');return Object.freeze({name,area:text(value?.area,300)});};
    const model = Object.freeze({
      receipt_number:number, tripId, tripStatus:'completed', currency:'SAR',
      tripCreatedAt, tripCompletedAt, fare:raw.fare, discount:raw.discount, paid:raw.paid,
      pickup:point(raw.pickup), destination:point(raw.destination), method:text(raw.method,40), category:text(raw.category,40),
      paymentStatus:text(raw.paymentStatus,60),
      merchant:Object.freeze({name:text(raw.merchant?.name,200)||'مشوار',taxNumber:text(raw.merchant?.taxNumber,80),license:text(raw.merchant?.license,80)}),
      taxInvoice:false,
    });
    records.set(model, {context,ticket:{...ticket},disposed:false,urls:new Set(),frames:new Set(),timers:new Set(),rejects:new Set(),pdf:null,pdfPromise:null,actionPromise:null});
    active.add(model); return model;
  }
  const money = (value, language) => {const digits=String(value).padStart(3,'0');return digits.slice(0,-2)+'.'+digits.slice(-2)+(language==='en'?' SAR':' ر.س');};
  const date = (value, language) => new Intl.DateTimeFormat(language==='en'?'en-GB':'ar-SA-u-ca-gregory', {dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(value));
  function fields(model, language) {
    const t=labels[language], address=p=>p.name+(p.area?' — '+p.area:'');
    return [
      [t.number,model.receipt_number,true], [t.trip,model.tripId,true], [t.date,date(model.tripCreatedAt,language)],
      ...(model.tripCompletedAt?[[t.end,date(model.tripCompletedAt,language)]]:[]),
      [t.pickup,address(model.pickup)], [t.destination,address(model.destination)],
      [t.category,t[model.category]||t.unknown], [t.fare,money(model.fare,language),true], [t.discount,money(model.discount,language),true],
      [t.total,money(model.paid,language),true,'total'], [t.method,t[model.method]||t.unknown],
      [t.status,t[model.paymentStatus]||t.unknown],
      ...(model.merchant.taxNumber?[[t.tax,model.merchant.taxNumber,true]]:[]),
      ...(model.merchant.license?[[t.license,model.merchant.license,true]]:[]),
    ];
  }
  function renderHtml(model) {
    current(model);const language=lang(),t=labels[language];
    return `<article class="trip-receipt" lang="${language}" dir="${language==='ar'?'rtl':'ltr'}"><div class="receipt-brand">${t.brand}</div><p class="receipt-merchant" data-no-translate>${escape(model.merchant.name)}</p><h3>${t.title}</h3><dl>${fields(model,language).map(([label,value,ltr,kind])=>`<div class="receipt-row${kind?' receipt-'+kind:''}"><dt>${label}</dt><dd><bdi${ltr?' dir="ltr"':''} data-no-translate>${escape(value)}</bdi></dd></div>`).join('')}</dl><p class="receipt-note">${t.note}</p><p class="receipt-pdf-hint">${t.hint}</p></article>`;
  }
  function bounded(work, record, timeout, message) {
    let timer, cancel;
    const stopped=new Promise((_,reject)=>{cancel=()=>reject(accountError());record.rejects.add(cancel);timer=setTimeout(()=>reject(error(message)),timeout)});
    return Promise.race([work,stopped]).finally(()=>{clearTimeout(timer);record.rejects.delete(cancel)});
  }
  function words(ctx, value, width) {
    const lines=[];let line='';
    for(const word of String(value).split(/\s+/)){
      const next=line?line+' '+word:word;
      if(ctx.measureText(next).width<=width){line=next;continue}
      if(line){lines.push(line);line=''}
      if(ctx.measureText(word).width<=width){line=word;continue}
      let fragment='';
      const characters=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(word)].map(item=>item.segment):[...word];
      for(const character of characters){if(fragment&&ctx.measureText(fragment+character).width>width){lines.push(fragment);fragment=''}fragment+=character}
      line=fragment;
    }
    if(line)lines.push(line);return lines.length?lines:[''];
  }
  async function rasterPages(model, record, job) {
    const language=lang(),t=labels[language],pages=[];let canvas,ctx,y;
    const check=()=>{current(model);if(job.cancelled)throw error('انتهت مهلة تجهيز PDF. أعد المحاولة.');};
    if(document.fonts?.load)await bounded(document.fonts.load('32px Arial','مشوار الرحلة'),record,5000,'تعذر تجهيز خط الإيصال. أعد المحاولة.');
    check();
    function page(){
      check();if(pages.length>=MAX_PAGES)throw error('الإيصال أطول من الحد المسموح.');
      canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;ctx=canvas.getContext('2d');if(!ctx)throw error('تعذر تجهيز PDF في هذا المتصفح.');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.fillStyle='#083344';ctx.fillRect(0,0,WIDTH,210);
      ctx.direction=language==='ar'?'rtl':'ltr';ctx.textAlign=language==='ar'?'right':'left';ctx.fillStyle='#ffffff';ctx.font='bold 58px '+FONT;ctx.fillText(t.brand,language==='ar'?WIDTH-82:82,88);
      ctx.font='34px '+FONT;ctx.fillText(t.title,language==='ar'?WIDTH-82:82,154);
      y=260;pages.push({canvas,ctx});
    }
    page();
    function line(value,{size=32,bold=false,ltr=false,color='#123b4a'}={}){
      if(y>HEIGHT-130)page();ctx.font=(bold?'bold ':'')+size+'px '+FONT;ctx.fillStyle=color;
      ctx.direction=ltr?'ltr':language==='ar'?'rtl':'ltr';ctx.textAlign=ltr?'left':language==='ar'?'right':'left';
      ctx.fillText(value,ltr?82:language==='ar'?WIDTH-82:82,y);y+=size+18;
    }
    line(model.merchant.name,{bold:true,size:34});y+=8;
    for(const [label,value,ltr,kind]of fields(model,language)){
      check();ctx.font=(kind?'bold ':'')+'34px '+FONT;const rows=words(ctx,value,WIDTH-164);
      if(y+70>HEIGHT-130)page();line(label,{size:25,color:'#526b76'});
      for(const row of rows)line(row,{size:kind?42:34,bold:kind==='total',ltr});
      y+=12;
    }
    ctx.font='25px '+FONT;for(const note of words(ctx,t.note,WIDTH-164))line(note,{size:25,color:'#526b76'});
    const images=[];
    for(let i=0;i<pages.length;i++){
      check();const {canvas:pageCanvas,ctx:pageCtx}=pages[i];pageCtx.font='24px '+FONT;pageCtx.direction='ltr';pageCtx.textAlign='center';pageCtx.fillStyle='#526b76';pageCtx.fillText((i+1)+' / '+pages.length,WIDTH/2,HEIGHT-58);
      const encoded=new Promise((resolve,reject)=>{
        try{if(typeof pageCanvas.toBlob!=='function')throw error('تنزيل PDF غير مدعوم في هذا المتصفح.');pageCanvas.toBlob(blob=>blob?resolve(blob):reject(error('تعذر ترميز صفحة PDF.')),'image/jpeg',.95)}catch(e){reject(e)}
      });
      const blob=await bounded(encoded,record,10000,'انتهت مهلة تجهيز صفحة PDF. أعد المحاولة.');check();
      const bytes=new Uint8Array(await bounded(blob.arrayBuffer(),record,5000,'تعذر قراءة صفحة PDF. أعد المحاولة.'));check();
      if(bytes[0]!==255||bytes[1]!==216)throw error('تعذر ترميز صفحة PDF.');images.push(bytes);
    }
    return images;
  }
  function pdfBytes(images) {
    const encoder=new TextEncoder(),parts=[],offsets=[0];let length=0;
    const add=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;parts.push(bytes);length+=bytes.length;};
    const object=(id,head,stream)=>{offsets[id]=length;add(id+' 0 obj\n'+head);if(stream){add('\nstream\n');add(stream);add('\nendstream')}add('\nendobj\n');};
    add('%PDF-1.4\n');add(new Uint8Array([37,226,227,207,211,10]));
    object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    object(2,'<< /Type /Pages /Count '+images.length+' /Kids ['+images.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>');
    images.forEach((image,i)=>{
      const page=3+i*3,content=encoder.encode('q\n595.28 0 0 841.89 0 0 cm\n/ReceiptImage Do\nQ\n');
      object(page,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /ReceiptImage '+(page+1)+' 0 R >> >> /Contents '+(page+2)+' 0 R >>');
      object(page+1,'<< /Type /XObject /Subtype /Image /Width '+WIDTH+' /Height '+HEIGHT+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+image.length+' >>',image);
      object(page+2,'<< /Length '+content.length+' >>',content);
    });
    const start=length,count=3+images.length*3;add('xref\n0 '+count+'\n0000000000 65535 f \n');
    for(let i=1;i<count;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
    add('trailer\n<< /Size '+count+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n');
    const result=new Uint8Array(length);let at=0;for(const part of parts){result.set(part,at);at+=part.length}return result;
  }
  function createPdf(model) {
    const record=current(model);if(record.pdf)return Promise.resolve(record.pdf);if(record.pdfPromise)return record.pdfPromise;
    const job={cancelled:false};
    const work=(async()=>{const images=await rasterPages(model,record,job);current(model);if(job.cancelled)throw error('انتهت مهلة تجهيز PDF.');return new Blob([pdfBytes(images)],{type:'application/pdf'})})();
    record.pdfPromise=bounded(work,record,20000,'انتهت مهلة تجهيز PDF. أعد المحاولة.').then(blob=>{current(model);record.pdf=blob;return blob}).finally(()=>{job.cancelled=true;record.pdfPromise=null});
    return record.pdfPromise;
  }
  function once(model,operation) {
    const record=current(model);if(record.actionPromise)return record.actionPromise;
    record.actionPromise=Promise.resolve().then(operation).finally(()=>{record.actionPromise=null});return record.actionPromise;
  }
  function later(record,operation,delay){const id=setTimeout(()=>{record.timers.delete(id);operation()},delay);record.timers.add(id);return id;}
  function save(model,blob) {
    const record=current(model),url=URL.createObjectURL(blob),link=document.createElement('a');record.urls.add(url);
    link.href=url;link.download='Mishwar-'+model.receipt_number+'.pdf';link.rel='noopener';link.hidden=true;
    try{document.body.append(link);current(model);link.click()}catch(e){URL.revokeObjectURL(url);record.urls.delete(url);throw e}finally{link.remove()}
    later(record,()=>{URL.revokeObjectURL(url);record.urls.delete(url)},30000);
    return {action:'download',filename:link.download,started:true};
  }
  const download=model=>once(model,async()=>save(model,await createPdf(model)));
  const share=model=>once(model,async()=>{
    const blob=await createPdf(model);current(model);
    const file=typeof File==='function'?new File([blob],'Mishwar-'+model.receipt_number+'.pdf',{type:'application/pdf'}):null;
    let supported=false;try{supported=!!file&&typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})}catch{}
    if(supported){
      try{await navigator.share({files:[file],title:labels[lang()].title});current(model);return {action:'shared'}}catch(e){current(model);if(e.name==='AbortError')return {action:'cancelled'}}
    }
    return save(model,blob);
  });
  function print(model) {
    return once(model,()=>{
      const record=current(model),frame=document.createElement('iframe');frame.title=labels[lang()].title;frame.setAttribute('aria-hidden','true');frame.setAttribute('sandbox','allow-same-origin allow-modals');frame.style.cssText='position:fixed;width:0;height:0;border:0;';record.frames.add(frame);
      let fallback=null;
      const cleanup=()=>{if(fallback!==null){clearTimeout(fallback);record.timers.delete(fallback);fallback=null}frame.remove();record.frames.delete(frame)};
      const work=new Promise((resolve,reject)=>{frame.onload=()=>{try{current(model);frame.contentWindow.addEventListener('afterprint',cleanup,{once:true});frame.contentWindow.focus();frame.contentWindow.print();current(model);if(record.frames.has(frame))fallback=later(record,cleanup,90000);resolve({action:'print',opened:true})}catch(e){cleanup();reject(e)}};frame.onerror=()=>{cleanup();reject(error('تعذر تجهيز نافذة الطباعة.'))};});
      frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><title>Mishwar receipt</title><style>@page{size:A4;margin:15mm}body{margin:0;font:16px Arial,Tahoma,sans-serif;color:#123b4a}.trip-receipt{max-width:180mm;margin:auto}.receipt-brand{font-size:32px;font-weight:bold}.receipt-row{padding:8px 0;border-bottom:1px solid #ddd;break-inside:avoid}dt{color:#526b76}dd{margin:4px 0;overflow-wrap:anywhere}.receipt-total{font-size:22px;font-weight:bold}.receipt-pdf-hint{display:none}</style></head><body>'+renderHtml(model)+'</body></html>';
      document.body.append(frame);return bounded(work,record,10000,'انتهت مهلة تجهيز الطباعة. أعد المحاولة.').catch(e=>{cleanup();throw e});
    });
  }
  function dispose(model) {
    const record=records.get(model);if(!record||record.disposed)return;record.disposed=true;
    for(const reject of record.rejects)reject();record.rejects.clear();
    for(const url of record.urls)URL.revokeObjectURL(url);record.urls.clear();
    for(const timer of record.timers)clearTimeout(timer);record.timers.clear();
    for(const frame of record.frames)frame.remove();record.frames.clear();record.pdf=null;active.delete(model);
  }
  window.addEventListener('mishwar-account-reset',()=>{for(const model of [...active])dispose(model)});
  window.MishwarReceipt=Object.freeze({normalize,renderHtml,createPdf,download,share,print,dispose});
})();
