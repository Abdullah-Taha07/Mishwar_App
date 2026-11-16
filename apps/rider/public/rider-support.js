/* General and trip support share the existing service desk and account boundary. */
(()=>{
 const context=window.MishwarAccountContext,esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const memory=new Map(),labels={technical:'مشكلة تقنية',other:'دعم عام',lost_item:'غرض مفقود',fare:'مراجعة الأجرة',driver_behavior:'السلوك أثناء الرحلة'},states={open:'مفتوح',in_progress:'قيد المتابعة',closed:'مغلق'};
 let view=null;
 const storageKey=name=>context.storageKey('mishwar-support:'+name);
 function readDraft(name){const key=storageKey(name);if(!key)return {};try{const raw=sessionStorage.getItem(key),value=raw?JSON.parse(raw):memory.get(key);return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return memory.get(key)||{}}}
 function saveDraft(name,data){const key=storageKey(name);if(!key)return;memory.set(key,data);try{sessionStorage.setItem(key,JSON.stringify(data))}catch{}}
 function removeDraft(name){const key=storageKey(name);if(!key)return;memory.delete(key);try{sessionStorage.removeItem(key)}catch{}}
 function attempt(name,payload){const old=readDraft(name),snapshot=JSON.stringify(payload),clientRequestId=old.snapshot===snapshot&&old.clientRequestId?old.clientRequestId:crypto.randomUUID();saveDraft(name,{...payload,snapshot,clientRequestId});return clientRequestId}
 function close(){const old=view;view=null;if(!old)return;for(const read of old.reads)read.controller.abort();old.dialog.close();old.dialog.remove()}
 const current=active=>view===active&&active.dialog.open&&context.isCurrent(active.ticket);
 function message(active,error){if(!current(active)||context.ignored(error))return;const el=active.dialog.querySelector('[data-support-error]');if(el)el.textContent=error.name==='TimeoutError'?'لم يصل تأكيد الإرسال. احتفظنا بالنص؛ أعد المحاولة بنفس الطلب بعد عودة الاتصال.':error.name==='TypeError'?'تعذر الاتصال. احتفظنا بالنص دون إعادة إرسال تلقائية. أعد المحاولة عند عودة الشبكة.':error.message||'تعذر تنفيذ الطلب. النص محفوظ لحسابك.'}
 function dialog(title,html){
  close();const d=document.createElement('dialog');d.id='rider-support-dialog';d.className='launch-dialog';d.innerHTML=`<header class="launch-head"><button type="button" data-support-back aria-label="رجوع">→</button><h2>${esc(title)}</h2></header><div class="launch-body">${html}<p data-support-error role="alert"></p></div>`;
  document.body.append(d);const active={dialog:d,ticket:context.capture(),reads:new Set()};view=active;d.querySelector('[data-support-back]').onclick=close;d.addEventListener('close',()=>{if(view===active)close()},{once:true});d.showModal();return active;
 }
 function verified(){const state=context.snapshot();if(state.status==='ready'&&state.accountKey&&state.verified)return true;const active=dialog('مركز المساعدة','<p>سجّل الدخول ووثّق رقم جوالك لإرسال طلب ومتابعته بأمان.</p><button class="primary" data-support-login>تسجيل / دخول</button>');active.dialog.querySelector('[data-support-login]').onclick=()=>{close();window.showRiderLogin?.()};return false}
 async function call(active,action,body={}){
  if(!current(active))throw context.stale();const read=context.readController();active.reads.add(read);let timer,onAbort;
  const deadline=new Promise((_,reject)=>{onAbort=()=>{const error=Error('Account changed');error.name='AbortError';reject(error)};read.controller.signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{const error=Error('Support request timed out');error.name='TimeoutError';reject(error);read.controller.abort()},15000)});
  const work=(async()=>{const response=await fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',signal:read.controller.signal,body:JSON.stringify({action:'live_'+action,...body})});if(read.controller.signal.aborted||!current(active))throw context.stale();const result=await response.json();if(read.controller.signal.aborted||!current(active))throw context.stale();context.checkResponseOwner(result,active.ticket);if(!response.ok)throw Error(result.error||'تعذر تنفيذ طلب الدعم');return result})();
  try{return await Promise.race([work,deadline])}finally{clearTimeout(timer);read.controller.signal.removeEventListener('abort',onAbort);active.reads.delete(read);read.release()}
 }
 function draftForm(active,name,form,fields){
  const save=()=>{if(!current(active))return;const previous=readDraft(name),payload=fields();saveDraft(name,{...previous,...payload,...(previous.snapshot===JSON.stringify(payload)?{}:{snapshot:null,clientRequestId:null})})};
  form.addEventListener('input',save);form.addEventListener('change',save);return save;
 }
 function open(tripId){
  if(!verified())return;tripId=typeof tripId==='string'&&tripId?tripId:null;
  const name='create:'+(tripId||'account'),draft=readDraft(name),kinds=tripId?Object.keys(labels):['technical','other'];
  const active=dialog('إرسال طلب مساعدة',`<p class="launch-note">${tripId?'يرتبط الطلب بالرحلة ويصل إلى مركز الدعم في الإدارة.':'طلب عام مرتبط بحسابك ويصل إلى مركز الدعم في الإدارة.'} احتفظنا بالمسودة لهذا الحساب فقط. الدعم لا يستدعي خدمات الطوارئ ولا يضمن ردًا فوريًا.</p><form data-support-create class="launch-form"><label>نوع الطلب<select name="kind">${kinds.map(kind=>`<option value="${kind}" ${draft.kind===kind?'selected':''}>${labels[kind]}</option>`).join('')}</select></label><label>التفاصيل<textarea name="description" minlength="10" maxlength="2000" required rows="5" placeholder="اكتب التفاصيل دون كلمات مرور أو بيانات بطاقات">${esc(draft.description||'')}</textarea></label><button class="primary">إرسال طلب الدعم</button></form><button class="secondary" data-support-history>طلباتي لدى الدعم</button>`);
  const form=active.dialog.querySelector('form'),fields=()=>({kind:form.elements.kind.value,description:form.elements.description.value,tripId});draftForm(active,name,form,fields);
  active.dialog.querySelector('[data-support-history]').onclick=history;
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');if(button.disabled||!current(active))return;const payload=fields();if(payload.description.trim().length<10){message(active,Error('اكتب ١٠ أحرف على الأقل'));return}const clientRequestId=attempt(name,payload);button.disabled=true;try{const result=await call(active,'case_create',{...payload,clientRequestId});if(!current(active))return;if(JSON.stringify(fields())!==JSON.stringify(payload)||readDraft(name).clientRequestId!==clientRequestId){message(active,Error('تم إرسال النص السابق. بقيت تعديلاتك الحالية محفوظة ولم تُرسل.'));return}removeDraft(name);await conversation(result.id)}catch(error){message(active,error)}finally{if(current(active))button.disabled=false}};
 }
 async function history(){
  if(!verified())return;const active=dialog('طلباتي لدى الدعم','<p data-support-loading>جارٍ تحميل طلباتك…</p>');
  try{const data=await call(active,'cases');if(!current(active))return;active.dialog.querySelector('.launch-body').innerHTML=`<button class="primary" data-support-new>طلب مساعدة جديد</button>${data.items?.length?data.items.map(row=>`<button class="launch-case" data-support-case="${esc(row.id)}"><b>${esc(labels[row.kind]||labels.other)}</b><span>${esc(states[row.status]||row.status)}</span><small data-no-translate>${esc(row.description.slice(0,120))}</small></button>`).join(''):'<p>لا توجد طلبات دعم مسجلة لهذا الحساب.</p>'}<p data-support-error role="alert"></p>`;active.dialog.querySelector('[data-support-new]').onclick=()=>open();for(const button of active.dialog.querySelectorAll('[data-support-case]'))button.onclick=()=>conversation(button.dataset.supportCase)}catch(error){message(active,error)}
 }
 async function conversation(caseId){
  if(!verified()||typeof caseId!=='string')return;const active=dialog('متابعة طلب الدعم','<p>جارٍ تحميل المحادثة…</p>');
  try{
   const result=await call(active,'case_messages',{caseId});if(!current(active))return;const name='reply:'+caseId,draft=readDraft(name),closed=result.case.status==='closed';
   active.dialog.querySelector('.launch-body').innerHTML=`<p class="launch-note">رقم الطلب: ${esc(caseId.slice(-8))} · الحالة: ${esc(states[result.case.status]||result.case.status)}</p><div class="chat-log" role="log">${result.messages.map(row=>`<article class="chat-bubble ${row.role==='admin'?'':'mine'}"><small>${row.role==='admin'?'فريق مشوار':'أنت'}</small><p data-no-translate>${esc(row.body)}</p></article>`).join('')}</div>${closed?'<p>هذا الطلب مغلق. يمكنك فتح طلب جديد عند الحاجة.</p>':`<form data-support-reply class="launch-form"><label>ردك<textarea name="body" minlength="1" maxlength="2000" required rows="3">${esc(draft.body||'')}</textarea></label><button class="primary">إرسال الرد</button></form>`}<button class="secondary" data-support-history>العودة إلى طلباتي</button><p data-support-error role="alert"></p>`;
   active.dialog.querySelector('[data-support-history]').onclick=history;if(closed)return;
   const form=active.dialog.querySelector('form'),fields=()=>({caseId,body:form.elements.body.value});draftForm(active,name,form,fields);
   form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');if(button.disabled||!current(active))return;const payload=fields();if(!payload.body.trim())return;const clientRequestId=attempt(name,payload);button.disabled=true;try{await call(active,'case_messages',{...payload,clientRequestId});if(!current(active))return;if(JSON.stringify(fields())!==JSON.stringify(payload)||readDraft(name).clientRequestId!==clientRequestId){message(active,Error('تم إرسال النص السابق. بقيت تعديلاتك الحالية محفوظة ولم تُرسل.'));return}removeDraft(name);await conversation(caseId)}catch(error){message(active,error)}finally{if(current(active))button.disabled=false}};
  }catch(error){message(active,error)}
 }
 window.addEventListener('mishwar-account-reset',close);
 window.MishwarSupport={open,history,case:conversation};
 // Replace the existing help actions; no parallel local-only request queue.
 showSupport=tripId=>open(typeof tripId==='string'?tripId:null);
 showSupportHistory=history;
})();
